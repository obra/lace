#!/usr/bin/env node

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import readline from 'node:readline';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { asSessionId, createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';

type CliArgs = {
  agentCmd?: string;
  workDir: string;
  loadSessionId?: string;
  approvalMode?: string;
  timeoutMs?: number;
};

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

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { workDir: process.cwd() };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agent-cmd') {
      const v = argv[++i];
      if (!v) throw new Error('--agent-cmd requires a value');
      args.agentCmd = v;
      continue;
    }
    if (a === '--workdir') {
      const v = argv[++i];
      if (!v) throw new Error('--workdir requires a value');
      args.workDir = v;
      continue;
    }
    if (a === '--load') {
      const v = argv[++i];
      if (!v) throw new Error('--load requires a sessionId');
      args.loadSessionId = v;
      continue;
    }
    if (a === '--approval-mode') {
      const v = argv[++i];
      if (!v) throw new Error('--approval-mode requires a value');
      args.approvalMode = v;
      continue;
    }
    if (a === '--timeout-ms') {
      const v = argv[++i];
      if (!v) throw new Error('--timeout-ms requires a number');
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error('--timeout-ms must be a positive number');
      args.timeoutMs = Math.trunc(n);
      continue;
    }
    if (a === '--new') {
      continue;
    }
    if (a === '--no-color') {
      continue;
    }
    if (a === '--help' || a === '-h') {
      printHelpAndExit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  return args;
}

function printHelpAndExit(code: number): never {
  const lines = [
    'lace (Ent protocol CLI client)',
    '',
    'Usage:',
    '  lace [--agent-cmd "<command>"] [--workdir <path>] [--load <sessionId>]',
    '',
    'Flags:',
    '  --agent-cmd "<command>"   Command to spawn (default: lace-agent if on PATH, else built agent)',
    '  --workdir <path>          Sets agent cwd and session workDir (default: current dir)',
    '  --load <sessionId>        Load an existing session instead of creating a new one',
    '  --approval-mode <mode>    Passed to initialize.config.approvalMode (Lace agents may use it)',
    '  --timeout-ms <n>          Client-side request timeout in ms',
    '  --no-color                (reserved; currently unused)',
    '',
    'REPL:',
    '  :help, :exit, :status, :new [workDir], :load <sessionId>, :list, :prompt <text>, :cancel, :raw <json>',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(code);
}

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.loadSessionId && process.argv.includes('--new')) {
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

  const pendingPermissions: PendingPermission[] = [];
  let activePermission: PendingPermission | undefined;

  const showPrompt = () => {
    if (!interactive) return;
    if (promptShown) return;
    promptShown = true;
    process.stdout.write(activePrompt === 'permission' ? permissionPrompt : replPrompt);
  };

  const printBlock = (lines: string[]) => {
    if (promptShown) process.stdout.write('\n');
    promptShown = false;
    for (const line of lines) process.stdout.write(`${line}\n`);
    showPrompt();
  };

  const printLine = (line: string) => {
    printBlock([line]);
  };

  const startNextPermissionIfNeeded = () => {
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

    const summary = (() => {
      const type = p.type;
      if (type === 'text_delta' && typeof (p as any).text === 'string') {
        return `text: ${firstLine((p as any).text).replaceAll('\n', '\\n')}`;
      }
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
        if (inner?.type === 'text_delta' && typeof inner.text === 'string') {
          return `job ${jobId} text: ${firstLine(inner.text).replaceAll('\n', '\\n')}`;
        }
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
      startNextPermissionIfNeeded();
    });
  });

  const initializeParams: Record<string, unknown> = { protocolVersion: '1.0' };
  if (args.approvalMode) initializeParams.config = { approvalMode: args.approvalMode };
  await withTimeout(
    conn.peer.request('initialize', initializeParams),
    args.timeoutMs,
    'initialize'
  );

  if (args.loadSessionId) {
    const sessionId = asSessionId(args.loadSessionId);
    await withTimeout(
      conn.peer.request('session/load', { sessionId }),
      args.timeoutMs,
      'session/load'
    );
    activeSessionId = sessionId;
    printLine(`loaded session ${sessionId}`);
  } else {
    const created = (await withTimeout(
      conn.peer.request('session/new', { workDir: args.workDir }),
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
      if (cmd === 'new') {
        const workDir = argText.length > 0 ? argText : args.workDir;
        const created = (await withTimeout(
          conn.peer.request('session/new', { workDir }),
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
          conn.peer.request('session/load', { sessionId }),
          args.timeoutMs,
          'session/load'
        );
        activeSessionId = sessionId;
        printLine(`loaded session ${sessionId}`);
        return;
      }
      if (cmd === 'list') {
        const res = await withTimeout(
          conn.peer.request('session/list', { workDir: args.workDir }),
          args.timeoutMs,
          'session/list'
        );
        printLine(safeJsonStringify(res));
        return;
      }
      if (cmd === 'prompt') {
        await withTimeout(
          conn.peer.request('session/prompt', { content: promptTextToContent(argText) }),
          args.timeoutMs,
          'session/prompt'
        );
        return;
      }
      if (cmd === 'cancel') {
        await withTimeout(
          conn.peer.request('session/cancel', {}),
          args.timeoutMs,
          'session/cancel'
        );
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

    await withTimeout(
      conn.peer.request('session/prompt', { content: promptTextToContent(trimmed) }),
      args.timeoutMs,
      'session/prompt'
    );
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

  rl.on('line', (line) => {
    promptShown = false;
    void (async () => {
      try {
        if (activePrompt === 'permission') {
          handlePermissionLine(line);
        } else {
          await handleReplLine(line);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : safeJsonStringify(err);
        printLine(`error: ${msg}`);
      } finally {
        showPrompt();
      }
    })();
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
