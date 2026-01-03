import process from 'node:process';

export type CliArgs = {
  agentCmd?: string;
  workDir: string;
  loadSessionId?: string;
  approvalMode?: string;
  timeoutMs?: number;
  explicitNew: boolean;
};

export type ParsedCliArgs =
  | { kind: 'ok'; args: CliArgs }
  | { kind: 'help'; exitCode: 0; text: string };

export function parseArgs(argv: string[]): ParsedCliArgs {
  const args: CliArgs = { workDir: process.cwd(), explicitNew: false };

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
      args.explicitNew = true;
      continue;
    }
    if (a === '--no-color') {
      continue;
    }
    if (a === '--help' || a === '-h') {
      return { kind: 'help', exitCode: 0, text: helpText() };
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  return { kind: 'ok', args };
}

export function helpText(): string {
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
  return `${lines.join('\n')}\n`;
}
