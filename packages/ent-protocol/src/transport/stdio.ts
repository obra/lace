import { z } from 'zod';
import type {
  JsonRpcMessage,
  JsonRpcMessageHandler,
  JsonRpcTransport,
  NdjsonStdioTransportOptions,
} from './types.js';

const JsonRpcBaseSchema = z.object({
  jsonrpc: z.literal('2.0'),
});

export function createNdjsonStdioTransport(options: NdjsonStdioTransportOptions): JsonRpcTransport {
  const { readable, writable } = options;

  const handlers = new Set<JsonRpcMessageHandler>();
  let buffer = '';
  let closed = false;

  const onData = (chunk: Buffer | string) => {
    buffer += chunk.toString('utf8');

    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) return;

      const line = buffer.slice(0, newlineIndex).trimEnd();
      buffer = buffer.slice(newlineIndex + 1);

      if (line.length === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const base = JsonRpcBaseSchema.safeParse(parsed);
      if (!base.success) continue;

      for (const handler of handlers) handler(parsed as JsonRpcMessage);
    }
  };

  const onEnd = () => {
    closed = true;
  };

  readable.on('data', onData);
  readable.on('end', onEnd);
  readable.on('close', onEnd);

  return {
    send: (msg) => {
      if (closed) return;
      writable.write(`${JSON.stringify(msg)}\n`);
    },
    onMessage: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close: () => {
      if (closed) return;
      closed = true;
      readable.off('data', onData);
      readable.off('end', onEnd);
      readable.off('close', onEnd);
    },
  };
}
