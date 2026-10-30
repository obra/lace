// ABOUTME: The encoder preserves the pinned model's complete token boundary and validates projected output.
import { expect, it } from 'vitest';
import { prepareEncoderTokens, normalizedEmbeddings } from '../encoder';

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
