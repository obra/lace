import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  mkdirSync,
  existsSync,
  appendFileSync,
  readFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { join, resolve as resolvePath, isAbsolute as isAbsolutePath } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer, SessionIdSchema } from '@lace/ent-protocol';
import {
  ensureSessionFiles,
  getSessionDir,
  listSessions,
  loadSession,
  readSessionState,
  writeSessionMeta,
  writeSessionState,
  type LoadedSession,
  type SessionState,
} from './storage/session-store';
import { appendDurableEvent, readDurableEvents } from './storage/event-log';
import type { PermissionRequest, SessionUpdate, ToolInfo, ToolResult } from './protocol/types';
import { shellExecTool, runShellExec } from './tools/shell-exec';
import { ProviderCatalogManager } from '@lace/core/providers/catalog/manager';
import { ProviderInstanceManager } from '@lace/core/providers/instance/manager';
import type { CatalogModel } from '@lace/core/providers/catalog/types';
import { ProviderRegistry } from '@lace/core/providers/registry';
import type { AIProvider, ProviderMessage } from '@lace/core/providers/base-provider';
import { ToolExecutor } from '@lace/core/tools/executor';
import type { Tool as CoreTool } from '@lace/core/tools/tool';
import type {
  ToolCall as CoreToolCall,
  ToolResult as CoreToolResult,
} from '@lace/core/tools/types';
import { TestAgentProvider } from './runtime/test-provider';

const SUPPORTED_PROVIDER_TYPES = new Set(['anthropic', 'openai', 'gemini', 'lmstudio', 'ollama']);
const JOB_LOG_DIR = 'jobs';

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  return truncated > 0 ? truncated : null;
}

function getEndpointFromConfig(config: Record<string, unknown>): string | undefined {
  const endpoint =
    toNonEmptyString(config.endpoint) ??
    toNonEmptyString(config.baseUrl) ??
    toNonEmptyString(config.baseURL);

  if (!endpoint) return undefined;

  try {
    // Require absolute URL, consistent with core ProviderInstanceSchema
    new URL(endpoint);
  } catch {
    throw new Error('endpoint must be a valid absolute URL');
  }

  return endpoint;
}

function assertConfigHasNoCredentials(config: Record<string, unknown>): void {
  const forbiddenKeys = ['apiKey', 'api_key', 'token', 'accessToken', 'authorization'];
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      throw new Error(`Connection config MUST NOT include credentials (${key})`);
    }
  }
}

function mapCatalogModelToModelInfo(model: CatalogModel, providerId: string) {
  return {
    modelId: model.id,
    name: model.name,
    providerId,
    contextWindow: model.context_window,
    maxOutput: model.default_max_tokens,
    supportsThinking: !!model.can_reason || !!model.has_reasoning_effort,
    supportsImages: !!model.supports_attachments,
  };
}

type JobType = 'shell' | 'subagent';
type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

type JobState = {
  jobId: string;
  parentJobId?: string;
  type: JobType;
  status: JobStatus;
  description?: string;
  command?: string;
  subagentContent?: unknown[];
  startedAt: string;
  originTurnId?: string;
  originTurnSeq?: number;
  exitCode?: number;
  outputPath: string;
  proc?: ChildProcess;
  childPeer?: JsonRpcPeer;
  childSessionId?: string;
  childTransportClose?: () => void;
  finished: boolean;
  completion: Promise<void>;
  resolveCompletion: () => void;
};

function ensureJobLogDir(sessionDir: string): string {
  const dir = join(sessionDir, JOB_LOG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function getJobOutputPath(sessionDir: string, jobId: string): string {
  return join(ensureJobLogDir(sessionDir), `${jobId}.log`);
}

function extractTextFromContentBlocks(content: unknown[]): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (b) =>
        b &&
        typeof b === 'object' &&
        (b as any).type === 'text' &&
        typeof (b as any).text === 'string'
    )
    .map((b) => String((b as any).text))
    .join('\n');
}

function toolKindFromName(name: string): ToolInfo['kind'] {
  if (name === 'file_read') return 'read';
  if (name === 'file_find') return 'search';
  if (name === 'ripgrep_search') return 'search';
  if (name === 'url_fetch') return 'fetch';
  if (name === 'bash') return 'execute';
  if (name === 'file_write') return 'edit';
  if (name === 'file_edit') return 'edit';
  return 'other';
}

function protocolToolInfoForCoreTool(tool: CoreTool): ToolInfo {
  const kind = toolKindFromName(tool.name);
  return {
    name: tool.name,
    description: tool.description,
    kind,
    inputSchema: tool.inputSchema as any,
    requiresPermission: kind !== 'read' && kind !== 'search',
  };
}

function protocolToolResultFromCore(result: CoreToolResult): ToolResult {
  const outcome: ToolResult['outcome'] =
    result.status === 'completed'
      ? 'completed'
      : result.status === 'denied'
        ? 'denied'
        : result.status === 'aborted'
          ? 'cancelled'
          : 'failed';

  const content: ToolResult['content'] = (result.content || []).map((c) => {
    if (c.type === 'text') return { type: 'text', text: c.text ?? '' };
    if (c.type === 'image')
      return { type: 'image', data: c.data ?? '', mediaType: 'application/octet-stream' };
    if (c.type === 'resource') return { type: 'text', text: c.uri ?? '' };
    return { type: 'text', text: '' };
  });

  return { outcome, content, ...(result.metadata ? { meta: result.metadata as any } : {}) };
}

function coreToolResultFromProtocol(result: ToolResult, toolCallId: string): CoreToolResult {
  const status: CoreToolResult['status'] =
    result.outcome === 'completed'
      ? 'completed'
      : result.outcome === 'denied'
        ? 'denied'
        : result.outcome === 'cancelled'
          ? 'aborted'
          : 'failed';

  const content: CoreToolResult['content'] = result.content.map((c) => {
    if (c.type === 'text') return { type: 'text', text: c.text };
    if (c.type === 'json') return { type: 'text', text: JSON.stringify(c.data, null, 2) };
    if (c.type === 'image') return { type: 'image', data: c.data };
    if (c.type === 'error') return { type: 'text', text: c.message };
    return { type: 'text', text: '' };
  });

  return {
    id: toolCallId,
    content,
    status,
    ...(result.meta ? { metadata: result.meta } : {}),
  };
}

function shouldAskPermission(
  approvalMode: AgentServerState['config']['approvalMode'],
  toolKind: ReturnType<typeof toolKindFromName>
): boolean {
  if (approvalMode === 'dangerouslySkipPermissions' || approvalMode === 'approve') return false;
  if (approvalMode === 'deny') return false;

  if (approvalMode === 'approveReads') {
    return toolKind !== 'read' && toolKind !== 'search';
  }

  if (approvalMode === 'approveEdits') {
    return toolKind !== 'read' && toolKind !== 'search' && toolKind !== 'edit';
  }

  // ask
  return toolKind !== 'read' && toolKind !== 'search';
}

function isTestProviderEnabled(): boolean {
  return process.env.LACE_AGENT_TEST_PROVIDER === '1';
}

async function createProviderForTurn(options: {
  connectionId?: string;
  modelId?: string;
}): Promise<AIProvider> {
  if (isTestProviderEnabled()) {
    return new TestAgentProvider();
  }

  const connectionId = toNonEmptyString(options.connectionId);
  const modelId = toNonEmptyString(options.modelId);
  if (!connectionId || !modelId) {
    throw new Error('Missing provider configuration: connectionId and modelId are required');
  }

  const registry = ProviderRegistry.getInstance();
  return await registry.createProviderFromInstanceAndModel(connectionId, modelId);
}

function createToolExecutorForMode(executionMode: 'plan' | 'execute'): {
  executor: ToolExecutor;
  toolsForProvider: CoreTool[];
} {
  const executor = new ToolExecutor();
  executor.registerAllAvailableTools();

  const allTools = executor.getAllTools();
  const toolsForProvider =
    executionMode === 'plan'
      ? allTools.filter((t) => {
          const kind = toolKindFromName(t.name);
          return kind === 'read' || kind === 'search';
        })
      : allTools;

  return { executor, toolsForProvider };
}

function buildProviderMessagesFromDurableEvents(sessionDir: string): ProviderMessage[] {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return [];
  }

  const messages: ProviderMessage[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; data?: Record<string, unknown> };
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      const data = typeof parsed.data === 'object' && parsed.data ? parsed.data : {};

      if (type === 'prompt') {
        const content = extractTextFromContentBlocks((data as any).content);
        if (content.trim()) messages.push({ role: 'user', content });
        continue;
      }

      if (type === 'context_injected') {
        const content = extractTextFromContentBlocks((data as any).content);
        if (content.trim()) messages.push({ role: 'system', content });
        continue;
      }

      if (type === 'message') {
        const content =
          typeof (data as any).content === 'string'
            ? (data as any).content
            : extractTextFromContentBlocks((data as any).content);
        messages.push({ role: 'assistant', content: content ?? '' });
        continue;
      }

      if (type === 'tool_use') {
        const toolCallId = toNonEmptyString((data as any).toolCallId);
        const name = toNonEmptyString((data as any).name);
        const input = (data as any).input;
        const result = (data as any).result as ToolResult | undefined;
        if (!toolCallId || !name) continue;

        const toolCall: CoreToolCall = {
          id: toolCallId,
          name,
          arguments: typeof input === 'object' && input ? (input as any) : {},
        };

        if (messages.length === 0 || messages[messages.length - 1]!.role !== 'assistant') {
          messages.push({ role: 'assistant', content: '', toolCalls: [toolCall] });
        } else {
          const last = messages[messages.length - 1]!;
          last.toolCalls = [...(last.toolCalls || []), toolCall];
        }

        if (result) {
          const coreResult = coreToolResultFromProtocol(result, toolCallId);
          const last = messages[messages.length - 1];
          const canAppendToUser =
            last && last.role === 'user' && last.toolResults && last.toolResults.length > 0;
          if (canAppendToUser) {
            last.toolResults!.push(coreResult);
          } else {
            messages.push({ role: 'user', content: '', toolResults: [coreResult] });
          }
        }

        continue;
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  return messages;
}

function deriveFilesReadFromDurableEvents(sessionDir: string, workDir: string): Set<string> {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return new Set();
  }

  const read = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; data?: any };
      if (parsed.type !== 'tool_use') continue;
      const data = parsed.data ?? {};
      if (data.name !== 'file_read') continue;
      const result = data.result as ToolResult | undefined;
      if (!result || result.outcome !== 'completed') continue;
      const input = data.input ?? {};
      const p = toNonEmptyString(input.path);
      if (!p) continue;
      const absolute = isAbsolutePath(p) ? p : resolvePath(workDir, p);
      read.add(absolute);
    } catch {
      // ignore malformed lines
    }
  }
  return read;
}

export type AgentServerState = {
  initialized: boolean;
  activeSession: LoadedSession | null;
  config: {
    executionMode: 'plan' | 'execute';
    approvalMode:
      | 'ask'
      | 'approveReads'
      | 'approveEdits'
      | 'approve'
      | 'deny'
      | 'dangerouslySkipPermissions';
    connectionId?: string;
    modelId?: string;
    maxBudgetUsd?: number;
    maxThinkingTokens?: number;
  };
  activeTurn: null | {
    turnId: string;
    startedAt: string;
    status: 'running' | 'awaiting_permission';
    abortController: AbortController;
  };
  providerCatalog: ProviderCatalogManager;
  providerCatalogLoaded: boolean;
  providerInstances: ProviderInstanceManager;
  jobs: Map<string, JobState>;
  sessionMutex: Promise<void>;
  jobStreaming: 'full' | 'coalesced' | 'none';
};

export function createAgentServerState(): AgentServerState {
  return {
    initialized: false,
    activeSession: null,
    config: { executionMode: 'execute', approvalMode: 'ask' },
    activeTurn: null,
    providerCatalog: new ProviderCatalogManager(),
    providerCatalogLoaded: false,
    providerInstances: new ProviderInstanceManager(),
    jobs: new Map(),
    sessionMutex: Promise.resolve(),
    jobStreaming: 'full',
  };
}

export function registerAgentRpcMethods(peer: JsonRpcPeer, state: AgentServerState): void {
  const runExclusive = async <T>(work: () => Promise<T> | T): Promise<T> => {
    const previous = state.sessionMutex;
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    state.sessionMutex = previous.then(() => next);
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  };

  const emitSessionUpdate = async (
    update: SessionUpdate,
    context?: { turnId?: string; turnSeq?: number; jobId?: string }
  ) => {
    if (!state.activeSession) return;

    await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      peer.notify('session/update', {
        sessionId: state.activeSession!.meta.sessionId,
        streamSeq: sessionState.nextStreamSeq,
        turnId: context?.turnId,
        turnSeq: context?.turnSeq,
        jobId: context?.jobId,
        ...update,
      });
      writeSessionState(state.activeSession!.dir, {
        ...sessionState,
        nextStreamSeq: sessionState.nextStreamSeq + 1,
      });
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });
  };

  const finalizeJob = async (job: JobState, options: { exitCode?: number } = {}) => {
    if (!state.activeSession) return;
    if (job.finished) {
      job.resolveCompletion();
      return;
    }

    if (job.status === 'running') {
      job.status = 'failed';
    }

    if (typeof options.exitCode === 'number') {
      job.exitCode = options.exitCode;
    }

    job.proc = undefined;
    job.childPeer = undefined;
    job.childSessionId = undefined;
    job.childTransportClose = undefined;
    job.finished = true;

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'job_finished',
        data: {
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          outcome: job.status,
          ...(typeof options.exitCode === 'number' ? { exitCode: options.exitCode } : {}),
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    await emitSessionUpdate({
      type: 'job_finished',
      jobId: job.jobId,
      parentJobId: job.parentJobId,
      ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
      outcome: job.status,
    });

    job.resolveCompletion();
  };

  const requestPermissionFromClient = async (request: {
    sessionId: string;
    turnId: string;
    turnSeq: number;
    jobId?: string;
    toolCallId: string;
    tool: string;
    kind?: string;
    resource: string;
    options: Array<{ optionId: string; label: string }>;
    input: Record<string, unknown>;
  }): Promise<{ decision?: string; updatedInput?: Record<string, unknown> }> => {
    const requestedAt = new Date().toISOString();
    const { requestId, result } = peer.requestWithId('session/request_permission', {
      sessionId: request.sessionId,
      turnId: request.turnId,
      turnSeq: request.turnSeq,
      jobId: request.jobId,
      tool: request.tool,
      kind: request.kind,
      resource: request.resource,
      options: request.options,
      requestedAt,
      toolCallId: request.toolCallId,
    });

    await runExclusive(() => {
      const next = readSessionState(state.activeSession!.dir);
      next.pendingPermissions = next.pendingPermissions ?? [];
      next.pendingPermissions.push({
        requestId: String(requestId),
        toolCallId: request.toolCallId,
        turnId: request.turnId,
        turnSeq: request.turnSeq,
        jobId: request.jobId,
        tool: request.tool,
        kind: request.kind,
        resource: request.resource,
        options: request.options,
        requestedAt,
        input: request.input,
      });
      writeSessionState(state.activeSession!.dir, next);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    const decision = (await result) as {
      decision?: string;
      updatedInput?: Record<string, unknown>;
    };

    await runExclusive(() => {
      const next = readSessionState(state.activeSession!.dir);
      next.pendingPermissions = (next.pendingPermissions ?? []).filter(
        (p) => p.toolCallId !== request.toolCallId
      );
      writeSessionState(state.activeSession!.dir, next);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    return decision;
  };

  const startShellJob = async (options: {
    command: string;
    description?: string;
    parentJobId?: string;
    turnContext?: { turnId: string; turnSeq: number };
  }): Promise<{ jobId: string }> => {
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };

    const jobId = `job_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const outputPath = getJobOutputPath(state.activeSession.dir, jobId);

    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    const job: JobState = {
      jobId,
      parentJobId: options.parentJobId,
      type: 'shell',
      status: 'running',
      description: options.description,
      command: options.command,
      startedAt,
      originTurnId: options.turnContext?.turnId,
      originTurnSeq: options.turnContext?.turnSeq,
      outputPath,
      finished: false,
      completion,
      resolveCompletion,
    };

    state.jobs.set(jobId, job);

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'job_started',
        turnId: options.turnContext?.turnId,
        turnSeq: options.turnContext?.turnSeq,
        data: {
          jobId,
          parentJobId: options.parentJobId,
          jobType: 'shell',
          description: options.description,
          command: options.command,
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    await emitSessionUpdate(
      {
        type: 'job_started',
        jobId,
        parentJobId: options.parentJobId,
        jobType: 'shell',
        description: options.description,
      },
      options.turnContext
        ? { turnId: options.turnContext.turnId, turnSeq: options.turnContext.turnSeq }
        : undefined
    );

    void runShellJobProcess(job);
    return { jobId };
  };

  const runShellJobProcess = (job: JobState) => {
    void (async () => {
      if (!state.activeSession) return;
      if (job.proc || job.finished) return;

      const sessionState = readSessionState(state.activeSession.dir);
      const effectiveConfig = sessionState.config
        ? { ...state.config, ...sessionState.config }
        : state.config;

      const requiresPermission =
        shellExecTool.requiresPermission &&
        effectiveConfig.approvalMode !== 'approve' &&
        effectiveConfig.approvalMode !== 'dangerouslySkipPermissions' &&
        effectiveConfig.approvalMode !== 'deny';

      if (effectiveConfig.approvalMode === 'deny') {
        job.status = 'cancelled';
        await finalizeJob(job);
        return;
      }

      if (requiresPermission) {
        const toolCallId = `tool_${randomUUID()}`;
        const toolInput = { command: job.command ?? '' } as Record<string, unknown>;
        const permissionTurnId = job.originTurnId ?? `turn_${randomUUID()}`;
        const permissionTurnSeq = job.originTurnSeq ?? 0;

        await emitSessionUpdate({
          type: 'job_update',
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          jobType: 'shell',
          channel: 'internal',
          update: {
            type: 'tool_use',
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: toolInput,
            status: 'awaiting_permission',
          },
        });

        const decision = await requestPermissionFromClient({
          sessionId: state.activeSession.meta.sessionId,
          turnId: permissionTurnId,
          turnSeq: permissionTurnSeq,
          jobId: job.jobId,
          toolCallId,
          tool: shellExecTool.name,
          kind: shellExecTool.kind,
          resource: String(job.command ?? ''),
          options: [
            { optionId: 'allow', label: 'Allow' },
            { optionId: 'deny', label: 'Deny' },
          ],
          input: toolInput,
        });

        if (job.finished || job.status === 'cancelled') {
          return;
        }

        if (decision?.decision !== 'allow') {
          const denied: ToolResult = {
            outcome: 'denied',
            content: [{ type: 'error', message: 'Denied by user' }],
          };

          await emitSessionUpdate({
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'shell',
            channel: 'internal',
            update: {
              type: 'tool_use',
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: toolInput,
              status: 'denied',
              result: denied,
            },
          });

          job.status = 'cancelled';
          await finalizeJob(job);
          return;
        }
      }

      const proc = spawn(job.command ?? '', {
        cwd: state.activeSession.meta.workDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      job.proc = proc;

      proc.stdout!.setEncoding('utf8');
      proc.stderr!.setEncoding('utf8');

      const appendOutput = async (chunk: string) => {
        if (!state.activeSession) return;
        await runExclusive(() => {
          appendFileSync(job.outputPath, chunk, { encoding: 'utf8' });
        });
      };

      const onStdout = async (chunk: string) => {
        await appendOutput(chunk);
        if (state.jobStreaming === 'none') return;
        await emitSessionUpdate({
          type: 'job_update',
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          jobType: 'shell',
          channel: 'stdout',
          update: { type: 'text_delta', text: chunk },
        });
      };

      const onStderr = async (chunk: string) => {
        await appendOutput(chunk);
        if (state.jobStreaming === 'none') return;
        await emitSessionUpdate({
          type: 'job_update',
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          jobType: 'shell',
          channel: 'stderr',
          update: { type: 'text_delta', text: chunk },
        });
      };

      proc.stdout!.on('data', (chunk) => void onStdout(chunk as string));
      proc.stderr!.on('data', (chunk) => void onStderr(chunk as string));

      proc.on('close', (code) => {
        void (async () => {
          if (job.finished) {
            job.resolveCompletion();
            return;
          }

          const exitCode = code ?? 0;
          if (job.status !== 'cancelled') {
            job.status = exitCode === 0 ? 'completed' : 'failed';
          }

          await finalizeJob(job, { exitCode });
        })();
      });
    })();
  };

  const runSubagentJobProcess = (job: JobState) => {
    void (async () => {
      if (!state.activeSession) return;
      if (job.proc || job.finished) return;
      if (!job.subagentContent || !Array.isArray(job.subagentContent)) {
        job.status = 'failed';
        await finalizeJob(job);
        return;
      }

      const childProc = spawn(process.execPath, [process.argv[1] ?? ''], {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      job.proc = childProc;

      const childTransport = createNdjsonStdioTransport({
        readable: childProc.stdout,
        writable: childProc.stdin,
      });
      job.childTransportClose = childTransport.close;

      const childPeer = new JsonRpcPeer(childTransport, { idPrefix: 'c_' });
      job.childPeer = childPeer;

      const appendJobOutput = async (text: string) => {
        if (!state.activeSession) return;
        await runExclusive(() => {
          appendFileSync(job.outputPath, text, { encoding: 'utf8' });
        });
      };

      childPeer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        const type = p.type;

        if (type === 'text_delta' && typeof p.text === 'string') {
          await appendJobOutput(p.text);
          await emitSessionUpdate({
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'subagent',
            channel: 'internal',
            update: { type: 'text_delta', text: p.text },
          });
          return undefined;
        }

        if (type === 'tool_use' && typeof p.toolCallId === 'string' && typeof p.name === 'string') {
          const namespacedToolCallId = `${job.jobId}:${p.toolCallId}`;
          await emitSessionUpdate({
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'subagent',
            channel: 'internal',
            update: {
              type: 'tool_use',
              toolCallId: namespacedToolCallId,
              name: p.name,
              kind: typeof p.kind === 'string' ? (p.kind as any) : undefined,
              input: (typeof p.input === 'object' && p.input ? (p.input as any) : {}) as Record<
                string,
                unknown
              >,
              status: p.status as any,
              ...(p.result ? { result: p.result as any } : {}),
            },
          });
          return undefined;
        }

        if (type === 'context_injected') {
          await emitSessionUpdate({
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'subagent',
            channel: 'internal',
            update: p as any,
          });
          return undefined;
        }

        return undefined;
      });

      childPeer.onRequest('session/request_permission', async (params) => {
        const p = params as Record<string, unknown>;

        const childToolCallId =
          typeof p.toolCallId === 'string' ? p.toolCallId : `tool_${randomUUID()}`;
        const namespacedToolCallId = `${job.jobId}:${childToolCallId}`;

        const turnId =
          typeof p.turnId === 'string' ? p.turnId : (job.originTurnId ?? `turn_${randomUUID()}`);
        const turnSeq = typeof p.turnSeq === 'number' ? p.turnSeq : (job.originTurnSeq ?? 0);

        const decision = await requestPermissionFromClient({
          sessionId: state.activeSession!.meta.sessionId,
          turnId,
          turnSeq,
          jobId: job.jobId,
          toolCallId: namespacedToolCallId,
          tool: typeof p.tool === 'string' ? p.tool : 'unknown',
          kind: typeof p.kind === 'string' ? p.kind : undefined,
          resource: typeof p.resource === 'string' ? p.resource : '',
          options: Array.isArray(p.options)
            ? (p.options as any)
            : [
                { optionId: 'allow', label: 'Allow' },
                { optionId: 'deny', label: 'Deny' },
              ],
          input: (typeof p.input === 'object' && p.input ? (p.input as any) : {}) as Record<
            string,
            unknown
          >,
        });

        if (job.finished || job.status === 'cancelled') {
          return { decision: 'deny' };
        }

        return { decision: decision.decision ?? 'deny', updatedInput: decision.updatedInput };
      });

      try {
        await childPeer.request('initialize', {
          protocolVersion: '1.0',
          capabilities: { 'ent/jobStreaming': state.jobStreaming },
          config: { approvalMode: 'ask' },
        });

        const created = (await childPeer.request('session/new', {
          workDir: state.activeSession.meta.workDir,
        })) as { sessionId: string };
        job.childSessionId = created.sessionId;

        await childPeer.request('session/prompt', { content: job.subagentContent });

        if (job.status !== 'cancelled') job.status = 'completed';
      } catch {
        if (job.status !== 'cancelled') job.status = 'failed';
      } finally {
        try {
          childPeer.close();
        } catch {
          // ignore
        }

        try {
          job.childTransportClose?.();
        } catch {
          // ignore
        }

        if (childProc.exitCode === null) {
          childProc.kill('SIGTERM');
          await new Promise<void>((resolve) => childProc.once('exit', () => resolve()));
        }

        await finalizeJob(job);
      }
    })();
  };

  peer.onRequest('initialize', async (params: unknown) => {
    const parsed = params as
      | {
          protocolVersion?: string;
          capabilities?: { 'ent/jobStreaming'?: 'full' | 'coalesced' | 'none' };
          config?: {
            approvalMode?: string;
            executionMode?: string;
            providerId?: string;
            connectionId?: string;
            modelId?: string;
            maxBudgetUsd?: number;
            maxThinkingTokens?: number;
          };
        }
      | undefined;

    state.initialized = true;
    if (parsed?.config?.executionMode === 'plan') state.config.executionMode = 'plan';
    if (parsed?.config?.executionMode === 'execute') state.config.executionMode = 'execute';

    const approvalMode = parsed?.config?.approvalMode;
    if (
      approvalMode === 'ask' ||
      approvalMode === 'approveReads' ||
      approvalMode === 'approveEdits' ||
      approvalMode === 'approve' ||
      approvalMode === 'deny' ||
      approvalMode === 'dangerouslySkipPermissions'
    ) {
      state.config.approvalMode = approvalMode;
    }

    if (typeof parsed?.config?.connectionId === 'string')
      state.config.connectionId = parsed.config.connectionId;
    if (typeof parsed?.config?.modelId === 'string') state.config.modelId = parsed.config.modelId;
    if (typeof parsed?.config?.maxBudgetUsd === 'number')
      state.config.maxBudgetUsd = parsed.config.maxBudgetUsd;
    if (typeof parsed?.config?.maxThinkingTokens === 'number')
      state.config.maxThinkingTokens = parsed.config.maxThinkingTokens;

    const jobStreaming = parsed?.capabilities?.['ent/jobStreaming'];
    if (jobStreaming === 'full' || jobStreaming === 'coalesced' || jobStreaming === 'none') {
      state.jobStreaming = jobStreaming;
    }

    const { toolsForProvider } = createToolExecutorForMode('execute');
    const toolInfos: ToolInfo[] = [];
    const seenToolNames = new Set<string>();
    for (const info of [shellExecTool, ...toolsForProvider.map(protocolToolInfoForCoreTool)]) {
      if (seenToolNames.has(info.name)) continue;
      seenToolNames.add(info.name);
      toolInfos.push(info);
    }

    return {
      protocolVersion: '1.0',
      agentInfo: { name: 'lace-agent', version: '0.1.0' },
      capabilities: {
        streaming: true,
        multiTurn: true,
        tools: toolInfos,
        'ent/contextInjection': true,
        'ent/backgroundJobs': true,
        'ent/fileCheckpointing': false,
        'ent/structuredOutput': false,
        'ent/providers': { list: true, connections: true, models: true },
      },
    };
  });

  peer.onRequest('ent/agent/ping', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    return { ok: true, timestamp: new Date().toISOString() };
  });

  peer.onRequest('ent/agent/status', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const effectiveConfig = state.activeSession?.state.config
      ? { ...state.config, ...state.activeSession.state.config }
      : state.config;

    const pendingPermissions: PermissionRequest[] = [];
    if (state.activeSession) {
      for (const pending of state.activeSession.state.pendingPermissions || []) {
        if (!pending.requestId) continue;
        pendingPermissions.push({
          requestId: pending.requestId,
          toolCallId: pending.toolCallId,
          sessionId: state.activeSession.meta.sessionId,
          turnId: pending.turnId,
          turnSeq: pending.turnSeq,
          jobId: pending.jobId,
          tool: pending.tool,
          kind: pending.kind,
          resource: pending.resource,
          options: pending.options,
          requestedAt: pending.requestedAt,
        });
      }
    }

    return {
      models: [],
      mcpServers: [],
      currentSession: state.activeSession
        ? {
            sessionId: state.activeSession.meta.sessionId,
            messageCount: 0,
            tokensUsed: 0,
            costUsd: 0,
            connectionId: effectiveConfig.connectionId,
            modelId: effectiveConfig.modelId,
          }
        : undefined,
      currentTurn: state.activeTurn
        ? {
            turnId: state.activeTurn.turnId,
            status: state.activeTurn.status,
            startedAt: state.activeTurn.startedAt,
          }
        : undefined,
      pendingPermissions,
      limits: {
        maxBudgetUsd: effectiveConfig.maxBudgetUsd,
        budgetUsedUsd: 0,
      },
    };
  });

  const ensureProviderCatalogLoaded = async () => {
    if (!state.providerCatalogLoaded) {
      await state.providerCatalog.loadCatalogs();
      state.providerCatalogLoaded = true;
    }
  };

  const deriveJobsForActiveSession = (): Array<{
    jobId: string;
    parentJobId?: string;
    type: JobType;
    status: JobStatus;
    description?: string;
    command?: string;
    startTime: string;
    exitCode?: number;
  }> => {
    if (!state.activeSession) return [];

    const sessionDir = state.activeSession.dir;
    const eventsPath = join(sessionDir, 'events.jsonl');
    let raw = '';
    try {
      raw = readFileSync(eventsPath, 'utf8');
    } catch {
      return [];
    }

    const byId = new Map<
      string,
      {
        jobId: string;
        parentJobId?: string;
        type: JobType;
        status: JobStatus;
        description?: string;
        command?: string;
        startTime: string;
        exitCode?: number;
      }
    >();

    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { type?: string; timestamp?: string; data?: any };
        if (parsed.type !== 'job_started' && parsed.type !== 'job_finished') continue;
        const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined;
        const data = parsed.data ?? {};
        const jobId = toNonEmptyString(data.jobId);
        if (!jobId) continue;

        if (parsed.type === 'job_started') {
          const jobType = data.jobType === 'subagent' ? 'subagent' : 'shell';
          const startTime = timestamp ?? new Date().toISOString();
          byId.set(jobId, {
            jobId,
            parentJobId: toNonEmptyString(data.parentJobId) ?? undefined,
            type: jobType,
            status: 'running',
            description: toNonEmptyString(data.description) ?? undefined,
            command: toNonEmptyString(data.command) ?? undefined,
            startTime,
          });
        } else {
          const existing = byId.get(jobId);
          const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined;
          const outcome =
            data.outcome === 'completed' ||
            data.outcome === 'failed' ||
            data.outcome === 'cancelled'
              ? data.outcome
              : undefined;

          if (existing) {
            existing.status = outcome ?? existing.status;
            existing.exitCode = exitCode;
          } else {
            byId.set(jobId, {
              jobId,
              type: 'shell',
              status: outcome ?? 'failed',
              startTime: timestamp ?? new Date().toISOString(),
              exitCode,
            });
          }
        }
      } catch {
        // Ignore malformed lines.
      }
    }

    for (const job of byId.values()) {
      if (job.status === 'running' && !state.jobs.has(job.jobId)) {
        job.status = 'failed';
      }
    }

    return Array.from(byId.values());
  };

  peer.onRequest('ent/providers/list', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    await ensureProviderCatalogLoaded();

    const providers = state.providerCatalog
      .getAvailableProviders()
      .filter((p) => SUPPORTED_PROVIDER_TYPES.has(p.type.toLowerCase()))
      .map((p) => ({
        providerId: p.id,
        displayName: p.name,
        supportsConnections: true,
        supportsCatalogRefresh: false,
      }));

    return { providers };
  });

  peer.onRequest('ent/connections/list', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { providerId?: string } | undefined;
    const providerIdFilter = typeof parsed?.providerId === 'string' ? parsed.providerId : undefined;

    const instances = await state.providerInstances.loadInstances();
    const connections = Object.entries(instances.instances)
      .filter(([_id, inst]) =>
        providerIdFilter ? inst.catalogProviderId === providerIdFilter : true
      )
      .map(([connectionId, inst]) => {
        const credential = state.providerInstances.loadCredential(connectionId);
        const credentialState = credential?.apiKey ? 'ready' : 'missing';
        return {
          connectionId,
          providerId: inst.catalogProviderId,
          name: inst.displayName,
          credentialState,
        };
      });

    return { connections };
  });

  peer.onRequest('ent/connections/upsert', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as {
      providerId?: string;
      connection: { connectionId?: string; name: string; config: Record<string, unknown> };
    };

    const name = toNonEmptyString(parsed?.connection?.name);
    if (!name) throw new Error('connection.name is required');

    const config = parsed?.connection?.config;
    if (!config || typeof config !== 'object') throw new Error('connection.config is required');
    assertConfigHasNoCredentials(config);

    const requestedConnectionId = toNonEmptyString(parsed?.connection?.connectionId);
    const instances = await state.providerInstances.loadInstances();

    const isUpdate = !!requestedConnectionId && !!instances.instances[requestedConnectionId];
    const created = !isUpdate;

    const connectionId = requestedConnectionId ?? `conn_${randomUUID()}`;
    const existing = instances.instances[connectionId];

    if (existing) {
      if (
        typeof parsed.providerId === 'string' &&
        parsed.providerId.length > 0 &&
        parsed.providerId !== existing.catalogProviderId
      ) {
        throw new Error('connectionId is already paired to a different providerId');
      }

      const endpoint = getEndpointFromConfig(config);
      const timeoutInput = (config as any).timeout;
      const timeout = timeoutInput === undefined ? undefined : toPositiveInt(timeoutInput);
      if (timeoutInput !== undefined && timeout === null)
        throw new Error('timeout must be a positive integer');
      const retryPolicy = typeof config.retryPolicy === 'string' ? config.retryPolicy : undefined;
      const modelConfigInput = (config as any).modelConfig;
      const modelConfig =
        modelConfigInput === undefined
          ? undefined
          : typeof modelConfigInput === 'object' && modelConfigInput
            ? modelConfigInput
            : null;
      if (modelConfigInput !== undefined && modelConfig === null)
        throw new Error('modelConfig must be an object');

      await state.providerInstances.updateInstance(connectionId, {
        displayName: name,
        ...(endpoint ? { endpoint } : {}),
        ...(timeout ? { timeout } : {}),
        ...(retryPolicy ? { retryPolicy } : {}),
        ...(modelConfig ? { modelConfig: modelConfig as any } : {}),
      });

      return { connectionId, providerId: existing.catalogProviderId, created: false };
    }

    const providerId = toNonEmptyString(parsed?.providerId);
    if (!providerId) throw new Error('providerId is required when creating a new connection');

    await ensureProviderCatalogLoaded();
    const catalogProvider = state.providerCatalog.getProvider(providerId);
    if (!catalogProvider) throw new Error(`Unknown providerId: ${providerId}`);
    if (!SUPPORTED_PROVIDER_TYPES.has(catalogProvider.type.toLowerCase())) {
      throw new Error(`Provider is not supported by this agent: ${providerId}`);
    }

    const endpoint = getEndpointFromConfig(config);
    const timeoutInput = (config as any).timeout;
    const timeout = timeoutInput === undefined ? undefined : toPositiveInt(timeoutInput);
    if (timeoutInput !== undefined && timeout === null)
      throw new Error('timeout must be a positive integer');
    const retryPolicy = typeof config.retryPolicy === 'string' ? config.retryPolicy : undefined;
    const modelConfigInput = (config as any).modelConfig;
    const modelConfig =
      modelConfigInput === undefined
        ? undefined
        : typeof modelConfigInput === 'object' && modelConfigInput
          ? modelConfigInput
          : null;
    if (modelConfigInput !== undefined && modelConfig === null)
      throw new Error('modelConfig must be an object');

    await state.providerInstances.saveInstances({
      ...instances,
      instances: {
        ...instances.instances,
        [connectionId]: {
          displayName: name,
          catalogProviderId: providerId,
          ...(endpoint ? { endpoint } : {}),
          ...(timeout ? { timeout } : {}),
          ...(retryPolicy ? { retryPolicy } : {}),
          ...(modelConfig ? { modelConfig: modelConfig as any } : {}),
        },
      },
    });

    return { connectionId, providerId, created };
  });

  peer.onRequest('ent/connections/delete', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    await state.providerInstances.deleteInstance(connectionId);
    return { ok: true };
  });

  peer.onRequest('ent/connections/test', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string; modelId?: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance) return { ok: false, error: 'Connection not found' };

    const credential = state.providerInstances.loadCredential(connectionId);
    if (!credential?.apiKey) return { ok: false, error: 'Missing credentials' };

    await ensureProviderCatalogLoaded();
    const provider = state.providerCatalog.getProvider(instance.catalogProviderId);
    if (!provider) return { ok: false, error: 'Provider not found' };

    const requestedModelId = toNonEmptyString(parsed?.modelId);
    if (requestedModelId) {
      const hasModel = provider.models.some((m) => m.id === requestedModelId);
      if (!hasModel) return { ok: false, error: 'Model not found for provider' };
    }

    return { ok: true };
  });

  peer.onRequest('ent/connections/credentials/status', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId]) throw { code: 1, message: 'ConnectionNotFound' };

    const credential = state.providerInstances.loadCredential(connectionId);
    return {
      connectionId,
      state: credential?.apiKey ? 'ready' : 'missing',
    };
  });

  peer.onRequest('ent/connections/credentials/start', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string; method?: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId]) throw { code: 1, message: 'ConnectionNotFound' };

    const credential = state.providerInstances.loadCredential(connectionId);
    const requestedMethod = toNonEmptyString(parsed?.method);

    if (!requestedMethod && credential?.apiKey) {
      return { kind: 'ready' };
    }

    return {
      kind: 'needs_input',
      fields: [{ name: 'apiKey', label: 'API Key', secret: true }],
    };
  });

  peer.onRequest('ent/connections/credentials/submit', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string; values: Record<string, string> };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId]) throw { code: 1, message: 'ConnectionNotFound' };

    const values = parsed?.values;
    if (!values || typeof values !== 'object') return { ok: false, error: 'values is required' };

    const apiKey =
      toNonEmptyString((values as any).apiKey) ??
      toNonEmptyString((values as any).api_key) ??
      toNonEmptyString((values as any).key);

    if (!apiKey) return { ok: false, error: 'apiKey is required' };

    await state.providerInstances.saveCredential(connectionId, { apiKey });
    return { ok: true };
  });

  peer.onRequest('ent/connections/credentials/clear', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId]) throw { code: 1, message: 'ConnectionNotFound' };

    await state.providerInstances.clearCredential(connectionId);
    return { ok: true };
  });

  peer.onRequest('ent/models/list', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance) throw { code: 1, message: 'ConnectionNotFound' };

    await ensureProviderCatalogLoaded();
    const providerId = instance.catalogProviderId;
    const provider = state.providerCatalog.getProvider(providerId);
    if (!provider) throw new Error(`Unknown providerId: ${providerId}`);

    const models = provider.models.map((m) => mapCatalogModelToModelInfo(m, providerId));
    return { providerId, connectionId, models };
  });

  peer.onRequest('ent/job/list', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };

    const jobs = deriveJobsForActiveSession().map((j) => ({
      jobId: j.jobId,
      parentJobId: j.parentJobId,
      type: j.type,
      status: j.status,
      description: j.description,
      command: j.command,
      startTime: j.startTime,
    }));

    return { jobs };
  });

  peer.onRequest('ent/job/output', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };

    const parsed = params as {
      jobId: string;
      block?: boolean;
      timeout?: number;
      tailBytes?: number;
      afterOffset?: number;
    };

    const jobId = toNonEmptyString(parsed?.jobId);
    if (!jobId) throw new Error('jobId is required');

    const block = !!parsed.block;
    const timeout = typeof parsed.timeout === 'number' && parsed.timeout > 0 ? parsed.timeout : 0;

    const runningJob = state.jobs.get(jobId);
    if (block && runningJob?.status === 'running') {
      await Promise.race([
        runningJob.completion,
        timeout > 0
          ? new Promise<void>((resolve) => setTimeout(resolve, timeout))
          : new Promise<void>(() => {}),
      ]);
    }

    const jobs = deriveJobsForActiveSession();
    const record = jobs.find((j) => j.jobId === jobId);
    if (!record) throw { code: 1, message: 'JobNotFound' };

    const sessionDir = state.activeSession.dir;
    const outputPath = getJobOutputPath(sessionDir, jobId);

    let totalBytes = 0;
    try {
      totalBytes = statSync(outputPath).size;
    } catch {
      totalBytes = 0;
    }

    const afterOffset =
      typeof parsed.afterOffset === 'number' && parsed.afterOffset >= 0 ? parsed.afterOffset : 0;
    const tailBytes =
      typeof parsed.tailBytes === 'number' && parsed.tailBytes > 0 ? parsed.tailBytes : 0;

    const clampedAfter = Math.min(afterOffset, totalBytes);
    const startOffset =
      tailBytes > 0 ? Math.max(clampedAfter, totalBytes - tailBytes) : clampedAfter;
    const bytesToRead = Math.max(0, totalBytes - startOffset);

    let output = '';
    if (bytesToRead > 0) {
      const fd = openSync(outputPath, 'r');
      try {
        const buf = Buffer.allocUnsafe(bytesToRead);
        const read = readSync(fd, buf, 0, bytesToRead, startOffset);
        output = buf.subarray(0, read).toString('utf8');
      } finally {
        closeSync(fd);
      }
    }

    return {
      status: record.status,
      output,
      ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
      outputMeta: {
        totalBytes,
        returnedOffset: startOffset,
        returnedBytes: Buffer.byteLength(output, 'utf8'),
        truncated: startOffset > 0,
      },
      report: {
        summary:
          record.status === 'completed'
            ? 'Job completed'
            : record.status === 'cancelled'
              ? 'Job cancelled'
              : record.status === 'running'
                ? 'Job running'
                : 'Job failed',
        ...(record.status === 'failed' ? { error: 'Job failed' } : {}),
      },
    };
  });

  peer.onRequest('ent/job/kill', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };

    const parsed = params as { jobId: string };
    const jobId = toNonEmptyString(parsed?.jobId);
    if (!jobId) throw new Error('jobId is required');

    const job = state.jobs.get(jobId);
    if (!job || job.status !== 'running') return { success: false };

    job.status = 'cancelled';

    if (job.proc) {
      job.proc.kill('SIGTERM');
      return { success: true };
    }

    // Job is awaiting permission or otherwise not yet started; finalize immediately.
    await finalizeJob(job);

    return { success: true };
  });

  peer.onRequest('ent/job/inject', async (params: unknown) => {
    const parsed = params as { jobId: string; content: unknown[]; priority: string };
    const jobId = toNonEmptyString(parsed?.jobId);
    if (!jobId) return undefined;

    const job = state.jobs.get(jobId);
    if (!job || job.type !== 'subagent' || job.finished) return undefined;
    if (!job.childPeer) return undefined;

    const priority =
      parsed?.priority === 'immediate' ||
      parsed?.priority === 'normal' ||
      parsed?.priority === 'deferred'
        ? parsed.priority
        : 'normal';

    job.childPeer.notify('ent/session/inject', {
      content: Array.isArray(parsed?.content) ? parsed.content : [],
      priority,
    });

    return undefined;
  });

  peer.onRequest('session/new', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (state.activeSession) throw { code: 2, message: 'SessionBusy' };

    const parsed = params as { workDir: string; persona?: string; systemPrompt?: unknown };
    if (!parsed?.workDir) throw new Error('workDir is required');

    const sessionId = `sess_${randomUUID()}`;
    const created = new Date().toISOString();

    const sessionDir = getSessionDir(sessionId);
    writeSessionMeta(sessionDir, { sessionId, workDir: parsed.workDir, created });
    writeSessionState(sessionDir, {
      nextEventSeq: 1,
      nextStreamSeq: 1,
      config: {
        executionMode: state.config.executionMode,
        approvalMode: state.config.approvalMode,
        connectionId: state.config.connectionId,
        modelId: state.config.modelId,
        maxBudgetUsd: state.config.maxBudgetUsd,
        maxThinkingTokens: state.config.maxThinkingTokens,
      },
    });
    ensureSessionFiles(sessionDir);

    state.activeSession = loadSession(sessionId);

    return { sessionId, created };
  });

  peer.onRequest('session/list', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { workDir?: string } | undefined;
    const workDirFilter = parsed?.workDir;

    return { sessions: listSessions(workDirFilter) };
  });

  peer.onRequest('session/load', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { sessionId: string; fork?: boolean };
    if (!parsed?.sessionId) throw new Error('sessionId is required');
    if (!SessionIdSchema.safeParse(parsed.sessionId).success) {
      throw { code: -32602, message: 'InvalidParams' };
    }
    if (parsed.fork) throw new Error('fork not implemented');

    if (state.activeSession && state.activeSession.meta.sessionId !== parsed.sessionId) {
      throw { code: 2, message: 'SessionBusy' };
    }

    const loaded = loadSession(parsed.sessionId);
    state.activeSession = loaded;
    return {
      sessionId: parsed.sessionId,
      messageCount: 0,
      lastActive: loaded.meta.created,
    };
  });

  peer.onRequest('ent/session/configure', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };

    const parsed = params as Partial<{
      connectionId: string;
      modelId: string;
      maxThinkingTokens: number;
      maxBudgetUsd: number;
      approvalMode:
        | 'ask'
        | 'approveReads'
        | 'approveEdits'
        | 'approve'
        | 'deny'
        | 'dangerouslySkipPermissions';
    }>;

    const currentState = readSessionState(state.activeSession.dir);
    const currentConfig = currentState.config || {};
    const effectiveBefore = { ...state.config, ...currentConfig };
    const nextConfig = { ...currentConfig };
    const applied: string[] = [];

    if (
      typeof parsed.connectionId === 'string' &&
      parsed.connectionId !== effectiveBefore.connectionId
    ) {
      nextConfig.connectionId = parsed.connectionId;
      applied.push('connectionId');
    }

    if (typeof parsed.modelId === 'string' && parsed.modelId !== effectiveBefore.modelId) {
      nextConfig.modelId = parsed.modelId;
      applied.push('modelId');
    }

    if (
      typeof parsed.maxThinkingTokens === 'number' &&
      parsed.maxThinkingTokens !== effectiveBefore.maxThinkingTokens
    ) {
      nextConfig.maxThinkingTokens = parsed.maxThinkingTokens;
      applied.push('maxThinkingTokens');
    }

    if (
      typeof parsed.maxBudgetUsd === 'number' &&
      parsed.maxBudgetUsd !== effectiveBefore.maxBudgetUsd
    ) {
      nextConfig.maxBudgetUsd = parsed.maxBudgetUsd;
      applied.push('maxBudgetUsd');
    }

    if (
      parsed.approvalMode &&
      parsed.approvalMode !== effectiveBefore.approvalMode &&
      (parsed.approvalMode === 'ask' ||
        parsed.approvalMode === 'approveReads' ||
        parsed.approvalMode === 'approveEdits' ||
        parsed.approvalMode === 'approve' ||
        parsed.approvalMode === 'deny' ||
        parsed.approvalMode === 'dangerouslySkipPermissions')
    ) {
      nextConfig.approvalMode = parsed.approvalMode;
      applied.push('approvalMode');
    }

    const nextState = { ...currentState, config: nextConfig };
    writeSessionState(state.activeSession.dir, nextState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);

    const effectiveAfter = { ...state.config, ...(state.activeSession.state.config || {}) };

    return {
      applied,
      config: {
        connectionId: effectiveAfter.connectionId,
        modelId: effectiveAfter.modelId,
        maxThinkingTokens: effectiveAfter.maxThinkingTokens,
        maxBudgetUsd: effectiveAfter.maxBudgetUsd,
        approvalMode: effectiveAfter.approvalMode,
      },
    };
  });

  peer.onRequest('ent/session/inject', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };

    const parsed = params as { content: unknown[]; priority: 'immediate' | 'normal' | 'deferred' };
    const priority =
      parsed?.priority === 'immediate' ||
      parsed?.priority === 'normal' ||
      parsed?.priority === 'deferred'
        ? parsed.priority
        : 'normal';

    let sessionState: SessionState = readSessionState(state.activeSession.dir);
    const { nextState } = appendDurableEvent(state.activeSession.dir, sessionState, {
      type: 'context_injected',
      data: { content: Array.isArray(parsed?.content) ? parsed.content : [], priority },
    });
    sessionState = nextState;
    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = { ...state.activeSession, state: sessionState };

    peer.notify('session/update', {
      sessionId: state.activeSession.meta.sessionId,
      streamSeq: sessionState.nextStreamSeq,
      turnId: state.activeTurn?.turnId,
      turnSeq: state.activeTurn ? 0 : undefined,
      type: 'context_injected',
      priority,
      messageCount: 0,
    });

    writeSessionState(state.activeSession.dir, {
      ...sessionState,
      nextStreamSeq: sessionState.nextStreamSeq + 1,
    });

    state.activeSession = loadSession(state.activeSession.meta.sessionId);
    return undefined;
  });

  peer.onRequest('ent/session/events', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };

    const parsed = params as
      | { afterEventSeq?: number; limit?: number; types?: string[] }
      | undefined;
    const result = readDurableEvents(state.activeSession.dir, {
      afterEventSeq: parsed?.afterEventSeq,
      limit: parsed?.limit,
      types: parsed?.types,
    });

    return result;
  });

  peer.onRequest('session/cancel', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) return undefined;

    if (state.activeTurn) {
      state.activeTurn.abortController.abort();
      return undefined;
    }

    const sessionState = readSessionState(state.activeSession.dir);
    sessionState.pendingPermissions = [];
    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);
    return undefined;
  });

  peer.onRequest('session/prompt', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };
    if (state.activeTurn) throw { code: 2, message: 'SessionBusy' };

    const effectiveConfig = state.activeSession.state.config
      ? { ...state.config, ...state.activeSession.state.config }
      : state.config;

    const parsed = params as { content: unknown[] };
    const turnId = `turn_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();

    state.activeTurn = { turnId, startedAt, status: 'running', abortController };

    let sessionState: SessionState = readSessionState(state.activeSession.dir);
    let durableTurnSeq = 0;
    const writeAndAdvance = (event: { type: string; data: Record<string, unknown> }) => {
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: event.type,
        data: event.data,
        turnId,
        turnSeq: durableTurnSeq++,
      });
      sessionState = nextState;
    };

    writeAndAdvance({ type: 'prompt', data: { content: parsed.content } });
    writeAndAdvance({ type: 'turn_start', data: {} });

    const emitUpdate = (turnSeq: number, update: SessionUpdate) => {
      peer.notify('session/update', {
        sessionId: state.activeSession!.meta.sessionId,
        streamSeq: sessionState.nextStreamSeq,
        turnId,
        turnSeq,
        ...update,
      });
      sessionState = { ...sessionState, nextStreamSeq: sessionState.nextStreamSeq + 1 };
    };

    if (abortController.signal.aborted) {
      writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });

      writeSessionState(state.activeSession.dir, sessionState);
      state.activeSession = loadSession(state.activeSession.meta.sessionId);
      state.activeTurn = null;

      return {
        turnId,
        stopReason: 'cancelled',
        content: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const promptText = (parsed.content as any[])
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');

    const runMatch = promptText.match(/^\s*run:\s*(.+)\s*$/m);
    const command = runMatch?.[1]?.trim();

    const jobMatch = promptText.match(/^\s*job:\s*(.+)\s*$/m);
    const jobCommand = jobMatch?.[1]?.trim();

    const subagentMatch = promptText.match(/^\s*subagent:\s*(.+)\s*$/m);
    const subagentText = subagentMatch?.[1]?.trim();

    if (!command && !jobCommand && !subagentText) {
      const maxTurns =
        typeof (params as any)?.maxTurns === 'number' && Number.isFinite((params as any).maxTurns)
          ? Math.max(1, Math.trunc((params as any).maxTurns))
          : 10;

      const workDir = state.activeSession.meta.workDir;
      const filesRead = deriveFilesReadFromDurableEvents(state.activeSession.dir, workDir);

      const { executor: toolExecutor, toolsForProvider } = createToolExecutorForMode(
        effectiveConfig.executionMode
      );

      const provider = await createProviderForTurn({
        connectionId: effectiveConfig.connectionId,
        modelId: effectiveConfig.modelId,
      });

      let providerMessages = buildProviderMessagesFromDurableEvents(state.activeSession.dir);
      let finalAssistantContent = '';
      let stopReason: 'end_turn' | 'max_tokens' | 'max_turns' | 'cancelled' | 'budget_exceeded' =
        'end_turn';

      let streamTurnSeq = 0;

      let completedTurns = 0;

      try {
        for (; completedTurns < maxTurns; completedTurns++) {
          const messageTurnSeq = streamTurnSeq++;
          let streamedAny = false;

          const onToken = (payload: { token?: string }) => {
            if (abortController.signal.aborted) return;
            if (!payload?.token) return;
            streamedAny = true;
            emitUpdate(messageTurnSeq, { type: 'text_delta', text: payload.token });
          };

          provider.on('token', onToken);
          const response = await provider.createStreamingResponse(
            providerMessages,
            toolsForProvider,
            effectiveConfig.modelId || 'unknown-model',
            abortController.signal
          );
          provider.off('token', onToken);

          if (abortController.signal.aborted) {
            stopReason = 'cancelled';
            break;
          }

          const assistantText = typeof response.content === 'string' ? response.content : '';
          finalAssistantContent = assistantText;

          if (!streamedAny && assistantText.length > 0) {
            emitUpdate(messageTurnSeq, { type: 'text_delta', text: assistantText });
          }

          writeAndAdvance({ type: 'message', data: { content: assistantText } });

          const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
          if (toolCalls.length === 0) {
            stopReason = response.stopReason === 'max_tokens' ? 'max_tokens' : 'end_turn';
            break;
          }

          providerMessages = [
            ...providerMessages,
            {
              role: 'assistant',
              content: assistantText,
              toolCalls: toolCalls.map((tc) => ({
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              })),
            },
          ];

          let shouldContinue = true;

          for (const toolCall of toolCalls) {
            const toolCallId = toNonEmptyString(toolCall.id) ?? `tool_${randomUUID()}`;
            const toolName = toNonEmptyString(toolCall.name) ?? '';
            const toolInput =
              typeof toolCall.arguments === 'object' && toolCall.arguments
                ? (toolCall.arguments as Record<string, unknown>)
                : {};

            const toolTurnSeq = streamTurnSeq++;
            const kind = toolKindFromName(toolName);

            emitUpdate(toolTurnSeq, {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: toolInput,
              status: 'pending',
            });

            if (effectiveConfig.approvalMode === 'deny') {
              const denied: ToolResult = {
                outcome: 'denied',
                content: [{ type: 'error', message: 'Denied by policy' }],
              };

              emitUpdate(toolTurnSeq, {
                type: 'tool_use',
                toolCallId,
                name: toolName,
                kind,
                input: toolInput,
                status: 'denied',
                result: denied,
              });

              writeAndAdvance({
                type: 'tool_use',
                data: { toolCallId, name: toolName, kind, input: toolInput, result: denied },
              });

              shouldContinue = false;
              continue;
            }

            if (effectiveConfig.executionMode === 'plan' && kind !== 'read' && kind !== 'search') {
              const denied: ToolResult = {
                outcome: 'denied',
                content: [{ type: 'error', message: 'Tool denied in plan mode' }],
              };

              emitUpdate(toolTurnSeq, {
                type: 'tool_use',
                toolCallId,
                name: toolName,
                kind,
                input: toolInput,
                status: 'denied',
                result: denied,
              });

              writeAndAdvance({
                type: 'tool_use',
                data: { toolCallId, name: toolName, kind, input: toolInput, result: denied },
              });

              shouldContinue = false;
              continue;
            }

            const tool = toolExecutor.getTool(toolName);
            if (!tool) {
              const failed: ToolResult = {
                outcome: 'failed',
                content: [{ type: 'error', message: `Tool not found: ${toolName}` }],
              };

              emitUpdate(toolTurnSeq, {
                type: 'tool_use',
                toolCallId,
                name: toolName,
                kind,
                input: toolInput,
                status: 'failed',
                result: failed,
              });

              writeAndAdvance({
                type: 'tool_use',
                data: { toolCallId, name: toolName, kind, input: toolInput, result: failed },
              });

              shouldContinue = false;
              continue;
            }

            let finalInput = toolInput;

            const needsPermission = shouldAskPermission(effectiveConfig.approvalMode, kind);
            if (needsPermission) {
              state.activeTurn = {
                turnId,
                startedAt,
                status: 'awaiting_permission',
                abortController,
              };

              const options = [
                { optionId: 'allow', label: 'Allow' },
                { optionId: 'deny', label: 'Deny' },
              ];

              emitUpdate(toolTurnSeq, {
                type: 'tool_use',
                toolCallId,
                name: toolName,
                kind,
                input: toolInput,
                status: 'awaiting_permission',
              });

              type PendingPermission = NonNullable<SessionState['pendingPermissions']>[number];
              const pending: PendingPermission = {
                toolCallId,
                requestId: `perm_${toolCallId}`,
                turnId,
                turnSeq: toolTurnSeq,
                tool: toolName,
                kind,
                resource: toolName,
                options,
                requestedAt: new Date().toISOString(),
                input: toolInput,
              };

              sessionState.pendingPermissions = [
                ...(sessionState.pendingPermissions || []),
                pending,
              ];
              writeSessionState(state.activeSession.dir, sessionState);
              state.activeSession = { ...state.activeSession, state: sessionState };

              const { result } = peer.requestWithId('session/request_permission', {
                sessionId: state.activeSession.meta.sessionId,
                turnId,
                turnSeq: toolTurnSeq,
                toolCallId,
                tool: toolName,
                kind,
                resource: toolName,
                options,
              });

              const abortPromise = new Promise<never>((_, reject) => {
                abortController.signal.addEventListener(
                  'abort',
                  () => reject(new Error('cancelled')),
                  {
                    once: true,
                  }
                );
              });

              let permissionResponse: any;
              try {
                permissionResponse = await Promise.race([result, abortPromise]);
              } catch {
                sessionState.pendingPermissions = (sessionState.pendingPermissions || []).filter(
                  (p) => p.toolCallId !== toolCallId
                );
                writeSessionState(state.activeSession.dir, sessionState);
                state.activeSession = { ...state.activeSession, state: sessionState };

                const cancelled: ToolResult = {
                  outcome: 'cancelled',
                  content: [{ type: 'error', message: 'Cancelled' }],
                };

                emitUpdate(toolTurnSeq, {
                  type: 'tool_use',
                  toolCallId,
                  name: toolName,
                  kind,
                  input: toolInput,
                  status: 'cancelled',
                  result: cancelled,
                });

                writeAndAdvance({
                  type: 'tool_use',
                  data: { toolCallId, name: toolName, kind, input: toolInput, result: cancelled },
                });

                shouldContinue = false;
                continue;
              }

              sessionState.pendingPermissions = (sessionState.pendingPermissions || []).filter(
                (p) => p.toolCallId !== toolCallId
              );
              writeSessionState(state.activeSession.dir, sessionState);
              state.activeSession = { ...state.activeSession, state: sessionState };

              const decision = toNonEmptyString(permissionResponse?.decision);
              if (
                permissionResponse?.updatedInput &&
                typeof permissionResponse.updatedInput === 'object'
              ) {
                finalInput = permissionResponse.updatedInput as Record<string, unknown>;
              }

              if (decision === 'deny') {
                const denied: ToolResult = {
                  outcome: 'denied',
                  content: [{ type: 'error', message: 'Denied by user' }],
                };

                emitUpdate(toolTurnSeq, {
                  type: 'tool_use',
                  toolCallId,
                  name: toolName,
                  kind,
                  input: toolInput,
                  status: 'denied',
                  result: denied,
                });

                writeAndAdvance({
                  type: 'tool_use',
                  data: { toolCallId, name: toolName, kind, input: toolInput, result: denied },
                });

                shouldContinue = false;
                continue;
              }
            }

            emitUpdate(toolTurnSeq, {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: finalInput,
              status: 'running',
            });

            const coreResult = await toolExecutor.execute(
              { id: toolCallId, name: toolName, arguments: finalInput },
              {
                signal: abortController.signal,
                workingDirectory: workDir,
                toolTempRoot: join(state.activeSession.dir, 'tool-temp'),
                hasFileBeenRead: (p) =>
                  filesRead.has(isAbsolutePath(p) ? p : resolvePath(workDir, p)),
              }
            );

            if (toolName === 'file_read' && coreResult.status === 'completed') {
              const p = toNonEmptyString(finalInput.path);
              if (p) filesRead.add(isAbsolutePath(p) ? p : resolvePath(workDir, p));
            }

            const protocolResult = protocolToolResultFromCore(coreResult);
            const terminalStatus =
              protocolResult.outcome === 'completed'
                ? 'completed'
                : protocolResult.outcome === 'denied'
                  ? 'denied'
                  : protocolResult.outcome === 'cancelled'
                    ? 'cancelled'
                    : 'failed';

            emitUpdate(toolTurnSeq, {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: finalInput,
              status: terminalStatus,
              result: protocolResult,
            });

            writeAndAdvance({
              type: 'tool_use',
              data: { toolCallId, name: toolName, kind, input: finalInput, result: protocolResult },
            });

            providerMessages = [
              ...providerMessages,
              { role: 'user', content: '', toolResults: [coreResult] },
            ];

            if (coreResult.status !== 'completed') {
              shouldContinue = false;
            }
          }

          if (!shouldContinue) {
            break;
          }
        }

        if (abortController.signal.aborted) {
          stopReason = 'cancelled';
        }
      } finally {
        provider.cleanup();
      }

      if (stopReason === 'end_turn' && completedTurns >= maxTurns) {
        stopReason = 'max_turns';
      }

      writeAndAdvance({ type: 'turn_end', data: { stopReason } });
      writeSessionState(state.activeSession.dir, sessionState);
      state.activeSession = loadSession(state.activeSession.meta.sessionId);
      state.activeTurn = null;

      return {
        turnId,
        stopReason,
        content:
          finalAssistantContent.length > 0 ? [{ type: 'text', text: finalAssistantContent }] : [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const deferredJobs: JobState[] = [];
    let nextJobTurnSeq = 1;

    if (jobCommand && effectiveConfig.executionMode === 'execute') {
      const jobId = `job_${randomUUID()}`;
      const startedAt = new Date().toISOString();
      const outputPath = getJobOutputPath(state.activeSession.dir, jobId);

      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });

      const job: JobState = {
        jobId,
        type: 'shell',
        status: 'running',
        description: 'Background shell job',
        command: jobCommand,
        startedAt,
        originTurnId: turnId,
        originTurnSeq: nextJobTurnSeq,
        outputPath,
        finished: false,
        completion,
        resolveCompletion,
      };

      state.jobs.set(jobId, job);

      writeAndAdvance({
        type: 'job_started',
        data: { jobId, jobType: 'shell', description: job.description, command: jobCommand },
      });

      emitUpdate(nextJobTurnSeq++, {
        type: 'job_started',
        jobId,
        jobType: 'shell',
        description: job.description,
      });

      deferredJobs.push(job);
    }

    if (subagentText && effectiveConfig.executionMode === 'execute') {
      const jobId = `job_${randomUUID()}`;
      const startedAt = new Date().toISOString();
      const outputPath = getJobOutputPath(state.activeSession.dir, jobId);

      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });

      const job: JobState = {
        jobId,
        type: 'subagent',
        status: 'running',
        description: 'Subagent',
        command: subagentText,
        subagentContent: [{ type: 'text', text: subagentText }],
        startedAt,
        originTurnId: turnId,
        originTurnSeq: nextJobTurnSeq,
        outputPath,
        finished: false,
        completion,
        resolveCompletion,
      };

      state.jobs.set(jobId, job);

      writeAndAdvance({
        type: 'job_started',
        data: {
          jobId,
          jobType: 'subagent',
          description: job.description,
          command: subagentText,
        },
      });

      emitUpdate(nextJobTurnSeq++, {
        type: 'job_started',
        jobId,
        jobType: 'subagent',
        description: job.description,
      });

      deferredJobs.push(job);
    }

    if (command && effectiveConfig.executionMode === 'execute') {
      const toolCallId = `tool_${randomUUID()}`;
      const toolInput = { command } as Record<string, unknown>;
      let shouldExecuteTool = true;

      emitUpdate(1, {
        type: 'tool_use',
        toolCallId,
        name: shellExecTool.name,
        kind: shellExecTool.kind,
        input: toolInput,
        status: 'pending',
      });

      const requiresPermission =
        shellExecTool.requiresPermission &&
        effectiveConfig.approvalMode !== 'approve' &&
        effectiveConfig.approvalMode !== 'dangerouslySkipPermissions' &&
        effectiveConfig.approvalMode !== 'deny';

      if (effectiveConfig.approvalMode === 'deny') {
        const denied: ToolResult = {
          outcome: 'denied',
          content: [{ type: 'error', message: 'Denied by policy' }],
        };

        shouldExecuteTool = false;
        emitUpdate(1, {
          type: 'tool_use',
          toolCallId,
          name: shellExecTool.name,
          kind: shellExecTool.kind,
          input: toolInput,
          status: 'denied',
          result: denied,
        });

        writeAndAdvance({
          type: 'tool_use',
          data: {
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: toolInput,
            result: denied,
          },
        });
      } else {
        let finalInput = toolInput;

        if (requiresPermission) {
          state.activeTurn = { turnId, startedAt, status: 'awaiting_permission', abortController };

          const options = [
            { optionId: 'allow', label: 'Allow' },
            { optionId: 'deny', label: 'Deny' },
          ];

          emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: toolInput,
            status: 'awaiting_permission',
          });

          type PendingPermission = NonNullable<SessionState['pendingPermissions']>[number];
          const pending: PendingPermission = {
            toolCallId,
            turnId,
            turnSeq: 1,
            tool: shellExecTool.name,
            kind: shellExecTool.kind,
            resource: command,
            options,
            requestedAt: new Date().toISOString(),
            input: toolInput,
          };

          sessionState.pendingPermissions = [...(sessionState.pendingPermissions || []), pending];
          writeSessionState(state.activeSession.dir, sessionState);
          state.activeSession = { ...state.activeSession, state: sessionState };

          const { requestId, result } = peer.requestWithId('session/request_permission', {
            sessionId: state.activeSession.meta.sessionId,
            turnId,
            turnSeq: 1,
            toolCallId,
            tool: shellExecTool.name,
            kind: shellExecTool.kind,
            resource: command,
            options,
          });

          pending.requestId = String(requestId);
          sessionState.pendingPermissions = (sessionState.pendingPermissions || []).map((p) =>
            p.toolCallId === toolCallId ? pending : p
          );
          writeSessionState(state.activeSession.dir, sessionState);
          state.activeSession = { ...state.activeSession, state: sessionState };

          const abortPromise = new Promise<never>((_, reject) => {
            abortController.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
              once: true,
            });
          });

          let permissionResponse: any;
          try {
            permissionResponse = await Promise.race([result, abortPromise]);
          } catch {
            peer.abandonRequest(requestId);

            sessionState.pendingPermissions = (sessionState.pendingPermissions || []).filter(
              (p) => p.toolCallId !== toolCallId
            );
            writeSessionState(state.activeSession.dir, sessionState);
            state.activeSession = { ...state.activeSession, state: sessionState };

            const cancelled: ToolResult = {
              outcome: 'cancelled',
              content: [{ type: 'error', message: 'Cancelled' }],
            };

            emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: toolInput,
              status: 'cancelled',
              result: cancelled,
            });

            writeAndAdvance({
              type: 'tool_use',
              data: {
                toolCallId,
                name: shellExecTool.name,
                kind: shellExecTool.kind,
                input: toolInput,
                result: cancelled,
              },
            });
            writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });

            writeSessionState(state.activeSession.dir, sessionState);
            state.activeSession = loadSession(state.activeSession.meta.sessionId);
            state.activeTurn = null;

            return {
              turnId,
              stopReason: 'cancelled',
              content: [],
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }

          sessionState.pendingPermissions = (sessionState.pendingPermissions || []).filter(
            (p) => p.toolCallId !== toolCallId
          );
          writeSessionState(state.activeSession.dir, sessionState);
          state.activeSession = { ...state.activeSession, state: sessionState };
          state.activeTurn = { turnId, startedAt, status: 'running', abortController };

          const decision = permissionResponse?.decision;
          if (decision === 'deny') {
            const denied: ToolResult = {
              outcome: 'denied',
              content: [{ type: 'error', message: 'Denied' }],
            };

            shouldExecuteTool = false;
            emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: toolInput,
              status: 'denied',
              result: denied,
            });

            writeAndAdvance({
              type: 'tool_use',
              data: {
                toolCallId,
                name: shellExecTool.name,
                kind: shellExecTool.kind,
                input: toolInput,
                result: denied,
              },
            });
          } else {
            if (
              permissionResponse?.updatedInput &&
              typeof permissionResponse.updatedInput === 'object'
            ) {
              finalInput = permissionResponse.updatedInput as Record<string, unknown>;
            }

            emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: finalInput,
              status: 'running',
            });
          }
        } else {
          emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: finalInput,
            status: 'running',
          });
        }

        if (shouldExecuteTool && !abortController.signal.aborted) {
          const commandToRun = String((finalInput as any).command || '');
          const result = await runShellExec(
            { command: commandToRun },
            { defaultCwd: state.activeSession.meta.workDir, signal: abortController.signal }
          );

          emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: finalInput,
            status: result.outcome,
            result,
          });

          writeAndAdvance({
            type: 'tool_use',
            data: {
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: finalInput,
              result,
            },
          });

          if (result.outcome === 'cancelled') {
            writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });

            writeSessionState(state.activeSession.dir, sessionState);
            state.activeSession = loadSession(state.activeSession.meta.sessionId);
            state.activeTurn = null;

            return {
              turnId,
              stopReason: 'cancelled',
              content: [],
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }
        }
      }
    }

    writeAndAdvance({
      type: 'message',
      data: { content: [{ type: 'text', text: 'hello' }] },
    });
    writeAndAdvance({ type: 'turn_end', data: { stopReason: 'end_turn' } });

    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);
    state.activeTurn = null;

    for (const job of deferredJobs) {
      if (job.type === 'shell') runShellJobProcess(job);
      if (job.type === 'subagent') runSubagentJobProcess(job);
    }

    return {
      turnId,
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'hello' }],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  });
}
