// ABOUTME: WebSocket interceptor for HAR recording
// ABOUTME: Captures WebSocket connections and messages for LMStudio provider debugging

import { getHARRecorder } from '~/utils/har-recorder';
import { logger } from '~/utils/logger';

interface WebSocketTracker {
  url: string;
  headers: Record<string, string>;
  startTime: number;
  messages: Array<{ timestamp: number; direction: 'sent' | 'received'; data: string }>;
}

let originalWebSocket: typeof WebSocket | null = null;
let interceptorEnabled = false;
const activeWebSockets = new WeakMap<WebSocket, WebSocketTracker>();

export function enableWebSocketInterception(): void {
  if (interceptorEnabled || typeof globalThis.WebSocket !== 'function') {
    return;
  }

  // Store original WebSocket
  originalWebSocket = globalThis.WebSocket;
  interceptorEnabled = true;

  // Create intercepting WebSocket function
  function InterceptedWebSocket(url: string | URL, protocols?: string | string[]): WebSocket {
    const ws = new originalWebSocket!(url, protocols);

    const harRecorder = getHARRecorder();
    if (!harRecorder) {
      return ws;
    }

    const urlString = typeof url === 'string' ? url : url.toString();
    const startTime = Date.now();

    const tracker: WebSocketTracker = {
      url: urlString,
      headers: {}, // WebSocket headers not easily accessible in browser
      startTime,
      messages: [],
    };

    activeWebSockets.set(ws, tracker);

    // Intercept message sending
    const originalSend = ws.send.bind(ws);
    ws.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      const tracker = activeWebSockets.get(ws);
      if (tracker) {
        let dataString = '';
        if (typeof data === 'string') {
          dataString = data;
        } else if (data instanceof ArrayBuffer) {
          dataString = new TextDecoder().decode(data);
        } else if (data instanceof Blob) {
          // Can't synchronously read Blob, record as binary
          dataString = '[Blob data]';
        } else {
          // ArrayBufferView
          dataString = new TextDecoder().decode(data as ArrayBufferView);
        }

        tracker.messages.push({
          timestamp: Date.now(),
          direction: 'sent',
          data: dataString,
        });
      }

      return originalSend(data);
    };

    // Intercept message receiving
    ws.addEventListener('message', (event) => {
      const tracker = activeWebSockets.get(ws);
      if (tracker) {
        tracker.messages.push({
          timestamp: Date.now(),
          direction: 'received',
          data: typeof event.data === 'string' ? event.data : '[Binary data]',
        });
      }
    });

    // Record on close
    ws.addEventListener('close', () => {
      const tracker = activeWebSockets.get(ws);
      if (tracker && harRecorder) {
        const endTime = Date.now();
        harRecorder.recordWebSocketConnection(
          tracker.url,
          tracker.headers,
          tracker.startTime,
          endTime,
          tracker.messages
        );
        activeWebSockets.delete(ws);
      }
    });

    // Record on error
    ws.addEventListener('error', () => {
      const tracker = activeWebSockets.get(ws);
      if (tracker && harRecorder) {
        const endTime = Date.now();
        tracker.messages.push({
          timestamp: endTime,
          direction: 'received',
          data: '[WebSocket error occurred]',
        });
        harRecorder.recordWebSocketConnection(
          tracker.url,
          tracker.headers,
          tracker.startTime,
          endTime,
          tracker.messages
        );
        activeWebSockets.delete(ws);
      }
    });

    return ws;
  }

  // Copy static properties
  Object.setPrototypeOf(InterceptedWebSocket, originalWebSocket);
  Object.defineProperty(InterceptedWebSocket, 'prototype', {
    value: originalWebSocket.prototype,
    writable: false,
  });

  // Install intercepted WebSocket
  globalThis.WebSocket = InterceptedWebSocket as unknown as typeof WebSocket;

  logger.debug('WebSocket interception enabled for HAR recording');
}
