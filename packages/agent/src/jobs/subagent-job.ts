// ABOUTME: Subagent job execution - handles spawning and managing AI subagent processes

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, existsSync, appendFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resultsBase } from './results-tree';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import {
  readSessionState,
  writeSessionState,
  loadSession,
} from '@lace/agent/storage/session-store';
import { getEffectiveConfig } from '@lace/agent/core/session';
import { appendDurableEvent } from '@lace/agent/storage/event-log';
import { buildNotification, composeSubagentExitedBody } from '@lace/agent/notifications';
import { getJobOutputPath } from './job-file-utils';
import { persistSubagentChildExit } from './subagent-exit-handler';
import {
  applyEffectiveJobConfig,
  buildSubagentInitConfig,
  formatSubagentStopDetails,
  jobStatusFromStopReason,
  rpcErrorMessage,
} from './subagent-job-helpers';
import type { LaceStopDetails } from '@lace/agent/providers/base-provider';
import { logger } from '@lace/agent/utils/logger';
import { getSkillDirectories } from '@lace/agent/skills';
import { spawnSubagent, type SubagentProcessHandle } from './subagent-spawn';
import type { ToolResult } from '@lace/ent-protocol';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';
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

// Deliberately ships the RAW embedder/workDir tier — the child re-composes
// (persona → plugin → core → embedder) on its own initialize, preventing double-composition.
function getSubagentHostSkillDirs(state: AgentServerState): string[] {
  if (state.skillDirs !== undefined) return state.skillDirs;
  return getSkillDirectories(state.activeSession?.meta.workDir);
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
  /**
   * Shared reference to the parent's internal-turn driver. Reserved for future
   * use by per-job RPC handlers that need to wake the parent on inject.
   */
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null };
  /**
   * Top-level CLI peer for the parent process. The per-subagent
   * `session/update` relay uses it to forward the parent's own
   * `session/update(context_injected)` notification to clients when the
   * relay translates a `pending_reminders_on_exit` update into a local inject.
   */
  topLevelPeer: JsonRpcPeer;
}

function buildRuntimeBindingWithExecutionEnv(
  binding: RuntimeExecutionBinding,
  executionEnv: Record<string, string>
): RuntimeExecutionBinding {
  if (binding.toolRuntime.type !== 'container') {
    return binding;
  }

  return {
    ...binding,
    toolRuntime: {
      ...binding.toolRuntime,
      spec: {
        ...binding.toolRuntime.spec,
        env: {
          ...binding.toolRuntime.spec.env,
          ...executionEnv,
        },
      },
    },
  };
}

/**
 * Runs a subagent job process by spawning a host-side lace-agent process and
 * communicating with it via JSON-RPC over stdio.
 */
export function runSubagentJobProcess(job: JobState, deps: SubagentJobDependencies): void {
  const {
    getState,
    runExclusive,
    emitSessionUpdate,
    requestPermissionFromClient,
    finalizeJob,
    topLevelPeer,
  } = deps;

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
      // Container never materialized — no reap needed.
      return;
    }
    if (job.proc || job.finished) return;
    if (!job.subagentContent || !Array.isArray(job.subagentContent)) {
      job.status = 'failed';
      writeErrorToJobOutput('[SUBAGENT ERROR]\nMessage: Missing subagentContent\n');
      await finalizeJob(job);
      // Container never materialized — no reap needed.
      return;
    }

    const executionEnv = job.executionEnv;
    delete job.executionEnv;
    const runtimeBindingForChild =
      executionEnv && job.runtimeBinding
        ? buildRuntimeBindingWithExecutionEnv(job.runtimeBinding, executionEnv)
        : job.runtimeBinding;

    // Every host-side subagent process gets an ephemeral, auto-cleaned $TMPDIR.
    // Opaque prefix (no session id — the path leaks into the child env and any
    // logs the parent later reads). This is set ONLY on the spawned host process
    // env, never on executionEnv (which is merged into the container above), so a
    // container subagent's tools still get their own /tmp. Removed in `finally`.
    // Located under <results-base>/.tmp rather than the OS temp root so a SIGKILL
    // leak lands in a known, bounded place inside the shim-owned tree (the
    // container's long-lived writable layer has no OS temp reaper). Normal/SIGTERM
    // exit removes it below; reclaiming a SIGKILL leak under .tmp is a small shim
    // follow-up (its workspace GC currently scopes to <parent>/<child> dirs).
    const hostTmpRoot = join(resultsBase(), '.tmp');
    mkdirSync(hostTmpRoot, { recursive: true, mode: 0o700 });
    const hostTmpDir = mkdtempSync(join(hostTmpRoot, 'lace-tmp-'));
    const spawnExecutionEnv: Record<string, string> = {
      ...(executionEnv ?? {}),
      TMPDIR: hostTmpDir,
    };

    // Buffer for collecting stderr output
    let stderrBuffer = '';
    let subagentProc: SubagentProcessHandle | undefined;
    let childTransport: ReturnType<typeof createNdjsonStdioTransport> | undefined;
    let childPeer: JsonRpcPeer | undefined;
    // Set true once the finally block deliberately tears the child down. The
    // onExit handler uses this to distinguish unexpected child death (persist
    // diagnostic, close peer to wake pending RPCs) from clean teardown (no-op).
    let teardownInitiated = false;
    let subagentHostSkillDirs: string[] = [];

    try {
      subagentHostSkillDirs = getSubagentHostSkillDirs(state);
      subagentProc = await spawnSubagent({
        executionEnv: spawnExecutionEnv,
      });

      if (subagentProc.nativeProcess) {
        job.proc = subagentProc.nativeProcess;
      }

      subagentProc.onSpawnError((err) => {
        stderrBuffer += `[SPAWN ERROR] ${err.message}\n`;
      });

      subagentProc.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf8');
      });

      subagentProc.onExit(({ code, signal }) => {
        // Normal shutdown (code === 0) follows the happy path through the
        // finally block. For abnormal exits (non-zero OR killed by signal
        // before we asked it to) we must do two things synchronously here:
        //   1. Persist the buffered stderr to the per-job .log file so the
        //      diagnostic survives even if the parent's pending RPC hangs.
        //   2. Close the childPeer so any pending RPC requests reject with
        //      'Closed' — otherwise the parent's `await childPeer.request(...)`
        //      sits forever (the stdio transport closes silently and the
        //      JsonRpcPeer never learns the transport is dead). Rejecting
        //      the await is what triggers the catch + finally below, which
        //      transitions the job to terminal state and fires job_notify
        //      subscriber fanout.
        if (code === 0) return;
        // The finally block also SIGTERMs the child as part of normal teardown
        // after a successful prompt; in that case onExit fires with code=null
        // and signal='SIGTERM'. Don't treat that as a crash.
        if (teardownInitiated) return;
        logger.debug('job.subagent.child_exit', {
          jobId: job.jobId,
          exitCode: code,
          signal,
          stderrLength: stderrBuffer.length,
        });
        persistSubagentChildExit({
          jobId: job.jobId,
          outputPath: job.outputPath,
          exitCode: code,
          signal,
          stderr: stderrBuffer,
        });
        try {
          childPeer?.close();
        } catch (closeErr) {
          logger.debug('job.subagent.close_peer_on_exit_failed', {
            jobId: job.jobId,
            error: closeErr instanceof Error ? closeErr.message : String(closeErr),
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
      // The shim owns per_invocation idle-TTL teardown; lace no longer schedules
      // its own reap (doing so would double-reap/conflict with the shim).
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
      if (existing) {
        return existing;
      }

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

      // Subagent → parent: on graceful exit, the subagent notifies its peer
      // about reminders that were still pending. We compose the
      // <notification kind="subagent-exited"> body here (in the parent's own
      // process, using the parent's composers) and append it as a
      // context_injected priority='immediate' event to the parent's
      // events.jsonl under runExclusive. The subagent never writes the
      // parent's files directly — architectural invariant.
      if (type === 'pending_reminders_on_exit') {
        const remindersParam = p.reminders;
        if (!Array.isArray(remindersParam)) return undefined;

        const pending = remindersParam.filter(
          (r): r is { id: string; prompt: string; next_fire_at_iso: string } => {
            if (typeof r !== 'object' || r === null) return false;
            const rec = r as Record<string, unknown>;
            return (
              typeof rec.id === 'string' &&
              typeof rec.prompt === 'string' &&
              typeof rec.next_fire_at_iso === 'string'
            );
          }
        );

        if (pending.length === 0) return undefined;

        const subagentSessionId = job.subagentSessionId ?? '';
        const personaName = job.persona ?? '';
        const text = buildNotification({
          kind: 'subagent-exited',
          identifiers: {
            'subagent-session-id': subagentSessionId,
            'job-id': job.jobId,
            persona: personaName,
          },
          body: composeSubagentExitedBody({
            persona: personaName,
            pendingReminders: pending,
          }),
        });

        await runExclusive(() => {
          const currentState = getState();
          if (!currentState.activeSession) return;
          let sessionState = readSessionState(currentState.activeSession.dir);
          const { nextState } = appendDurableEvent(currentState.activeSession.dir, sessionState, {
            type: 'context_injected',
            data: {
              content: [{ type: 'text', text }],
              priority: 'immediate',
            },
          });
          sessionState = nextState;
          writeSessionState(currentState.activeSession.dir, sessionState);

          // Forward a session/update(context_injected) to the client on the
          // top-level peer so the existing inject-observation path works
          // unchanged (matches injectIntoActiveSession's behaviour).
          topLevelPeer.notify('session/update', {
            sessionId: currentState.activeSession.meta.sessionId,
            streamSeq: sessionState.nextStreamSeq,
            type: 'context_injected',
            priority: 'immediate',
            messageCount: 0,
          });
          writeSessionState(currentState.activeSession.dir, {
            ...sessionState,
            nextStreamSeq: sessionState.nextStreamSeq + 1,
          });

          const updatedState = getState();
          updatedState.activeSession = loadSession(currentState.activeSession.meta.sessionId);
        });

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
      // asked, and a parent client with no handler cancelled the request in
      // ~15ms — silently dropping the subagent's writes.
      const parentEffective = getEffectiveConfig(
        currentState.config,
        currentState.activeSession?.state.config
      );

      // Subagent must be able to resolve user personas on its own session/new.
      // The child process runs on the host, so the parent's host paths apply directly.
      const subagentUserPersonasPaths: string[] = [
        ...currentState.personaRegistry.getUserPersonasPaths(),
      ];
      // The child resolves environments (container defs) for its own nested
      // delegations; thread the parent's env search paths through identically.
      const subagentUserEnvironmentsPaths: string[] = [
        ...currentState.environmentRegistry.getEnvironmentsPaths(),
      ];
      const subagentSkillDirs = [...subagentHostSkillDirs];
      // The child re-parses personas, so it needs the same MCP base
      // dir to resolve relative host-placement command/args.
      const subagentMcpBaseDir = currentState.personaRegistry.getMcpBaseDir();

      await childPeer.request('initialize', {
        protocolVersion: '1.0',
        clientInfo: { name: 'lace-agent', version: '0.1.0' },
        capabilities: {
          streaming: true,
          permissions: true,
          'ent/jobStreaming': currentState.jobManager.getStreamingMode(),
        },
        userPersonasPaths: subagentUserPersonasPaths,
        userEnvironmentsPaths: subagentUserEnvironmentsPaths,
        ...(subagentMcpBaseDir ? { mcpBaseDir: subagentMcpBaseDir } : {}),
        skillDirs: subagentSkillDirs,
        config: buildSubagentInitConfig(parentEffective),
      });

      // Determine whether to resume an existing session or create a new one.
      // Three cases:
      //   1. isResume: subagentSessionId set WITHOUT preallocated flag → session/resume
      //   2. isPreallocatedFresh: subagentSessionId set WITH preallocated flag → session/new (passing the id)
      //   3. neither: no id at all (legacy / non-persona delegates) → session/new (child mints id)
      const isResume = !!job.subagentSessionId && !job.subagentSessionPreallocated;
      const isPreallocatedFresh =
        !!job.subagentSessionId && job.subagentSessionPreallocated === true;

      const subagentWorkDir = currentState.activeSession!.meta.workDir;
      const inheritedRuntimeConfig = runtimeBindingForChild
        ? { config: { runtimeBinding: runtimeBindingForChild } }
        : {};
      if (isResume) {
        await childPeer.request('session/resume', {
          sessionId: job.subagentSessionId,
          cwd: subagentWorkDir,
          mcpServers: [],
          ...inheritedRuntimeConfig,
        });
      } else {
        // New session (either preallocated-fresh or legacy no-id case).
        // Thread persona through so subagent's system prompt template comes
        // from the persona's body.
        // For container subagents the parent's host workDir does not exist
        // inside the child's container, so use the persona's declared
        // runtime.workingDirectory instead. Native subagents share the
        // parent's filesystem and continue using the parent workDir.
        const newRequest = {
          cwd: subagentWorkDir,
          ...(job.persona ? { persona: job.persona } : {}),
          parent: {
            sessionId: currentState.activeSession!.meta.sessionId,
            jobId: job.jobId,
            ...(job.persona ? { personaName: job.persona } : {}),
          },
          ...inheritedRuntimeConfig,
          ...(isPreallocatedFresh ? { sessionId: job.subagentSessionId } : {}),
        };
        const created = (await childPeer.request('session/new', newRequest)) as {
          sessionId: string;
        };
        // If preallocated, the child must echo back the same id — assert to catch bugs.
        if (isPreallocatedFresh && created.sessionId !== job.subagentSessionId) {
          throw new Error(
            `Child session/new returned mismatched sessionId: expected ${job.subagentSessionId}, got ${created.sessionId}`
          );
        }
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

      // Configure subagent provider connection separately from ACP model config.
      // Persona MCP defaults flow through session/new so resumed sessions keep their persisted MCP config.
      if (job.connectionId) {
        await childPeer.request('ent/session/configure', {
          connectionId: job.connectionId,
        });
      }
      if (job.modelId) {
        await childPeer.request('session/set_config_option', {
          sessionId: job.subagentSessionId,
          configId: 'model',
          value: job.modelId,
        });
      }

      const promptResult = (await childPeer.request('session/prompt', {
        content: job.subagentContent,
      })) as { stopReason?: string; stopDetails?: LaceStopDetails | null } | undefined;

      if (job.status !== 'cancelled') {
        job.status = jobStatusFromStopReason(promptResult?.stopReason);
      }

      // When the subagent reports a stop with diagnostic detail (refusal,
      // context-window exceeded, provider failure, etc.) append a structured
      // [SUBAGENT STOP: ...] block to the job output so the parent agent sees
      // the *why* — both via job_output(jobId) and via the trailing-line hint
      // surfaced in the job-failed notification body. Without this the parent
      // would only see the bare 'failed' status and have no recourse.
      const stopBlock = formatSubagentStopDetails(promptResult?.stopDetails ?? null);
      if (stopBlock !== null) {
        try {
          await appendJobOutput(stopBlock);
        } catch {
          writeErrorToJobOutput(stopBlock);
        }
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
      // Mark teardown initiated so onExit treats the upcoming SIGTERM as
      // expected (no [SUBAGENT CHILD EXITED] block, no childPeer.close from
      // onExit — the explicit close below sequences it correctly relative to
      // the subagent's `pending_reminders_on_exit` notify).
      teardownInitiated = true;

      // SIGTERM first, then close the JSON-RPC channel after the child has
      // exited. The subagent's natural shutdown handler runs
      // emitSubagentExitedIfNeeded, which emits a one-way `session/update`
      // notification over the still-open childPeer carrying the
      // `pending_reminders_on_exit` discriminant. Closing the peer before the
      // subagent finishes would drop those bytes. Bounded waits prevent a
      // misbehaving subagent from stalling job teardown.
      if (subagentProc && subagentProc.exitCode === null) {
        try {
          subagentProc.kill('SIGTERM');
        } catch (error) {
          logger.debug('job.subagent.sigterm.failed', {
            jobId: job.jobId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Wait up to 3 seconds for graceful exit. The subagent gets this
        // window to emit its `pending_reminders_on_exit` notify before we tear
        // down its peer.
        await Promise.race([
          subagentProc.wait().then(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
        ]);

        // Force kill if still running.
        if (subagentProc.exitCode === null) {
          try {
            subagentProc.kill('SIGKILL');
          } catch (error) {
            // Process may have exited between check and kill.
            logger.debug('job.subagent.sigkill.failed', {
              jobId: job.jobId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          await Promise.race([
            subagentProc.wait().then(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, 500)),
          ]);
        }
      }

      // Now safe to tear down the JSON-RPC channel.
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

      await finalizeJob(job);
      // Remove the ephemeral host $TMPDIR. Does not run on SIGKILL; the leak then
      // lands under <results-base>/.tmp (a known, bounded location in the
      // shim-owned tree). The workspace (/work) is the child's result and is NEVER
      // removed here — the shim owns it.
      try {
        rmSync(hostTmpDir, { recursive: true, force: true });
      } catch (error) {
        logger.debug('job.subagent.tmpdir_cleanup.failed', {
          jobId: job.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // The shim owns per_invocation idle-TTL teardown; lace no longer schedules
      // its own reap (doing so would double-reap/conflict with the shim).
    }
  })();
}
