import type { Readable, Writable } from 'node:stream';

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse =
  | {
      jsonrpc: '2.0';
      id: JsonRpcId;
      result: unknown;
    }
  | {
      jsonrpc: '2.0';
      id: JsonRpcId;
      error: { code: number; message: string; data?: unknown };
    };

export type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export type JsonRpcMessageHandler = (msg: JsonRpcMessage) => void;

export type JsonRpcTransport = {
  send: (msg: JsonRpcMessage) => void;
  onMessage: (handler: JsonRpcMessageHandler) => () => void;
  close: () => void;
};

export type NdjsonStdioTransportOptions = {
  readable: Readable;
  writable: Writable;
};
