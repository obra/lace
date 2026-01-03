import type { JsonRpcId, JsonRpcMessage, JsonRpcTransport } from '../transport/types.js';

export type JsonRpcMethodHandler = (params: unknown) => unknown | Promise<unknown>;

export type JsonRpcPeerOptions = {
  idPrefix: 'c_' | 'a_';
  methods?: Record<string, JsonRpcMethodHandler>;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export class JsonRpcPeer {
  private readonly transport: JsonRpcTransport;
  private readonly methods = new Map<string, JsonRpcMethodHandler>();
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly idPrefix: 'c_' | 'a_';
  private nextId = 1;
  private unsubscribe?: () => void;

  constructor(transport: JsonRpcTransport, options: JsonRpcPeerOptions) {
    this.transport = transport;
    this.idPrefix = options.idPrefix;

    if (options.methods) {
      for (const [method, handler] of Object.entries(options.methods)) {
        this.methods.set(method, handler);
      }
    }

    this.unsubscribe = this.transport.onMessage((msg) => {
      void this.handleMessage(msg);
    });
  }

  close(): void {
    this.unsubscribe?.();
    this.transport.close();
  }

  onRequest(method: string, handler: JsonRpcMethodHandler): void {
    this.methods.set(method, handler);
  }

  notify(method: string, params?: unknown): void {
    this.transport.send({ jsonrpc: '2.0', method, params } as JsonRpcMessage);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = `${this.idPrefix}${this.nextId++}`;

    this.transport.send({ jsonrpc: '2.0', id, method, params } as JsonRpcMessage);

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private async handleMessage(msg: JsonRpcMessage): Promise<void> {
    // Response
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;

      this.pending.delete(msg.id);
      if ('error' in msg) pending.reject(msg.error);
      else pending.resolve(msg.result);
      return;
    }

    // Request vs notification
    if (!('method' in msg)) return;

    const handler = this.methods.get(msg.method);
    if (!handler) {
      if ('id' in msg) {
        this.transport.send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        } as JsonRpcMessage);
      }
      return;
    }

    try {
      const result = await handler(msg.params);
      if ('id' in msg) {
        this.transport.send({ jsonrpc: '2.0', id: msg.id, result } as JsonRpcMessage);
      }
    } catch (error) {
      if ('id' in msg) {
        this.transport.send({
          jsonrpc: '2.0',
          id: msg.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal error',
          },
        } as JsonRpcMessage);
      }
    }
  }
}
