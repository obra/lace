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

describe('cli e2e (:configure, multiple connections)', () => {
  it('accepts a follow-up connectionId answer', async () => {
    const workDir = await mkdtemp(resolve(tmpdir(), 'lace-cli-config-multi-'));
    const cliMain = resolve(__dirname, '../../dist/main.js');
    const agentPath = resolve(__dirname, 'fixtures/fake-agent-multi-connections.mjs');

    const proc = spawn(
      process.execPath,
      [cliMain, '--workdir', workDir, '--agent-cmd', `${process.execPath} ${agentPath}`],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } }
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

    proc.stdin.write(':configure\n');

    await waitFor(() => lines.some((l) => l.includes('configure: enter connectionId')), 5_000);

    proc.stdin.write('openai-openai\n');

    await waitFor(() => lines.some((l) => l.includes('configure: enter modelId')), 5_000);

    proc.stdin.write('model_1\n');

    await waitFor(() => lines.some((l) => l.startsWith('configured session:')), 5_000);

    proc.stdin.write(':exit\n');

    const exitCode = await new Promise<number>((resolveExit) => {
      proc.once('exit', (code) => resolveExit(code ?? 1));
    });

    expect(exitCode).toBe(0);
  });
});
