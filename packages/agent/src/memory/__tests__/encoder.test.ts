// ABOUTME: The encoder preserves the pinned model's complete token boundary and validates projected output.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { prepareEncoderTokens, normalizedEmbeddings } from '../encoder';

const run = promisify(execFile);
const probe = fileURLToPath(new URL('./encoder-worker-probe.mjs', import.meta.url));

it.each(['source', 'tsImport', 'compiled'])(
  'loads the actual %s encoder worker and checks local assets',
  async (mode) => {
    const args = mode === 'source' ? ['--import', 'tsx'] : [];
    const { stdout } = await run(process.execPath, [...args, probe, mode, 'missing'], {
      timeout: 10_000,
    });
    expect(stdout.trim()).toBe('completed');
  },
  15_000
);

it.each(['request-error', 'zero-exit', 'uncaught-error'])(
  'settles pending worker requests after %s and exits when idle',
  async (scenario) => {
    const { stdout } = await run(process.execPath, ['--import', 'tsx', probe, 'source', scenario], {
      timeout: 10_000,
    });
    expect(stdout.trim()).toBe('completed');
  },
  15_000
);

it('keeps BOS and terminal EOS inside a bounded right-padded batch', () => {
  const prepared = prepareEncoderTokens(
    [
      [2, 3, 4, 5, 1],
      [2, 8, 1],
    ],
    { bos: 2, eos: 1, pad: 0 },
    4
  );
  expect(Array.from(prepared.ids)).toEqual([2n, 3n, 4n, 1n, 2n, 8n, 1n, 0n]);
  expect(Array.from(prepared.mask)).toEqual([1n, 1n, 1n, 1n, 1n, 1n, 1n, 0n]);
  expect(prepared.width).toBe(4);
  expect(() => prepareEncoderTokens([[3, 4, 1]], { bos: 2, eos: 1, pad: 0 }, 4)).toThrow();
});
it('rejects hidden-state shapes and non-normalized or non-finite projected embeddings', () => {
  expect(normalizedEmbeddings({ dims: [1, 2], data: [0.6, 0.8] }, 1, 2)).toEqual([[0.6, 0.8]]);
  expect(() => normalizedEmbeddings({ dims: [1, 1, 2], data: [0.6, 0.8] }, 1, 2)).toThrow();
  expect(() => normalizedEmbeddings({ dims: [1, 2], data: [0, 0] }, 1, 2)).toThrow();
  expect(() => normalizedEmbeddings({ dims: [1, 2], data: [NaN, 1] }, 1, 2)).toThrow();
});

it('rejects missing local assets without downloading or accepting unrelated model files', async () => {
  const { verifyMemoryModel } = await import('../encoder');
  await expect(verifyMemoryModel('/nonexistent/lace-model')).rejects.toThrow();
});

it('gives waiting queries the next batch slot and cancels queued work', async () => {
  const module = await import('../encoder');
  const calls: string[][] = [];
  let release!: () => void;
  let started!: () => void;
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const encoder = module.scheduledMemoryEncoder({
    generation: 'test',
    async encode(texts: string[]) {
      calls.push(texts);
      if (calls.length === 1) {
        started();
        await blocked;
      }
      return texts.map(() => [1, 0]);
    },
  });
  const background = encoder.encode(['a', 'b', 'c', 'd', 'e'], 'document');
  await first;
  const foreground = encoder.encode(['question'], 'query');
  const controller = new AbortController();
  const cancelled = encoder.encode(['cancelled'], 'query', { signal: controller.signal });
  controller.abort();
  const rejection = cancelled.catch((error: unknown) => error);
  release();
  await Promise.all([background, foreground]);
  expect(await rejection).toBeInstanceOf(Error);
  expect(calls).toEqual([['a', 'b', 'c', 'd'], ['question'], ['e']]);
});

it('discards a cancelled active batch and does not start its next batch', async () => {
  const { scheduledMemoryEncoder } = await import('../encoder');
  const calls: string[][] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const encoder = scheduledMemoryEncoder({
    generation: 'test',
    async encode(texts) {
      calls.push(texts);
      if (calls.length === 1) await blocked;
      return texts.map(() => [1, 0]);
    },
  });
  const controller = new AbortController();
  const abandoned = encoder.encode(['a', 'b', 'c', 'd', 'e'], 'document', {
    signal: controller.signal,
  });
  const query = encoder.encode(['question'], 'query');
  expect(calls).toEqual([['a', 'b', 'c', 'd']]);
  controller.abort();
  const result = abandoned.catch((error: unknown) => error);
  release();
  expect(await result).toBe(controller.signal.reason);
  expect(await query).toEqual([[1, 0]]);
  expect(calls).toEqual([['a', 'b', 'c', 'd'], ['question']]);
});
