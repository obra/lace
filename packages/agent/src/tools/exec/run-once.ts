// ABOUTME: Spawn a one-shot tool process in isolation — minimal env, cwd, process-group kill
import { spawn } from 'node:child_process';
export interface RunExecOptions {
  stdin: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
}
export interface RunExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  aborted: boolean;
  timedOut: boolean;
}

function minimalEnv(extra?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp' };
  for (const k of ['TZ', 'LANG', 'LC_ALL']) {
    const v = process.env[k];
    if (v) base[k] = v;
  }
  return { ...base, ...(extra ?? {}) };
}

export function runExecToolProcess(
  bin: string,
  args: string[],
  opts: RunExecOptions
): Promise<RunExecResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: minimalEnv(opts.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '',
      stderr = '',
      aborted = false,
      timedOut = false,
      settled = false;
    const killGroup = (sig: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, sig);
        } catch {
          /* gone */
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGKILL');
    }, opts.timeoutMs);
    const onAbort = () => {
      aborted = true;
      killGroup('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode: code, aborted, timedOut });
    };
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {}); // swallow EPIPE when the child exits before reading stdin
    child.stdin.end(opts.stdin);
  });
}
