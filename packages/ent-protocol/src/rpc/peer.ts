import {
  JSONRPC,
  JSONRPCClient,
  JSONRPCServer,
  createJSONRPCNotification,
  createJSONRPCRequest,
  createJSONRPCSuccessResponse,
  isJSONRPCRequest,
  isJSONRPCResponse,
  JSONRPCErrorException,
  type JSONRPCID,
  type JSONRPCRequest,
  type JSONRPCResponse,
} from 'json-rpc-2.0';
import type { JsonRpcId, JsonRpcTransport } from '../transport/types';

export type JsonRpcMethodHandler = (params: unknown) => unknown | Promise<unknown>;

export type JsonRpcPeerOptions = {
  idPrefix: 'c_' | 'a_';
  methods?: Record<string, JsonRpcMethodHandler>;
};

export type JsonRpcErrorLike = {
  code: number;
  message: string;
  data?: unknown;
};

export class JsonRpcPeer {
  private readonly transport: JsonRpcTransport;
  private readonly server: JSONRPCServer<void>;
  private readonly client: JSONRPCClient<void>;
  private readonly idPrefix: 'c_' | 'a_';
  private nextId = 1;
  private closed = false;
  private unsubscribe?: () => void;

  constructor(transport: JsonRpcTransport, options: JsonRpcPeerOptions) {
    this.transport = transport;
    this.idPrefix = options.idPrefix;

    // Use a no-op error listener: JSONRPCErrorException is the expected way to
    // signal protocol-level errors, so the default console.error logging is noise.
    // Truly unexpected errors (non-JSONRPCErrorException) are already re-thrown
    // in onRequest() and will surface through normal error handling.
    this.server = new JSONRPCServer({
      errorListener: () => {
        // Intentionally empty - see comment above
      },
    });
    this.client = new JSONRPCClient((payload) => {
      this.transport.send(payload as any);
      return Promise.resolve();
    });

    if (options.methods) {
      for (const [method, handler] of Object.entries(options.methods)) {
        this.onRequest(method, handler);
      }
    }

    this.unsubscribe = this.transport.onMessage((msg) => {
      void this.handleMessage(msg as unknown);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    this.client.rejectAllPendingRequests('Closed');
    this.transport.close();
  }

  onRequest(method: string, handler: JsonRpcMethodHandler): void {
    this.server.removeMethod(method);
    this.server.addMethod(method, async (params) => {
      try {
        return await handler(params);
      } catch (error) {
        if (this.isJsonRpcErrorLike(error)) {
          throw new JSONRPCErrorException(error.message, error.code, error.data);
        }
        throw error;
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const notification = createJSONRPCNotification(method, params);
    this.transport.send(notification as any);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const { result } = this.requestWithId(method, params);
    return result;
  }

  requestWithId(
    method: string,
    params?: unknown
  ): { requestId: JsonRpcId; result: Promise<unknown> } {
    const requestId = this.createRequestId();
    const request: JSONRPCRequest = createJSONRPCRequest(requestId as JSONRPCID, method, params);

    const result = Promise.resolve(
      this.client.requestAdvanced(request) as PromiseLike<unknown>
    ).then((response) => {
      if (Array.isArray(response)) throw new Error('Unexpected batch response');
      const r = response as JSONRPCResponse;
      if (r.error) return Promise.reject(r.error);
      return r.result;
    });

    return { requestId, result };
  }

  abandonRequest(requestId: JsonRpcId): void {
    const id = requestId as JSONRPCID;
    this.client.receive(createJSONRPCSuccessResponse(id, null));
  }

  private createRequestId(): JsonRpcId {
    return `${this.idPrefix}${this.nextId++}`;
  }

  private isJsonRpcErrorLike(value: unknown): value is JsonRpcErrorLike {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return typeof v.code === 'number' && typeof v.message === 'string';
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (this.closed) return;

    if (isJSONRPCResponse(msg)) {
      this.client.receive(msg as JSONRPCResponse);
      return;
    }

    if (!isJSONRPCRequest(msg)) return;

    const response = await this.server.receive(msg as JSONRPCRequest, undefined);
    if (response) {
      this.transport.send(response as any);
      return;
    }

    // Notification => no response.
    if ((msg as JSONRPCRequest).id === undefined) return;

    // Shouldn't happen, but avoid hanging the caller if it does.
    this.transport.send({
      jsonrpc: JSONRPC,
      id: (msg as JSONRPCRequest).id ?? null,
      error: { code: -32603, message: 'Internal error' },
    } as any);
  }
}
