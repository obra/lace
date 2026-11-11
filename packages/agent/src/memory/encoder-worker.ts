// ABOUTME: Owns the local memory model and answers one encoding batch at a time.
import { parentPort, workerData } from 'node:worker_threads';
import { openLocalEncoder } from './encoder-model';

export type EncoderRequest = { texts: string[]; kind: 'query' | 'document' };
export type EncoderResponse =
  | { vectors: number[][] }
  | { error: { name: string; message: string; stack?: string } };

if (!parentPort) throw new Error('Memory encoder requires a worker thread');
const port = parentPort;
const directory = workerData as string;
let encoder: ReturnType<typeof openLocalEncoder> | undefined;

port.on('message', async ({ texts, kind }: EncoderRequest) => {
  let response: EncoderResponse;
  try {
    // A failed lazy initialization stays failed; maintenance cannot loop model loads.
    encoder ??= openLocalEncoder(directory);
    response = { vectors: await (await encoder)(texts, kind) };
  } catch (error) {
    const { name, message, stack } = error instanceof Error ? error : new Error(String(error));
    response = { error: { name, message, stack } };
  }
  port.postMessage(response);
});
