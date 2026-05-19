// ABOUTME: Subagent job execution - handles spawning and managing AI subagent processes

import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, appendFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import {
  readSessionState,
  writeSessionState,
  loadSession,
} from '@lace/agent/storage/session-store';
import { getEffectiveConfig } from '@lace/agent/core/session';
import { appendDurableEvent } from '@lace/agent/storage/event-log';
import { getJobOutputPath } from './job-file-utils';
import {
  applyEffectiveJobConfig,
  buildSubagentInitConfig,
  jobStatusFromStopReason,
  rpcErrorMessage,
} from './subagent-job-helpers';
import { logger } from '@lace/agent/utils/logger';
import { SUBAGENT_USER_PERSONAS_TARGET } from './persona-container-spec';
import { spawnSubagent, type SubagentProcessHandle } from './subagent-spawn';
import type { ToolResult } from '@lace/ent-protocol';
import { logToolUpdateToJobLog } from './job-log-formatter';
import {
  MAX_JOB_OUTPUT_BYTES,
  type SessionUpdate,
  type JobInnerUpdate,
  type JobType,
  type JobState,
  type AgentServerState,
} from '../server-types';

// Types for tool_use update payloads from child processes
type ToolKind = 'read' | 'edit' | 'delete' | 'search' | 'execute' | 'think' | 'fetch' | 'other';
type ToolStatus =
  | 'pending'
  | 'awaiting_permission'
  | 'running'
  | 'completed'
  | 'failed'
  | 'denied'
  | 'timeout'
  | 'cancelled';

// Type for permission options from child processes
type PermissionOption = { optionId: string; label: string };

// Type guard for validating permission options array
function isPermissionOptionsArray(value: unknown): value is PermissionOption[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).optionId === 'string' &&
      typeof (item as Record<string, unknown>).label === 'string'
  );
}

// Type for extracting error properties from RPC errors
interface RpcErrorLike {
  code?: number | string;
  data?: Record<string, unknown>;
}

/**
 * Server-level dependencies that runSubagentJobProcess needs.
 * These are passed in to avoid coupling to the global state object.
 */
export interface SubagentJobDependencies {
  /** Get the current server state */
  getState: () => AgentServerState;
  /** Run work exclusively with lock */
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>;
  /** Emit session update to clients */
  emitSessionUpdate: (
    update: SessionUpdate,
    context?: { turnId?: string; turnSeq?: number; jobId?: string }
  ) => Promise<void>;
  /** Request permission from client */
  requestPermissionFromClient: (request: {
    sessionId: string;
    turnId: string;
    turnSeq: number;
    jobId: string;
    toolCallId: string;
    tool: string;
    kind?: string;
    resource: string;
    options: Array<{ optionId: string; label: string }>;
    input: Record<string, unknown>;
  }) => Promise<{ decision?: string; updatedInput?: Record<string, unknown> }>;
  /** Finalize job completion */
  finalizeJob: (job: JobState, options?: { exitCode?: number }) => Promise<void>;
}

/**
 * Runs a subagent job process by spawning (or exec'ing into a persona
 * container) a lace-agent process and communicating with it via JSON-RPC
 * over stdio. Strategy is chosen by spawnSubagent based on the parent
 * job's persona runtime.
 */
export function runSubagentJobProcess(job: JobState, deps: SubagentJobDependencies): void {
  const { getState, runExclusive, emitSessionUpdate, requestPermissionFromClient, finalizeJob } =
    deps;

  // Helper to write error output directly to the job output file.
  // This is used for error reporting and doesn't depend on state.activeSession.
  const writeErrorToJobOutput = (errorText: string) => {
    try {
      // Ensure the job-logs directory exists
      if (!existsSync(dirname(job.outputPath))) {
        mkdirSync(dirname(job.outputPath), { recursive: true, mode: 0o700 });
      }
      appendFileSync(job.outputPath, errorText, { encoding: 'utf8' });
    } catch (writeErr) {
      logger.error('job.subagent.write_error_failed', {
        jobId: job.jobId,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
    }
  };

  void (async () => {
    const state = getState();

    if (!state.activeSession) {
      job.status = 'failed';
      writeErrorToJobOutput('[SUBAGENT ERROR]\nMessage: No active session\n');
      await finalizeJob(job);
      return;
    }
    if (job.proc || job.finished) return;
    if (!job.subagentContent || !Array.isArray(job.subagentContent)) {
      job.status = 'failed';
      writeErrorToJobOutput('[SUBAGENT ERROR]\nMessage: Missing subagentContent\n');
      await finalizeJob(job);
      return;
    }

    // Buffer for collecting stderr output
    let stderrBuffer = '';
    let subagentProc: SubagentProcessHandle | undefined;
    let childTransport: ReturnType<typeof createNdjsonStdioTransport> | undefined;
    let childPeer: JsonRpcPeer | undefined;

    try {
      subagentProc = await spawnSubagent({
        parentSessionId: state.activeSession.meta.sessionId,
        personaName: job.persona,
        personaContainerRuntime: job.personaContainerRuntime,
        personaBoxRuntime: job.personaBoxRuntime,
        containerManager: state.containerManager,
        containerMounts: state.containerMounts,
      });

      if (subagentProc.nativeProcess) {
        job.proc = subagentProc.nativeProcess;
      }
      if (subagentProc.containerExec) {
        job.containerExec = subagentProc.containerExec;
      }

      subagentProc.onSpawnError((err) => {
        stderrBuffer += `[SPAWN ERROR] ${err.message}\n`;
      });

      subagentProc.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf8');
      });

      subagentProc.onExit(({ code, signal }) => {
        if (code !== 0 && code !== null) {
          logger.debug('job.subagent.child_exit', {
            jobId: job.jobId,
            exitCode: code,
            signal,
            stderrLength: stderrBuffer.length,
          });
        }
      });

      childTransport = createNdjsonStdioTransport({
        readable: subagentProc.stdout,
        writable: subagentProc.stdin,
      });
      job.childTransportClose = childTransport.close;

      childPeer = new JsonRpcPeer(childTransport, { idPrefix: 'c_' });
      job.childPeer = childPeer;
    } catch (setupError) {
      // Error during spawn/transport/peer setup
      job.status = 'failed';
      const errorMessage = setupError instanceof Error ? setupError.message : String(setupError);
      const errorStack = setupError instanceof Error ? setupError.stack : undefined;
      const errorDetails = [
        '[SUBAGENT ERROR]',
        `Message: Setup failed - ${errorMessage}`,
        ...(stderrBuffer.trim() ? [`Stderr: ${stderrBuffer.trim()}`] : []),
        ...(errorStack ? [`Stack: ${errorStack}`] : []),
      ].join('\n');
      writeErrorToJobOutput(errorDetails);
      logger.error('job.subagent.setup_failed', {
        jobId: job.jobId,
        error: errorMessage,
        stderr: stderrBuffer.trim() || undefined,
      });
      await finalizeJob(job);
      return;
    }

    const appendJobOutput = async (text: string) => {
      const currentState = getState();
      if (!currentState.activeSession) return;
      await runExclusive(() => {
        // Check output size limit
        const currentSize = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
        if (currentSize >= MAX_JOB_OUTPUT_BYTES) return; // Already at limit
        const remaining = MAX_JOB_OUTPUT_BYTES - currentSize;
        const toWrite = text.length <= remaining ? text : text.slice(0, remaining);
        appendFileSync(job.outputPath, toWrite, { encoding: 'utf8' });
      });
    };

    const childJobIdMap = new Map<string, string>();
    // Track which toolCallIds we've already emitted a `[tool: ...]` line for
    // (per job-log path) so that pending→running status transitions don't
    // produce duplicate announcement lines. Keyed by output path so forwarded
    // delegate jobs get their own dedupe namespace.
    const announcedToolCallsByPath = new Map<string, Set<string>>();
    const getSeenSetFor = (path: string): Set<string> => {
      const existing = announcedToolCallsByPath.get(path);
      if (existing) return existing;
      const fresh = new Set<string>();
      announcedToolCallsByPath.set(path, fresh);
      return fresh;
    };

    const mapChildJobId = (childJobId: string): string => {
      const existing = childJobIdMap.get(childJobId);
      if (existing) return existing;
      const mapped = `${job.jobId}_${childJobId}`;
      childJobIdMap.set(childJobId, mapped);
      return mapped;
    };

    const ensureForwardedJobRecord = (options: {
      jobId: string;
      parentJobId?: string;
      type: JobType;
      description?: string;
    }): JobState => {
      const currentState = getState();
      const existing = currentState.jobManager.getJob(options.jobId);
      if (existing) return existing;

      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });

      const record: JobState = {
        jobId: options.jobId,
        parentJobId: options.parentJobId,
        type: options.type,
        status: 'running',
        description: options.description,
        startedAt: new Date().toISOString(),
        outputPath: getJobOutputPath(currentState.activeSession!.dir, options.jobId),
        finished: false,
        completion,
        resolveCompletion,
      };

      currentState.jobManager.addJob(record);
      return record;
    };

    childPeer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      const type = p.type;

      if (type === 'job_started' && typeof p.jobId === 'string') {
        const mappedJobId = mapChildJobId(p.jobId);
        const mappedParentJobId =
          typeof p.parentJobId === 'string' ? mapChildJobId(p.parentJobId) : job.jobId;
        const jobType = p.jobType === 'delegate' ? 'delegate' : 'bash';
        const description = typeof p.description === 'string' ? p.description : undefined;

        ensureForwardedJobRecord({
          jobId: mappedJobId,
          parentJobId: mappedParentJobId,
          type: jobType,
          description,
        });

        await runExclusive(() => {
          const currentState = getState();
          let sessionState = readSessionState(currentState.activeSession!.dir);
          const { nextState } = appendDurableEvent(currentState.activeSession!.dir, sessionState, {
            type: 'job_started',
            data: {
              jobId: mappedJobId,
              parentJobId: mappedParentJobId,
              jobType,
              description,
            },
          });
          sessionState = nextState;
          writeSessionState(currentState.activeSession!.dir, sessionState);
          const updatedState = getState();
          updatedState.activeSession = loadSession(currentState.activeSession!.meta.sessionId);
        });

        await emitSessionUpdate({
          type: 'job_started',
          jobId: mappedJobId,
          parentJobId: mappedParentJobId,
          jobType,
          description,
        });

        return undefined;
      }

      if (type === 'job_finished' && typeof p.jobId === 'string') {
        const mappedJobId = mapChildJobId(p.jobId);
        const mappedParentJobId =
          typeof p.parentJobId === 'string' ? mapChildJobId(p.parentJobId) : job.jobId;
        const exitCode = typeof p.exitCode === 'number' ? p.exitCode : undefined;
        const outcome =
          p.outcome === 'completed' || p.outcome === 'failed' ? p.outcome : 'cancelled';

        const record = ensureForwardedJobRecord({
          jobId: mappedJobId,
          parentJobId: mappedParentJobId,
          type: p.jobType === 'delegate' ? 'delegate' : 'bash',
        });
        record.status = outcome;
        record.finished = true;
        record.proc = undefined;
        record.containerExec = undefined;
        record.childPeer = undefined;
        record.subagentSessionId = undefined;
        record.childTransportClose = undefined;
        record.exitCode = exitCode;

        await runExclusive(() => {
          const currentState = getState();
          let sessionState = readSessionState(currentState.activeSession!.dir);
          const { nextState } = appendDurableEvent(currentState.activeSession!.dir, sessionState, {
            type: 'job_finished',
            data: {
              jobId: mappedJobId,
              parentJobId: mappedParentJobId,
              outcome,
              ...(exitCode !== undefined ? { exitCode } : {}),
            },
          });
          sessionState = nextState;
          writeSessionState(currentState.activeSession!.dir, sessionState);
          const updatedState = getState();
          updatedState.activeSession = loadSession(currentState.activeSession!.meta.sessionId);
        });

        await emitSessionUpdate({
          type: 'job_finished',
          jobId: mappedJobId,
          parentJobId: mappedParentJobId,
          ...(exitCode !== undefined ? { exitCode } : {}),
          outcome,
        });

        record.resolveCompletion();
        return undefined;
      }

      if (
        type === 'job_update' &&
        typeof p.jobId === 'string' &&
        p.update &&
        typeof p.update === 'object'
      ) {
        const mappedJobId = mapChildJobId(p.jobId);
        const mappedParentJobId =
          typeof p.parentJobId === 'string' ? mapChildJobId(p.parentJobId) : job.jobId;

        const record = ensureForwardedJobRecord({
          jobId: mappedJobId,
          parentJobId: mappedParentJobId,
          type: p.jobType === 'delegate' ? 'delegate' : 'bash',
        });

        const channel = p.channel === 'stdout' || p.channel === 'stderr' ? p.channel : 'internal';
        // Child job update - forwarded as-is with namespaced IDs
        // Runtime checks ensure shape is valid before forwarding
        const update = p.update as Record<string, unknown>;

        if (update.type === 'text_delta' && typeof update.text === 'string') {
          const text = update.text;
          await runExclusive(() => {
            // Check output size limit
            const currentSize = existsSync(record.outputPath)
              ? statSync(record.outputPath).size
              : 0;
            if (currentSize >= MAX_JOB_OUTPUT_BYTES) return; // Already at limit
            const remaining = MAX_JOB_OUTPUT_BYTES - currentSize;
            const toWrite = text.length <= remaining ? text : text.slice(0, remaining);
            appendFileSync(record.outputPath, toWrite, { encoding: 'utf8' });
          });
        }

        if (update.type === 'tool_use' && typeof update.toolCallId === 'string') {
          update.toolCallId = `${mappedJobId}:${update.toolCallId}`;

          // Mirror tool_use into the forwarded job's per-job log (kata #39).
          // Forwarded delegate jobs need the same visibility into failed tool
          // calls as the direct case above.
          if (typeof update.name === 'string') {
            const forwardedInput: Record<string, unknown> =
              typeof update.input === 'object' && update.input !== null
                ? (update.input as Record<string, unknown>)
                : {};
            const forwardedStatus = typeof update.status === 'string' ? update.status : undefined;
            const forwardedResult = update.result as ToolResult | undefined;
            await runExclusive(() => {
              logToolUpdateToJobLog(
                {
                  toolCallId: update.toolCallId as string,
                  name: update.name as string,
                  input: forwardedInput,
                  status: forwardedStatus,
                  result: forwardedResult,
                },
                getSeenSetFor(record.outputPath),
                record.outputPath
              );
            });
          }
        }

        await emitSessionUpdate(
          {
            type: 'job_update',
            jobId: mappedJobId,
            parentJobId: mappedParentJobId,
            jobType: record.type,
            channel,
            // Forwarded update from child job - trusted after runtime checks above
            update: update as JobInnerUpdate,
          },
          { turnId: job.originTurnId, turnSeq: job.originTurnSeq }
        );

        return undefined;
      }

      if (type === 'text_delta' && typeof p.text === 'string') {
        await appendJobOutput(p.text);
        await emitSessionUpdate(
          {
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'delegate',
            channel: 'internal',
            update: { type: 'text_delta', text: p.text },
          },
          { turnId: job.originTurnId, turnSeq: job.originTurnSeq }
        );
        return undefined;
      }

      if (type === 'tool_use' && typeof p.toolCallId === 'string' && typeof p.name === 'string') {
        const namespacedToolCallId = `${job.jobId}:${p.toolCallId}`;
        // Extract and validate kind - must be a valid ToolKind or undefined
        const kindStr = typeof p.kind === 'string' ? p.kind : undefined;
        const validKinds: ToolKind[] = [
          'read',
          'edit',
          'delete',
          'search',
          'execute',
          'think',
          'fetch',
          'other',
        ];
        const kind: ToolKind | undefined =
          kindStr && validKinds.includes(kindStr as ToolKind) ? (kindStr as ToolKind) : undefined;

        // Extract and validate status - must be a valid ToolStatus
        const statusStr = typeof p.status === 'string' ? p.status : 'pending';
        const validStatuses: ToolStatus[] = [
          'pending',
          'awaiting_permission',
          'running',
          'completed',
          'failed',
          'denied',
          'timeout',
          'cancelled',
        ];
        const status: ToolStatus = validStatuses.includes(statusStr as ToolStatus)
          ? (statusStr as ToolStatus)
          : 'pending';

        // Extract input as Record<string, unknown>
        const input: Record<string, unknown> =
          typeof p.input === 'object' && p.input !== null
            ? (p.input as Record<string, unknown>)
            : {};

        // Extract result - validated by protocol, trusted from child process
        const result = p.result as ToolResult | undefined;

        // Mirror the tool_use into the per-job log so failed/cancelled tool
        // calls are visible without consulting events.jsonl (kata #39). Done
        // under the same lock as other appendJobOutput writes to keep ordering
        // consistent with text deltas.
        await runExclusive(() => {
          logToolUpdateToJobLog(
            {
              toolCallId: namespacedToolCallId,
              name: p.name as string,
              input,
              status,
              result,
            },
            getSeenSetFor(job.outputPath),
            job.outputPath
          );
        });

        await emitSessionUpdate(
          {
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'delegate',
            channel: 'internal',
            update: {
              type: 'tool_use',
              toolCallId: namespacedToolCallId,
              name: p.name,
              kind,
              input,
              status,
              ...(result ? { result } : {}),
            },
          },
          { turnId: job.originTurnId, turnSeq: job.originTurnSeq }
        );
        return undefined;
      }

      if (type === 'context_injected') {
        await emitSessionUpdate(
          {
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'delegate',
            channel: 'internal',
            // Forwarded context_injected from child job
            update: p as JobInnerUpdate,
          },
          { turnId: job.originTurnId, turnSeq: job.originTurnSeq }
        );
        return undefined;
      }

      return undefined;
    });

    childPeer.onRequest('session/request_permission', async (params) => {
      const p = params as Record<string, unknown>;

      const childToolCallId =
        typeof p.toolCallId === 'string' ? p.toolCallId : `tool_${randomUUID()}`;

      const mappedJobId = typeof p.jobId === 'string' ? mapChildJobId(p.jobId) : job.jobId;
      const namespacedToolCallId = `${mappedJobId}:${childToolCallId}`;

      const turnId =
        typeof p.turnId === 'string' ? p.turnId : (job.originTurnId ?? `turn_${randomUUID()}`);
      const turnSeq = typeof p.turnSeq === 'number' ? p.turnSeq : (job.originTurnSeq ?? 0);

      const currentState = getState();

      // Validate options array or use default
      const options: PermissionOption[] = isPermissionOptionsArray(p.options)
        ? p.options
        : [
            { optionId: 'allow', label: 'Allow' },
            { optionId: 'deny', label: 'Deny' },
          ];

      // Extract input as Record<string, unknown>
      const input: Record<string, unknown> =
        typeof p.input === 'object' && p.input !== null ? (p.input as Record<string, unknown>) : {};

      const decision = await requestPermissionFromClient({
        sessionId: currentState.activeSession!.meta.sessionId,
        turnId,
        turnSeq,
        jobId: mappedJobId,
        toolCallId: namespacedToolCallId,
        tool: typeof p.tool === 'string' ? p.tool : 'unknown',
        kind: typeof p.kind === 'string' ? p.kind : undefined,
        resource: typeof p.resource === 'string' ? p.resource : '',
        options,
        input,
      });

      if (job.finished || job.status === 'cancelled') {
        return { decision: 'deny' };
      }

      return { decision: decision.decision ?? 'deny', updatedInput: decision.updatedInput };
    });

    try {
      const currentState = getState();

      // Inherit the parent's effective approvalMode so the child runs under
      // the same permission policy. Hardcoding 'ask' here caused kata #37: a
      // parent in `dangerouslySkipPermissions` would spawn a child that still
      // asked, and the upstream supervisor's missing handler cancelled the
      // request in ~15ms — silently dropping the subagent's writes.
      const parentEffective = getEffectiveConfig(
        currentState.config,
        currentState.activeSession?.state.config
      );

      // Subagent must be able to resolve user personas on its own session/new
      // (delegate threads `persona: '<name>'` through). For container subagents,
      // the user-personas dir is auto-mounted at a fixed in-container path. For
      // native subagents, the child shares the parent's filesystem so the
      // parent's host paths apply directly.
      // Both container and box runtimes run the child lace-agent inside a
      // container where user personas are auto-mounted at the fixed target.
      const isContainerizedSubagent = !!job.personaContainerRuntime || !!job.personaBoxRuntime;
      const subagentUserPersonasPaths: string[] = isContainerizedSubagent
        ? [SUBAGENT_USER_PERSONAS_TARGET]
        : [...currentState.personaRegistry.getUserPersonasPaths()];

      await childPeer.request('initialize', {
        protocolVersion: '1.0',
        clientInfo: { name: 'lace-agent', version: '0.1.0' },
        capabilities: {
          streaming: true,
          permissions: true,
          'ent/jobStreaming': currentState.jobManager.getStreamingMode(),
        },
        userPersonasPaths: subagentUserPersonasPaths,
        config: buildSubagentInitConfig(parentEffective),
      });

      // Resume existing session or create a new one
      const resumedSession = !!job.subagentSessionId;
      const subagentWorkDir = job.personaContainerRuntime
        ? job.personaContainerRuntime.workingDirectory
        : job.personaBoxRuntime
          ? job.personaBoxRuntime.workingDirectory
          : currentState.activeSession!.meta.workDir;
      if (resumedSession) {
        await childPeer.request('session/resume', {
          sessionId: job.subagentSessionId,
          cwd: subagentWorkDir,
          mcpServers: [],
        });
      } else {
        // New session - thread persona through so subagent's system prompt
        // template comes from the persona's body.
        // For container subagents the parent's host workDir does not exist
        // inside the child's container, so use the persona's declared
        // runtime.workingDirectory instead. Native subagents share the
        // parent's filesystem and continue using the parent workDir.
        const created = (await childPeer.request('session/new', {
          cwd: subagentWorkDir,
          mcpServers: [],
          ...(job.persona ? { persona: job.persona } : {}),
        })) as { sessionId: string };
        job.subagentSessionId = created.sessionId;
      }

      // Persist subagentSessionId for resume functionality
      // This is needed even for resumed jobs so that future resumes can find THIS job's sessionId
      await runExclusive(() => {
        const updatedState = getState();
        let sessionState = readSessionState(updatedState.activeSession!.dir);
        const { nextState } = appendDurableEvent(updatedState.activeSession!.dir, sessionState, {
          type: 'job_session_assigned',
          data: {
            jobId: job.jobId,
            subagentSessionId: job.subagentSessionId,
          },
        });
        sessionState = nextState;
        writeSessionState(updatedState.activeSession!.dir, sessionState);
        const stateAfterWrite = getState();
        stateAfterWrite.activeSession = loadSession(updatedState.activeSession!.meta.sessionId);
      });

      // Inherit any unset connectionId/modelId from the parent's effective config.
      // The two fields are inherited independently: when a persona supplies a
      // modelId but the delegate call provides no connectionId, the parent's
      // connectionId must still flow through.
      applyEffectiveJobConfig(job, parentEffective);

      // Apply persona mcpServers on first creation only — resumed sessions
      // already have their MCP config persisted from the original run.
      const personaMcpServersList =
        job.personaMcpServers && !resumedSession
          ? Object.entries(job.personaMcpServers).map(([name, spec]) => ({
              name,
              command: spec.command,
              ...(spec.args ? { args: spec.args } : {}),
              ...(spec.env ? { env: spec.env } : {}),
              ...(spec.enabled !== undefined ? { enabled: spec.enabled } : {}),
            }))
          : undefined;

      // Configure subagent session with provider/model and any persona MCP defaults.
      const hasConfigurable =
        job.connectionId || job.modelId || (personaMcpServersList && personaMcpServersList.length);
      if (hasConfigurable) {
        await childPeer.request('ent/session/configure', {
          ...(job.connectionId ? { connectionId: job.connectionId } : {}),
          ...(job.modelId ? { modelId: job.modelId } : {}),
          ...(personaMcpServersList && personaMcpServersList.length
            ? { mcpServers: personaMcpServersList }
            : {}),
        });
      }

      const promptResult = (await childPeer.request('session/prompt', {
        content: job.subagentContent,
      })) as { stopReason?: string } | undefined;

      if (job.status !== 'cancelled') {
        job.status = jobStatusFromStopReason(promptResult?.stopReason);
      }
    } catch (error) {
      if (job.status !== 'cancelled') job.status = 'failed';

      // Extract detailed error information. JSON-RPC error responses arrive as
      // plain objects with a string `message` field, but they are not Error
      // instances — `String(error)` would collapse them to "[object Object]".
      const errorMessage = rpcErrorMessage(error);
      // Cast to RpcErrorLike after checking it's an object with the expected properties
      const isErrorObject = error !== null && typeof error === 'object';
      const errorObj = isErrorObject ? (error as RpcErrorLike) : undefined;
      const errorCode = errorObj && 'code' in errorObj ? errorObj.code : undefined;
      const errorData = errorObj && 'data' in errorObj ? errorObj.data : undefined;

      // Build detailed error output
      const errorDetails = [
        `\n[SUBAGENT ERROR]`,
        `Message: ${errorMessage}`,
        ...(errorCode !== undefined ? [`Code: ${errorCode}`] : []),
        ...(errorData ? [`Data: ${JSON.stringify(errorData)}`] : []),
        ...(stderrBuffer.trim() ? [`Stderr: ${stderrBuffer.trim()}`] : []),
        ...(error instanceof Error && error.stack ? [`Stack: ${error.stack}`] : []),
      ].join('\n');

      // Write error details to job output file so they're visible via ent/job/output
      // Use writeErrorToJobOutput as fallback if appendJobOutput fails (e.g., no active session)
      try {
        await appendJobOutput(errorDetails);
      } catch {
        writeErrorToJobOutput(errorDetails);
      }
      // Always also write via direct method in case appendJobOutput silently returned
      const currentState = getState();
      if (!currentState.activeSession) {
        writeErrorToJobOutput(errorDetails);
      }

      logger.error('job.subagent.failed', {
        jobId: job.jobId,
        error: errorMessage,
        code: errorCode,
        data: errorData,
        stderr: stderrBuffer.trim() || undefined,
      });
    } finally {
      try {
        childPeer?.close();
      } catch (error) {
        logger.debug('job.subagent.close_peer.failed', {
          jobId: job.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        job.childTransportClose?.();
      } catch (error) {
        logger.debug('job.subagent.close_transport.failed', {
          jobId: job.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (subagentProc && subagentProc.exitCode === null) {
        subagentProc.kill('SIGTERM');

        // Wait up to 2 seconds for graceful exit
        const exitPromise = subagentProc.wait().then(() => undefined);
        const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 2_000));

        await Promise.race([exitPromise, timeoutPromise]);

        // Force kill if still running
        if (subagentProc.exitCode === null) {
          try {
            subagentProc.kill('SIGKILL');
          } catch (error) {
            // Process may have exited between check and kill
            logger.debug('job.subagent.sigkill.failed', {
              jobId: job.jobId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          // Final wait with shorter timeout
          await Promise.race([
            subagentProc.wait().then(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
          ]);
        }
      }

      await finalizeJob(job);
    }
  })();
}
