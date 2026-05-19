#!/usr/bin/env node

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import readline from 'node:readline';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { asSessionId, createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { parseArgs } from './args';

type PermissionRequestParams = {
  sessionId?: string;
  turnId?: string;
  turnSeq?: number;
  jobId?: string;
  toolCallId?: string;
  tool?: string;
  kind?: string;
  resource?: string;
  options?: Array<{ optionId: string; label: string }>;
  requestedAt?: string;
};

function isCommandOnPath(command: string): boolean {
  if (process.platform === 'win32') {
    const r = spawnSync('where', [command], { stdio: 'ignore' });
    return r.status === 0;
  }
  const r = spawnSync('which', [command], { stdio: 'ignore' });
  return r.status === 0;
}

function defaultAgentCmd(): string {
  if (isCommandOnPath('lace-agent')) return 'lace-agent';
  const agentMainPath = fileURLToPath(new URL('../../agent/dist/main.js', import.meta.url));
  if (!existsSync(agentMainPath)) {
    throw new Error(
      'No default agent command found. Build the agent with `npm run build --workspace=packages/agent`, install `lace-agent`, or pass `--agent-cmd`.'
    );
  }
  return `${process.execPath} ${agentMainPath}`;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"<unserializable>"';
  }
}

function firstLine(text: string): string {
  const idx = text.indexOf('\n');
  if (idx === -1) return text;
  return text.slice(0, idx);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  context: string
): Promise<T> {
  if (!timeoutMs) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${context}`)), timeoutMs);
    void promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

type ActivePrompt = 'repl' | 'permission';

class AgentConnection {
  readonly peer: JsonRpcPeer;
  readonly proc: ChildProcessWithoutNullStreams;
  private readonly transportClose: () => void;

  constructor(options: { agentCmd: string; cwd: string }) {
    this.proc = spawn(options.agentCmd, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    const transport = createNdjsonStdioTransport({
      readable: this.proc.stdout,
      writable: this.proc.stdin,
    });
    this.transportClose = transport.close;
    this.peer = new JsonRpcPeer(transport, { idPrefix: 'c_' });
  }

  async shutdown(): Promise<void> {
    this.peer.close();
    this.transportClose();

    if (this.proc.exitCode !== null) return;

    this.proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      this.proc.once('exit', () => resolve());
    });
  }
}

function promptTextToContent(text: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text }];
}

type PendingPermission = {
  params: PermissionRequestParams;
  resolve: (value: { decision: string }) => void;
};

type JsonRpcErrorObject = {
  code?: number;
  message?: string;
  data?: unknown;
};

async function main(): Promise<void> {
  const parsedArgs = parseArgs(process.argv.slice(2));
  if (parsedArgs.kind === 'help') {
    process.stdout.write(parsedArgs.text);
    process.exit(parsedArgs.exitCode);
  }
  const args = parsedArgs.args;

  if (args.loadSessionId && args.explicitNew) {
    process.stderr.write('Error: --new and --load cannot be used together\n');
    process.exit(2);
  }

  const agentCmd = args.agentCmd ?? defaultAgentCmd();
  const conn = new AgentConnection({ agentCmd, cwd: args.workDir });

  conn.proc.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  conn.proc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    process.stderr.write(`\n[agent exited] code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
    process.exit(code ?? 1);
  });

  const toolInputsByToolCallId = new Map<string, Record<string, unknown>>();

  let activeSessionId: string | undefined;

  let activePrompt: ActivePrompt = 'repl';
  const replPrompt = 'lace> ';
  const permissionPrompt = 'permission> ';
  let promptShown = false;
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  let shuttingDown = false;

  let textStreamActive = false;
  let textStreamAtLineStart = true;

  const pendingPermissions: PendingPermission[] = [];
  let activePermission: PendingPermission | undefined;

  let pendingQuestionResolve: ((line: string) => void) | null = null;

  const endTextStream = () => {
    if (!textStreamActive) return;
    if (!textStreamAtLineStart) process.stdout.write('\n');
    textStreamActive = false;
    textStreamAtLineStart = true;
    promptShown = false;
    showPrompt();
  };

  const showPrompt = () => {
    if (!interactive) return;
    if (promptShown) return;
    if (textStreamActive && activePrompt === 'repl' && !pendingQuestionResolve) return;
    promptShown = true;
    process.stdout.write(activePrompt === 'permission' ? permissionPrompt : replPrompt);
  };

  const printBlock = (lines: string[]) => {
    if (promptShown || (textStreamActive && !textStreamAtLineStart)) process.stdout.write('\n');
    promptShown = false;
    textStreamAtLineStart = true;
    for (const line of lines) process.stdout.write(`${line}\n`);
    showPrompt();
  };

  const printLine = (line: string) => {
    printBlock([line]);
  };

  const describeError = (err: unknown): { message: string; isMissingProviderConfig: boolean } => {
    if (err && typeof err === 'object') {
      const maybe = err as JsonRpcErrorObject;
      if (typeof maybe.message === 'string' && maybe.message.length > 0) {
        return {
          message: maybe.message,
          isMissingProviderConfig: maybe.message.includes('Missing provider configuration'),
        };
      }
    }

    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : safeJsonStringify(err);
    return { message, isMissingProviderConfig: message.includes('Missing provider configuration') };
  };

  const askUser = async (question: string): Promise<string> => {
    printLine(question);
    return await new Promise<string>((resolve) => {
      pendingQuestionResolve = (line) => resolve(line.trim());
      showPrompt();
    });
  };

  const startNextPermissionIfNeeded = () => {
    if (pendingQuestionResolve) return;
    if (activePermission) return;
    const next = pendingPermissions.shift();
    if (!next) return;
    activePermission = next;
    activePrompt = 'permission';

    const p = next.params;
    const lines: string[] = [];
    lines.push('permission request:');
    lines.push(`  tool: ${p.tool ?? '<unknown>'}`);
    if (p.kind) lines.push(`  kind: ${p.kind}`);
    if (p.resource) lines.push(`  resource: ${p.resource}`);
    if (p.toolCallId) lines.push(`  toolCallId: ${p.toolCallId}`);
    if (p.turnId) lines.push(`  turnId: ${p.turnId}`);
    if (typeof p.turnSeq === 'number') lines.push(`  turnSeq: ${p.turnSeq}`);
    if (p.jobId) lines.push(`  jobId: ${p.jobId}`);

    if (p.toolCallId && toolInputsByToolCallId.has(p.toolCallId)) {
      lines.push(`  input: ${safeJsonStringify(toolInputsByToolCallId.get(p.toolCallId))}`);
    } else if (p.toolCallId) {
      lines.push('  input: <unavailable>');
    }

    const options = Array.isArray(p.options) ? p.options : [];
    if (options.length > 0) {
      lines.push('  options:');
      for (const o of options) lines.push(`    ${o.optionId} - ${o.label}`);
    } else {
      lines.push('  options: <unavailable>');
    }
    printBlock(lines);
  };

  conn.peer.onRequest('session/update', async (params) => {
    const p = params as Record<string, unknown>;
    const updateType = (p.type as string | undefined) ?? (p.update as any)?.type;

    const captureToolUse = (maybe: any) => {
      if (!maybe || maybe.type !== 'tool_use') return;
      if (typeof maybe.toolCallId !== 'string') return;
      if (!maybe.input || typeof maybe.input !== 'object') return;
      toolInputsByToolCallId.set(maybe.toolCallId, maybe.input as Record<string, unknown>);
    };

    if (updateType === 'tool_use') captureToolUse(p);
    if (p.type === 'job_update') captureToolUse((p as any).update);

    const writeTextDelta = (text: string) => {
      if (promptShown) process.stdout.write('\n');
      promptShown = false;
      textStreamActive = true;
      process.stdout.write(text);
      textStreamAtLineStart = text.endsWith('\n');
    };

    if (p.type === 'text_delta' && typeof (p as any).text === 'string') {
      writeTextDelta((p as any).text);
      return undefined;
    }

    if (p.type === 'job_update') {
      const inner = (p as any).update;
      if (inner?.type === 'text_delta' && typeof inner.text === 'string') {
        writeTextDelta(inner.text);
        return undefined;
      }
      if (inner?.type === 'turn_end') {
        endTextStream();
        return undefined;
      }
    }

    if (p.type === 'turn_end') {
      endTextStream();
      return undefined;
    }

    const summary = (() => {
      const type = p.type;
      if (type === 'tool_use') {
        const toolCallId = typeof (p as any).toolCallId === 'string' ? (p as any).toolCallId : '?';
        const name = typeof (p as any).name === 'string' ? (p as any).name : '?';
        const status = typeof (p as any).status === 'string' ? (p as any).status : '?';
        return `tool_use ${status} ${name} (${toolCallId})`;
      }
      if (type === 'job_started') {
        const jobId = typeof (p as any).jobId === 'string' ? (p as any).jobId : '?';
        const jobType = typeof (p as any).jobType === 'string' ? (p as any).jobType : '?';
        return `job_started ${jobType} (${jobId})`;
      }
      if (type === 'job_finished') {
        const jobId = typeof (p as any).jobId === 'string' ? (p as any).jobId : '?';
        const outcome = typeof (p as any).outcome === 'string' ? (p as any).outcome : '?';
        return `job_finished ${outcome} (${jobId})`;
      }
      if (type === 'job_update') {
        const jobId = typeof (p as any).jobId === 'string' ? (p as any).jobId : '?';
        const inner = (p as any).update;
        if (inner?.type === 'tool_use') {
          const toolCallId = typeof inner.toolCallId === 'string' ? inner.toolCallId : '?';
          const name = typeof inner.name === 'string' ? inner.name : '?';
          const status = typeof inner.status === 'string' ? inner.status : '?';
          return `job ${jobId} tool_use ${status} ${name} (${toolCallId})`;
        }
        return `job_update (${jobId})`;
      }
      return `update: ${safeJsonStringify(p)}`;
    })();

    printLine(summary);
    return undefined;
  });

  conn.peer.onRequest('session/request_permission', async (params) => {
    return await new Promise<{ decision: string }>((resolve) => {
      pendingPermissions.push({ params: params as PermissionRequestParams, resolve });
      if (!pendingQuestionResolve) startNextPermissionIfNeeded();
    });
  });

  const initializeParams: Record<string, unknown> = {
    protocolVersion: '1.0',
    clientInfo: { name: 'lace-cli', version: '0.1.0' },
    capabilities: { streaming: true, permissions: true, 'ent/jobStreaming': 'coalesced' },
  };
  if (args.approvalMode) initializeParams.config = { approvalMode: args.approvalMode };
  await withTimeout(
    conn.peer.request('initialize', initializeParams),
    args.timeoutMs,
    'initialize'
  );

  if (args.loadSessionId) {
    const sessionId = asSessionId(args.loadSessionId);
    await withTimeout(
      conn.peer.request('session/load', { sessionId, cwd: args.workDir, mcpServers: [] }),
      args.timeoutMs,
      'session/load'
    );
    activeSessionId = sessionId;
    printLine(`loaded session ${sessionId}`);
  } else {
    const created = (await withTimeout(
      conn.peer.request('session/new', { cwd: args.workDir, mcpServers: [] }),
      args.timeoutMs,
      'session/new'
    )) as any;
    if (created && typeof created.sessionId === 'string') activeSessionId = created.sessionId;
    printLine(`new session ${activeSessionId ?? '<unknown>'}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const printHelp = () => {
    printBlock([
      ':help - show commands',
      ':exit - exit',
      ':status - show connection + sessionId',
      ':configure - configure connection + model (Lace agents)',
      ':new [workDir] - create a new session',
      ':load <sessionId> - load an existing session',
      ':list - list sessions',
      ':prompt <text> - send a prompt',
      ':cancel - cancel active turn / pending permissions',
      ':raw <json> - call a method (supports {method, params})',
      '(any other non-empty line sends a prompt)',
    ]);
  };

  const exit = async (code: number) => {
    shuttingDown = true;
    rl.close();
    await conn.shutdown();
    process.exit(code);
  };

  const configureIfSupported = async (): Promise<void> => {
    const req = async (method: string, params?: unknown) =>
      await withTimeout(conn.peer.request(method, params), args.timeoutMs, method);

    type ConnectionInfo = {
      connectionId: string;
      providerId?: string;
      name?: string;
      credentialState?: string;
    };

    type ProviderInfo = {
      providerId: string;
      displayName?: string;
    };

    let connections: ConnectionInfo[] = [];
    try {
      const res = (await req('ent/connections/list', {})) as any;
      if (res && Array.isArray(res.connections)) connections = res.connections as ConnectionInfo[];
    } catch (err) {
      const d = describeError(err);
      if (d.message.toLowerCase().includes('method not found')) {
        printLine('error: agent does not support provider configuration');
        return;
      }
      throw err;
    }

    let connectionId: string | undefined;
    const readyConnections = connections.filter((c) => c.credentialState === 'ready');
    if (readyConnections.length === 1) {
      connectionId = readyConnections[0]!.connectionId;
    } else if (connections.length === 1) {
      connectionId = connections[0]!.connectionId;
    } else if (connections.length > 1) {
      const lines = ['configure: available connections:'];
      for (const c of connections) {
        lines.push(
          `  ${c.connectionId} ${c.name ? `(${c.name})` : ''} ${c.credentialState ? `[${c.credentialState}]` : ''}`.trimEnd()
        );
      }
      printBlock(lines);
      connectionId = await askUser('configure: enter connectionId');
    }

    if (!connectionId) {
      printLine('configure: no existing connection selected; creating a new one');
      const providersRes = (await req('ent/providers/list', {})) as any;
      const providers: ProviderInfo[] = Array.isArray(providersRes?.providers)
        ? (providersRes.providers as ProviderInfo[])
        : [];

      if (providers.length === 0) {
        printLine('error: no providers available');
        return;
      }

      let providerId: string;
      if (providers.length === 1) {
        providerId = providers[0]!.providerId;
      } else {
        printBlock([
          'configure: available providers:',
          ...providers.map((p) => `  ${p.providerId}${p.displayName ? ` (${p.displayName})` : ''}`),
        ]);
        providerId = await askUser('configure: enter providerId');
      }

      const upsert = (await req('ent/connections/upsert', {
        providerId,
        connection: { name: 'default', config: {} },
      })) as any;
      if (!upsert || typeof upsert.connectionId !== 'string') {
        printLine('error: failed to create connection');
        return;
      }
      connectionId = upsert.connectionId;
    }

    printLine(`configure: using connectionId ${connectionId}`);

    printLine('configure: checking credentials');
    const credStart = (await req('ent/connections/credentials/start', { connectionId })) as any;
    if (credStart?.kind === 'needs_input' && Array.isArray(credStart.fields)) {
      const values: Record<string, string> = {};
      for (const f of credStart.fields as Array<{
        name?: string;
        label?: string;
        secret?: boolean;
      }>) {
        const name = typeof f.name === 'string' ? f.name : '';
        if (!name) continue;

        if (f.secret) {
          if (
            (name === 'apiKey' || name.toLowerCase().includes('apikey')) &&
            process.env.OPENAI_API_KEY
          ) {
            values[name] = process.env.OPENAI_API_KEY;
            continue;
          }

          const envName = name.toUpperCase();
          if (process.env[envName]) {
            values[name] = process.env[envName];
            continue;
          }
        }

        const label = typeof f.label === 'string' && f.label.length > 0 ? f.label : name;
        const value = await askUser(`configure: enter ${label}${f.secret ? ' (will echo)' : ''}`);
        values[name] = value;
      }

      const submitted = (await req('ent/connections/credentials/submit', {
        connectionId,
        values,
      })) as any;
      if (!submitted || submitted.ok !== true) {
        printLine('error: credential submit failed');
        return;
      }
    }

    printLine('configure: listing models');
    const modelsRes = (await req('ent/models/list', { connectionId })) as any;
    const models: Array<{ modelId?: string }> = Array.isArray(modelsRes?.models)
      ? modelsRes.models
      : [];
    if (models.length === 0) {
      printLine('error: no models available for connection');
      return;
    }

    let modelId: string;
    if (models.length === 1 && typeof models[0]!.modelId === 'string') {
      modelId = models[0]!.modelId;
    } else {
      printBlock([
        'configure: available models:',
        ...models.map((m) => `  ${typeof m.modelId === 'string' ? m.modelId : '<unknown>'}`),
      ]);
      const chosen = await askUser('configure: enter modelId');
      modelId = chosen;
    }

    printLine('configure: applying session config');
    const configured = (await req('ent/session/configure', { connectionId, modelId })) as any;
    const effectiveConnectionId =
      typeof configured?.config?.connectionId === 'string'
        ? configured.config.connectionId
        : connectionId;
    const effectiveModelId =
      typeof configured?.config?.modelId === 'string' ? configured.config.modelId : modelId;

    printLine(
      `configured session: connectionId=${effectiveConnectionId} modelId=${effectiveModelId}`
    );
  };

  const sendPrompt = (text: string) => {
    const promise = withTimeout(
      conn.peer.request('session/prompt', { content: promptTextToContent(text) }),
      args.timeoutMs,
      'session/prompt'
    );

    void promise
      .then(() => endTextStream())
      .catch((err) => {
        if (shuttingDown) return;
        endTextStream();
        const d = describeError(err);
        if (d.message === 'Closed') return;
        printLine(`error: ${d.message}`);
        if (d.isMissingProviderConfig) {
          printLine('Hint: run :configure');
        }
      });
  };

  const handleReplLine = async (line: string) => {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) return;

    if (trimmed.startsWith(':')) {
      const [cmd, ...rest] = trimmed.slice(1).split(' ');
      const argText = trimmed.slice(1 + cmd.length).trimStart();

      if (cmd === 'help') {
        printHelp();
        return;
      }
      if (cmd === 'exit') {
        await exit(0);
        return;
      }
      if (cmd === 'status') {
        printBlock([
          `agent: pid=${conn.proc.pid}`,
          `workDir: ${args.workDir}`,
          `sessionId: ${activeSessionId ?? '<none>'}`,
        ]);
        return;
      }
      if (cmd === 'configure') {
        await configureIfSupported();
        return;
      }
      if (cmd === 'new') {
        const workDir = argText.length > 0 ? argText : args.workDir;
        const created = (await withTimeout(
          conn.peer.request('session/new', { cwd: workDir, mcpServers: [] }),
          args.timeoutMs,
          'session/new'
        )) as any;
        if (created && typeof created.sessionId === 'string') activeSessionId = created.sessionId;
        printLine(`new session ${activeSessionId ?? '<unknown>'}`);
        return;
      }
      if (cmd === 'load') {
        const sessionId = asSessionId(argText);
        await withTimeout(
          conn.peer.request('session/load', { sessionId, cwd: args.workDir, mcpServers: [] }),
          args.timeoutMs,
          'session/load'
        );
        activeSessionId = sessionId;
        printLine(`loaded session ${sessionId}`);
        return;
      }
      if (cmd === 'list') {
        const res = await withTimeout(
          conn.peer.request('session/list', { cwd: args.workDir }),
          args.timeoutMs,
          'session/list'
        );
        printLine(safeJsonStringify(res));
        return;
      }
      if (cmd === 'prompt') {
        sendPrompt(argText);
        return;
      }
      if (cmd === 'cancel') {
        if (activeSessionId) conn.peer.notify('session/cancel', { sessionId: activeSessionId });
        return;
      }
      if (cmd === 'raw') {
        let parsed: any;
        try {
          parsed = JSON.parse(argText);
        } catch {
          throw new Error(':raw expects a JSON object');
        }
        if (!parsed || typeof parsed !== 'object') throw new Error(':raw expects a JSON object');
        const method = parsed.method;
        if (typeof method !== 'string' || method.length === 0)
          throw new Error(':raw requires method');
        const params = parsed.params;
        const result = await withTimeout(conn.peer.request(method, params), args.timeoutMs, method);
        printLine(safeJsonStringify(result));
        return;
      }

      throw new Error(`Unknown command: :${cmd}`);
    }

    sendPrompt(trimmed);
  };

  const handlePermissionLine = (line: string) => {
    const decision = line.trim();
    if (!activePermission) {
      activePrompt = 'repl';
      return;
    }

    const options = Array.isArray(activePermission.params.options)
      ? activePermission.params.options
      : [];

    if (options.length > 0) {
      const allowed = new Set(options.map((o) => o.optionId));
      if (!allowed.has(decision)) {
        printLine(`invalid optionId: ${decision}`);
        return;
      }
    } else {
      if (decision.length === 0) {
        printLine('decision is required');
        return;
      }
    }

    activePermission.resolve({ decision });
    activePermission = undefined;
    activePrompt = 'repl';
    startNextPermissionIfNeeded();
  };

  let runningCommand = false;
  const queuedLines: string[] = [];

  const processQueuedLine = async (line: string) => {
    promptShown = false;
    try {
      await handleReplLine(line);
    } catch (err) {
      const d = describeError(err);
      if (d.message === 'Closed') return;
      printLine(`error: ${d.message}`);
      if (d.isMissingProviderConfig) {
        printLine('Hint: run :configure');
      }
    } finally {
      showPrompt();
    }
  };

  const drainQueue = () => {
    if (runningCommand) return;
    if (activePrompt === 'permission') return;
    if (pendingQuestionResolve) return;

    const next = queuedLines.shift();
    if (!next) return;

    runningCommand = true;
    void processQueuedLine(next).finally(() => {
      runningCommand = false;
      drainQueue();
    });
  };

  rl.on('line', (line) => {
    if (pendingQuestionResolve && activePrompt !== 'permission') {
      const resolve = pendingQuestionResolve;
      pendingQuestionResolve = null;
      promptShown = false;
      resolve(line);
      startNextPermissionIfNeeded();
      showPrompt();
      return;
    }

    if (activePrompt === 'permission') {
      handlePermissionLine(line);
      return;
    }

    queuedLines.push(line);
    drainQueue();
  });

  rl.on('close', () => {
    if (shuttingDown) return;
    void exit(0);
  });

  showPrompt();
}

void main().catch((err) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : safeJsonStringify(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
