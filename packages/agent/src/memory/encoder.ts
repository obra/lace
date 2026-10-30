// ABOUTME: One pinned, offline, text-only Gemma encoder with serialized bounded CPU batches.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getLaceDir } from '../config/lace-dir';

export const MEMORY_MODEL = {
  model: 'onnx-community/embeddinggemma-2-ONNX',
  revision: 'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
  assets: [
    {
      name: 'README.md',
      bytes: 28720,
      sha256: '4fe21bf1b86938ac62c7cd2d1511822e4ea6e8654e015e00b06a72676b5420e6',
      url: 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/README.md',
    },
    {
      name: 'config.json',
      bytes: 5031,
      sha256: '8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d',
      url: 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config.json',
    },
    {
      name: 'config_sentence_transformers.json',
      bytes: 1565,
      sha256: '031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5',
      url: 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config_sentence_transformers.json',
    },
    {
      name: 'tokenizer.json',
      bytes: 32170510,
      sha256: '4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4',
      url: 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer.json',
    },
    {
      name: 'tokenizer_config.json',
      bytes: 1599,
      sha256: '17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874',
      url: 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer_config.json',
    },
    {
      name: 'chat_template.jinja',
      bytes: 1016,
      sha256: '4b852efc0b9960283e735363331e6f325b33bc74bdbaa076f595bc4e9b94d85e',
      url: 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/chat_template.jinja',
    },
    {
      name: 'onnx/model_quantized.onnx',
      bytes: 495165,
      sha256: 'd06edd601f851c633a2519304cbeb8dc6170d7ceb61b436625c17fb9b6e74953',
      url: 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_quantized.onnx',
    },
    {
      name: 'onnx/model_quantized.onnx_data',
      bytes: 313724928,
      sha256: '278a7ff1248c3618e4bd11a607fc54f7bdc7778854230f3956d3f86bd9db4f3b',
      url: 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_quantized.onnx_data',
    },
  ],
} as const;
export const ENCODER_GENERATION = `embeddinggemma-2:${MEMORY_MODEL.revision}:q8:projected768:bos-eos512:query-search-result:document-none:v1`;
export type MemoryEncoder = {
  generation: string;
  encode(texts: string[], kind: 'query' | 'document'): Promise<number[][]>;
};
export function memoryModelDirectory(): string {
  return process.env.LACE_MEMORY_MODEL_DIR || join(getLaceDir(), 'models', 'embeddinggemma-2-ONNX');
}
export async function verifyMemoryModel(directory: string): Promise<void> {
  for (const asset of MEMORY_MODEL.assets) {
    const file = join(directory, asset.name);
    const digest = createHash('sha256');
    if ((await stat(file)).size !== asset.bytes)
      throw new Error(`Model asset size mismatch: ${asset.name}`);
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    if (digest.digest('hex') !== asset.sha256)
      throw new Error(`Model asset hash mismatch: ${asset.name}`);
  }
}
export function prepareEncoderTokens(
  rows: number[][],
  tokens: { bos: number; eos: number; pad: number },
  limit: number
) {
  const bounded = rows.map((row) => {
    if (row[0] !== tokens.bos || row.at(-1) !== tokens.eos)
      throw new Error('Gemma BOS/content/EOS template differs');
    return row.length > limit ? [...row.slice(0, limit - 1), tokens.eos] : row;
  });
  const width = Math.max(...bounded.map((row) => row.length));
  const ids = new BigInt64Array(rows.length * width).fill(BigInt(tokens.pad));
  const mask = new BigInt64Array(ids.length);
  for (const [index, row] of bounded.entries()) {
    ids.set(row.map(BigInt), index * width);
    mask.fill(1n, index * width, index * width + row.length);
  }
  return { ids, mask, width };
}
export function normalizedEmbeddings(
  embedding: { dims: number[]; data: ArrayLike<number> },
  rows: number,
  dimensions: number
): number[][] {
  if (
    embedding.dims.length !== 2 ||
    embedding.dims[0] !== rows ||
    embedding.dims[1] !== dimensions ||
    embedding.data.length !== rows * dimensions
  )
    throw new Error('Unexpected sentence_embedding shape');
  return Array.from({ length: rows }, (_, row) => {
    const vector = Array.from({ length: dimensions }, (_, column) =>
      Number(embedding.data[row * dimensions + column])
    );
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-4)
      throw new Error('Invalid normalized sentence_embedding');
    return vector.map((value) => value / norm);
  });
}
async function openLocalEncoder() {
  const directory = memoryModelDirectory();
  await verifyMemoryModel(directory);
  const { env, AutoConfig, AutoTokenizer, AutoModel, Tensor } = await import(
    '@huggingface/transformers'
  );
  env.allowRemoteModels = false;
  env.useFSCache = false;
  env.useBrowserCache = false;
  const local = { local_files_only: true, revision: MEMORY_MODEL.revision };
  const config = await AutoConfig.from_pretrained(directory, local);
  Object.assign(config, { vision_config: null, audio_config: null });
  const tokenizer = await AutoTokenizer.from_pretrained(directory, local);
  const model = await AutoModel.from_pretrained(directory, {
    ...local,
    config,
    device: 'cpu',
    dtype: 'q8',
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1, executionMode: 'sequential' },
  });
  if (Object.keys(model.sessions).join(',') !== 'model') {
    await model.dispose();
    throw new Error('Unexpected encoder sessions');
  }
  return async (texts: string[], kind: 'query' | 'document') => {
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 4) {
      const batch = texts
        .slice(offset, offset + 4)
        .map((text) =>
          kind === 'query' ? `task: search result | query: ${text}` : `title: none | text: ${text}`
        );
      const encoded = await tokenizer(batch, {
        add_special_tokens: true,
        padding: false,
        truncation: false,
        return_tensor: false,
      });
      const { ids, mask, width } = prepareEncoderTokens(
        encoded.input_ids as number[][],
        { bos: tokenizer.bos_token_id, eos: tokenizer.eos_token_id, pad: tokenizer.pad_token_id },
        512
      );
      const output = await model({
        input_ids: new Tensor('int64', ids, [batch.length, width]),
        attention_mask: new Tensor('int64', mask, [batch.length, width]),
      });
      vectors.push(...normalizedEmbeddings(output.sentence_embedding, batch.length, 768));
    }
    return vectors;
  };
}
let encoder: ReturnType<typeof openLocalEncoder> | undefined;
let queue: Promise<unknown> = Promise.resolve();
export const localMemoryEncoder: MemoryEncoder = {
  generation: ENCODER_GENERATION,
  encode(texts, kind) {
    // A failed lazy initialization stays failed; maintenance cannot loop model loads.
    const run = queue.then(async () => {
      encoder ??= openLocalEncoder();
      return (await encoder)(texts, kind);
    });
    queue = run.catch(() => {});
    return run;
  },
};
