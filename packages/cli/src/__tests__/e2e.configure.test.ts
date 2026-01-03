import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
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

describe('cli e2e (:configure)', () => {
  it('helps configure when provider is missing', async () => {
    const workDir = await mkdtemp(resolve(tmpdir(), 'lace-cli-config-test-'));
    const cliMain = resolve(__dirname, '../../dist/main.js');
    const agentPath = resolve(__dirname, 'fixtures/fake-agent-configure.mjs');

    const proc = spawn(
      process.execPath,
      [cliMain, '--workdir', workDir, '--agent-cmd', `${process.execPath} ${agentPath}`],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', OPENAI_API_KEY: 'x' },
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

    proc.stdin.write('hi\n');

    await waitFor(() => lines.some((l) => l.includes('Missing provider configuration')), 10_000);
    await waitFor(() => lines.some((l) => l.includes('Hint: run :configure')), 10_000);

    proc.stdin.write(':configure\n');

    await waitFor(() => lines.some((l) => l.includes('configured session')), 10_000);

    proc.stdin.write('hi\n');

    await waitFor(() => lines.some((l) => l === 'text: ok'), 10_000);

    proc.stdin.write(':exit\n');

    const exitCode = await new Promise<number>((resolveExit) => {
      proc.once('exit', (code) => resolveExit(code ?? 1));
    });

    expect(exitCode).toBe(0);
  });
});
