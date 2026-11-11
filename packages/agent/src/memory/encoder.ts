// ABOUTME: Schedules bounded memory encoder batches on a single lazy worker.
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { getLaceDir } from '../config/lace-dir';
import { ENCODER_GENERATION } from './encoder-model';
import type { EncoderRequest, EncoderResponse } from './encoder-worker';

export {
  ENCODER_GENERATION,
  MEMORY_MODEL,
  normalizedEmbeddings,
  prepareEncoderTokens,
  verifyMemoryModel,
} from './encoder-model';

export type MemoryEncoder = {
  generation: string;
  encode(
    texts: string[],
    kind: 'query' | 'document',
    options?: { signal?: AbortSignal }
  ): Promise<number[][]>;
};
export function memoryModelDirectory(fallback?: string): string {
  return (
    process.env.LACE_MEMORY_MODEL_DIR ||
    fallback ||
    join(getLaceDir(), 'models', 'embeddinggemma-2-ONNX')
  );
}
export function scheduledMemoryEncoder(base: MemoryEncoder): MemoryEncoder {
  const foreground: Array<() => Promise<void>> = [];
  const background: Array<() => Promise<void>> = [];
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (foreground.length || background.length)
        await (foreground.shift() ?? background.shift())!();
    } finally {
      running = false;
    }
  }
  return {
    generation: base.generation,
    async encode(texts, kind, options) {
      const vectors: number[][] = [];
      for (let offset = 0; offset < texts.length; offset += 4) {
        options?.signal?.throwIfAborted();
        const batch = texts.slice(offset, offset + 4);
        const encoded = await new Promise<number[][]>((resolveBatch, rejectBatch) => {
          (kind === 'query' ? foreground : background).push(async () => {
            try {
              options?.signal?.throwIfAborted();
              const result = await base.encode(batch, kind, options);
              options?.signal?.throwIfAborted();
              resolveBatch(result);
            } catch (error) {
              rejectBatch(error);
            }
          });
          void drain();
        });
        vectors.push(...encoded);
      }
      return vectors;
    },
  };
}
let configuredDirectory: string | undefined;
export function configureMemoryEncoderDirectory(directory: string): void {
  const absolute = resolve(directory);
  if (configuredDirectory && configuredDirectory !== absolute)
    throw new Error('Conflicting local memory model directories');
  configuredDirectory = absolute;
}

function startEncoderWorker(directory: string): Worker {
  const options = { workerData: directory };
  // The scoped tsx loader appends a namespace to the module URL's query.
  if (!new URL(import.meta.url).pathname.endsWith('.ts')) {
    return new Worker(new URL('./encoder-worker.js', import.meta.url), options);
  }
  // Source tools use tsx, but a worker needs its own loader for the TypeScript entry.
  const loader = JSON.stringify(import.meta.resolve('tsx/esm/api'));
  const entry = JSON.stringify(new URL('./encoder-worker.ts', import.meta.url).href);
  const source = `import { tsImport } from ${loader}; await tsImport(${entry}, ${JSON.stringify(import.meta.url)});`;
  return new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), options);
}

let worker: Worker | undefined;
let workerFailure: Error | undefined;
// The scheduler sends only one batch at a time.
let pending:
  | { resolve: (vectors: number[][]) => void; reject: (error: unknown) => void }
  | undefined;

function takePending() {
  const request = pending;
  pending = undefined;
  worker?.unref();
  return request;
}

function failWorker(error: Error) {
  workerFailure ??= error;
  takePending()?.reject(workerFailure);
}

function receiveResponse(response: EncoderResponse) {
  const request = takePending();
  if ('error' in response) {
    const error = new Error(response.error.message);
    error.name = response.error.name;
    error.stack = response.error.stack;
    request?.reject(error);
  } else {
    request?.resolve(response.vectors);
  }
}

export const localMemoryEncoder: MemoryEncoder = scheduledMemoryEncoder({
  generation: ENCODER_GENERATION,
  async encode(texts, kind) {
    configuredDirectory ??= resolve(memoryModelDirectory());
    if (workerFailure) throw workerFailure;
    if (!worker) {
      try {
        worker = startEncoderWorker(configuredDirectory);
      } catch (error) {
        workerFailure = error instanceof Error ? error : new Error(String(error));
        throw workerFailure;
      }
      worker.on('message', receiveResponse);
      worker.on('error', failWorker);
      worker.on('messageerror', failWorker);
      worker.on('exit', (code) => failWorker(new Error(`Memory encoder worker exited (${code})`)));
    }
    const activeWorker = worker;
    return new Promise<number[][]>((resolve, reject) => {
      pending = { resolve, reject };
      activeWorker.ref();
      try {
        activeWorker.postMessage({ texts, kind } satisfies EncoderRequest);
      } catch (error) {
        takePending()?.reject(error);
      }
    });
  },
});
