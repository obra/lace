import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Spawned = {
  proc: ReturnType<typeof spawn>;
  lines: string[];
};

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
}

function spawnCli(workDir: string, agentPath: string): Spawned {
  const cliMain = resolve(__dirname, '../../dist/main.js');
  const proc = spawn(
    process.execPath,
    [cliMain, '--workdir', workDir, '--agent-cmd', `${process.execPath} ${agentPath}`],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
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

  proc.stderr.on('data', () => {
    // ignore; failures are asserted via exit code + stdout expectations
  });

  return { proc, lines };
}

describe('cli e2e', () => {
  it('prints permission request and cached tool input', async () => {
    const workDir = await mkdtemp(resolve(tmpdir(), 'lace-cli-test-'));
    const agentPath = resolve(__dirname, 'fixtures/fake-agent.mjs');

    const { proc, lines } = spawnCli(workDir, agentPath);

    proc.stdin.write(':prompt do it\n');

    await waitFor(() => lines.some((l) => l === 'permission request:'), 10_000);
    await waitFor(() => lines.some((l) => l.includes('toolCallId: tool_1')), 10_000);
    await waitFor(() => lines.some((l) => l.includes('input: {"command":"echo hi"}')), 10_000);

    proc.stdin.write('allow\n');

    await waitFor(() => lines.some((l) => l === 'text: ok'), 10_000);

    proc.stdin.write(':exit\n');

    const exitCode = await new Promise<number>((resolveExit) => {
      proc.once('exit', (code) => resolveExit(code ?? 1));
    });

    expect(exitCode).toBe(0);
  });

  it('prints help output', async () => {
    const cliMain = resolve(__dirname, '../../dist/main.js');

    const proc = spawn(process.execPath, [cliMain, '--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = await new Promise<string>((resolveOut) => {
      let buf = '';
      proc.stdout.on('data', (c) => (buf += c.toString('utf8')));
      proc.once('exit', () => resolveOut(buf));
    });

    expect(out).toContain('Usage:');
    expect(out).toContain('REPL:');
  });
});
