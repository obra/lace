import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
}

function spawnCli(options: { workDir: string; laceDir: string }): {
  proc: ReturnType<typeof spawn>;
  lines: string[];
} {
  const cliMain = resolve(__dirname, '../../dist/main.js');
  const agentMain = resolve(__dirname, '../../../agent/dist/main.js');

  const proc = spawn(
    process.execPath,
    [
      cliMain,
      '--workdir',
      options.workDir,
      '--timeout-ms',
      '15000',
      '--agent-cmd',
      `${process.execPath} ${agentMain}`,
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', LACE_DIR: options.laceDir },
    }
  );

  const lines: string[] = [];
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx < 0) break;
      const line = buffer.slice(0, idx).trimEnd();
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) lines.push(line);
    }
  });

  return { proc, lines };
}

describe('cli e2e (lace-agent)', () => {
  it('runs a permissioned run: command', async () => {
    const base = await mkdtemp(resolve(tmpdir(), 'lace-cli-agent-test-'));
    const laceDir = resolve(base, 'lace-dir');
    const workDir = resolve(base, 'workdir');
    await mkdir(laceDir, { recursive: true });
    await mkdir(workDir, { recursive: true });

    const { proc, lines } = spawnCli({ workDir, laceDir });

    await waitFor(() => lines.some((l) => l.startsWith('new session ')), 15_000);

    proc.stdin.write('run: echo hi\n');

    await waitFor(() => lines.some((l) => l === 'permission request:'), 15_000);
    await waitFor(() => lines.some((l) => l.includes('input: {"command":"echo hi"}')), 15_000);

    proc.stdin.write('allow\n');

    await waitFor(
      () => lines.some((l) => l.startsWith('tool_use completed shell.exec (tool_')),
      15_000
    );

    proc.stdin.write(':exit\n');

    const exitCode = await new Promise<number>((resolveExit) => {
      proc.once('exit', (code) => resolveExit(code ?? 1));
    });

    expect(exitCode).toBe(0);
  });
});
