import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function callHelper(request: unknown): Promise<unknown> {
  const helperPath = new URL('../container-helper.ts', import.meta.url).pathname;
  const child = spawn(process.execPath, ['--import', 'tsx', helperPath]);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 0));
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
  const unexpectedStderr = stderr
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .filter((line) => !line.includes('[DEP0205]'))
    .filter((line) => !line.includes('Use `node --trace-deprecation ...`'));
  expect(unexpectedStderr).toEqual([]);
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim());
}

describe('container runtime helper', () => {
  it('reads and writes text files using the helper protocol', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-helper-test-'));
    const file = join(dir, 'note.txt');

    await expect(
      callHelper({ op: 'writeTextFile', path: file, content: 'hello' })
    ).resolves.toEqual({ ok: true, value: null });
    await expect(readFile(file, 'utf8')).resolves.toBe('hello');
    await expect(callHelper({ op: 'readTextFile', path: file })).resolves.toEqual({
      ok: true,
      value: 'hello',
    });
  });

  it('stats and lists directory entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-helper-test-'));
    await writeFile(join(dir, 'a.txt'), 'a', 'utf8');

    const statResponse = await callHelper({ op: 'stat', path: join(dir, 'a.txt') });
    expect(statResponse).toMatchObject({ ok: true, value: { type: 'file', size: 1 } });

    const readdirResponse = await callHelper({ op: 'readdir', path: dir });
    expect(readdirResponse).toMatchObject({
      ok: true,
      value: [{ name: 'a.txt', type: 'file' }],
    });
  });

  it('returns structured errors instead of crashing protocol output', async () => {
    await expect(callHelper({ op: 'readTextFile', path: '/definitely/missing' })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: expect.any(String), message: expect.any(String) }),
    });
  });
});
