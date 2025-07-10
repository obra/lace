// ABOUTME: HTTP Archive (HAR) format recorder for debugging HTTP/WebSocket traffic
// ABOUTME: Captures all provider HTTP requests, responses, and timing data in standard HAR format

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '~/utils/logger.js';

export interface HAREntry {
  startedDateTime: string;
  time: number;
  request: HARRequest;
  response: HARResponse;
  cache: Record<string, never>;
  timings: HARTimings;
  connection?: string;
  comment?: string;
}

export interface HARRequest {
  method: string;
  url: string;
  httpVersion: string;
  cookies: HARCookie[];
  headers: HARHeader[];
  queryString: HARQueryString[];
  postData?: HARPostData;
  headersSize: number;
  bodySize: number;
  comment?: string;
}

export interface HARResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  cookies: HARCookie[];
  headers: HARHeader[];
  content: HARContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
  comment?: string;
}

export interface HARTimings {
  blocked?: number;
  dns?: number;
  connect?: number;
  send: number;
  wait: number;
  receive: number;
  ssl?: number;
  comment?: string;
}

export interface HARHeader {
  name: string;
  value: string;
  comment?: string;
}

export interface HARCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  comment?: string;
}

export interface HARQueryString {
  name: string;
  value: string;
  comment?: string;
}

export interface HARPostData {
  mimeType: string;
  params?: HARParam[];
  text?: string;
  comment?: string;
}

export interface HARParam {
  name: string;
  value?: string;
  fileName?: string;
  contentType?: string;
  comment?: string;
}

export interface HARContent {
  size: number;
  compression?: number;
  mimeType: string;
  text?: string;
  encoding?: string;
  comment?: string;
}

export interface HARLog {
  version: string;
  creator: {
    name: string;
    version: string;
    comment?: string;
  };
  entries: HAREntry[];
  comment?: string;
}

export interface HARFile {
  log: HARLog;
}

export class HARRecorder {
  private entries: HAREntry[] = [];
  private filePath: string;
  private initialized = false;
  private writeBuffer: HAREntry[] = [];
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BUFFER_SIZE = 100; // Max entries to buffer
  private readonly FLUSH_INTERVAL = 5000; // Flush every 5 seconds
  private writeErrors = 0;
  private readonly MAX_WRITE_ERRORS = 10;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private ensureInitialized(): void {
    if (this.initialized) return;

    try {
      // Create directory if it doesn't exist
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Initialize HAR file with header
      const harFile: HARFile = {
        log: {
          version: '1.2',
          creator: {
            name: 'Lace AI Coding Assistant',
            version: '1.0.0',
            comment: 'HTTP traffic recorder for AI provider debugging',
          },
          entries: [],
        },
      };

      writeFileSync(this.filePath, JSON.stringify(harFile, null, 2));
      this.initialized = true;
      logger.debug(`HAR recording initialized: ${this.filePath}`);
    } catch (error) {
      logger.error('Failed to initialize HAR file', { error, filePath: this.filePath });
      throw error;
    }
  }

  recordEntry(entry: HAREntry): void {
    this.ensureInitialized();
    this.entries.push(entry);
    this.writeBuffer.push(entry);

    // Schedule flush if buffer is full or no timer is running
    if (this.writeBuffer.length >= this.BUFFER_SIZE) {
      this.flushBuffer();
    } else if (!this.writeTimer) {
      this.writeTimer = setTimeout(() => this.flushBuffer(), this.FLUSH_INTERVAL);
    }

    logger.debug('HAR entry buffered', {
      url: entry.request.url,
      method: entry.request.method,
      status: entry.response.status,
      bufferSize: this.writeBuffer.length,
    });
  }

  private flushBuffer(): void {
    if (this.writeBuffer.length === 0) return;

    try {
      // Clear timer
      if (this.writeTimer) {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }

      // Read current HAR file, add all buffered entries, write back
      const content = readFileSync(this.filePath, 'utf8');
      const harFile: HARFile = JSON.parse(content) as HARFile;
      harFile.log.entries.push(...this.writeBuffer);

      writeFileSync(this.filePath, JSON.stringify(harFile, null, 2));

      logger.debug('HAR buffer flushed', {
        entriesWritten: this.writeBuffer.length,
        totalEntries: harFile.log.entries.length,
      });

      // Clear buffer and reset error count on success
      this.writeBuffer.length = 0;
      this.writeErrors = 0;
    } catch (error) {
      this.writeErrors++;

      logger.error('Failed to flush HAR buffer', {
        error,
        bufferSize: this.writeBuffer.length,
        sampleEntry: this.writeBuffer[0]?.request?.url,
        errorCount: this.writeErrors,
        maxErrors: this.MAX_WRITE_ERRORS,
      });

      // If too many consecutive write errors, clear buffer to prevent memory leak
      if (this.writeErrors >= this.MAX_WRITE_ERRORS) {
        logger.warn('Too many HAR write failures, clearing buffer to prevent memory leak', {
          droppedEntries: this.writeBuffer.length,
          errorCount: this.writeErrors,
        });
        this.writeBuffer.length = 0;
        this.writeErrors = 0;
      }
      // Don't clear buffer on error - retry on next flush (unless max errors reached)
    }
  }

  // Ensure buffer is flushed when process exits
  destroy(): void {
    this.flushBuffer();
  }

  // Force immediate flush (for testing)
  flush(): void {
    this.flushBuffer();
  }

  async recordFetchRequest(
    url: string,
    init: Record<string, unknown> = {},
    startTime: number,
    response: Response,
    endTime: number
  ): Promise<void> {
    const method = typeof init.method === 'string' ? init.method : 'GET';
    const startedDateTime = new Date(startTime).toISOString();
    const totalTime = endTime - startTime;

    // Parse headers
    const requestHeaders: HARHeader[] = [];
    if (init.headers) {
      let headers: Headers;
      if (init.headers instanceof Headers) {
        headers = init.headers;
      } else if (typeof init.headers === 'object' && init.headers !== null) {
        // Safely convert object to Headers
        const headersObject = init.headers as Record<string, string>;
        headers = new Headers();
        for (const [name, value] of Object.entries(headersObject)) {
          if (typeof name === 'string' && typeof value === 'string') {
            headers.set(name, value);
          }
        }
      } else {
        headers = new Headers();
      }

      for (const [name, value] of headers.entries()) {
        requestHeaders.push({ name, value });
      }
    }

    const responseHeaders: HARHeader[] = [];
    for (const [name, value] of response.headers.entries()) {
      responseHeaders.push({ name, value });
    }

    // Parse URL for query string
    const urlObj = new URL(url);
    const queryString: HARQueryString[] = [];
    for (const [name, value] of urlObj.searchParams.entries()) {
      queryString.push({ name, value });
    }

    // Get request body
    let postData: HARPostData | undefined;
    let requestBodySize = 0;
    if (init.body) {
      const contentType =
        requestHeaders.find((h) => h.name.toLowerCase() === 'content-type')?.value ||
        'application/octet-stream';

      if (typeof init.body === 'string') {
        postData = {
          mimeType: contentType,
          text: init.body,
        };
        requestBodySize = Buffer.byteLength(init.body, 'utf8');
      } else if (init.body instanceof URLSearchParams) {
        const bodyText = init.body.toString();
        postData = {
          mimeType: 'application/x-www-form-urlencoded',
          text: bodyText,
        };
        requestBodySize = Buffer.byteLength(bodyText, 'utf8');
      } else if (init.body instanceof FormData) {
        postData = {
          mimeType: 'multipart/form-data',
          text: '[FormData body - cannot serialize]',
        };
        requestBodySize = -1; // Unknown size
      } else if (init.body instanceof ArrayBuffer) {
        postData = {
          mimeType: contentType,
          text: '[ArrayBuffer body - binary data]',
        };
        requestBodySize = init.body.byteLength;
      } else {
        postData = {
          mimeType: contentType,
          text: '[Binary or non-string body]',
        };
        requestBodySize = -1; // Unknown size
      }
    }

    // Get response body with proper handling for streaming vs non-streaming
    const responseClone = response.clone();
    let responseText = '';
    let responseSize = 0;

    // Check if this is likely a streaming response
    const contentType = response.headers.get('content-type') || '';
    const isStreaming =
      response.headers.get('transfer-encoding') === 'chunked' ||
      contentType.includes('ndjson') ||
      contentType.includes('text/event-stream');

    if (isStreaming) {
      // For streaming responses, try to capture partial content within timeout
      try {
        const streamReader = this.createStreamingReader(responseClone, 30000); // 30 second timeout
        responseText = await streamReader;

        // Parse SSE stream if applicable
        if (contentType.includes('text/event-stream') || this.isSSEStream(responseText)) {
          responseText = this.parseSSEStreamForHAR(responseText);
        }

        responseSize = Buffer.byteLength(responseText, 'utf8');
      } catch (error) {
        responseText = `[Streaming response capture error: ${error instanceof Error ? error.message : String(error)}]`;
        responseSize = -1;
      }
    } else {
      // For non-streaming responses, read normally with timeout
      try {
        const timeoutMs = 10000; // 10s for regular responses
        const timeoutPromise = new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Response body read timeout after ${timeoutMs / 1000}s`)),
            timeoutMs
          )
        );

        const textPromise = responseClone.text();
        responseText = await Promise.race([textPromise, timeoutPromise]);

        // Limit response size to prevent memory issues
        const maxSize = 1024 * 1024; // 1MB for regular responses
        if (responseText.length > maxSize) {
          responseText =
            responseText.substring(0, maxSize) +
            `\n[Response truncated - exceeded ${maxSize / (1024 * 1024)}MB limit]`;
        }

        responseSize = Buffer.byteLength(responseText, 'utf8');
      } catch (error) {
        responseText = `[Error reading response body: ${error instanceof Error ? error.message : String(error)}]`;
        responseSize = -1;
      }
    }

    const entry: HAREntry = {
      startedDateTime,
      time: totalTime,
      request: {
        method,
        url,
        httpVersion: 'HTTP/1.1', // Approximate, fetch doesn't expose this
        cookies: [], // TODO: Parse from Cookie header if needed
        headers: requestHeaders,
        queryString,
        postData,
        headersSize: -1, // Not available in fetch
        bodySize: requestBodySize,
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        httpVersion: 'HTTP/1.1', // Approximate
        cookies: [], // TODO: Parse from Set-Cookie header if needed
        headers: responseHeaders,
        content: {
          size: responseSize,
          mimeType: response.headers.get('content-type') || 'application/octet-stream',
          text: responseText,
        },
        redirectURL: '',
        headersSize: -1, // Not available in fetch
        bodySize: responseSize,
      },
      cache: {},
      timings: {
        send: 1, // Approximate
        wait: totalTime - 2, // Approximate
        receive: 1, // Approximate
      },
      comment: 'Recorded via fetch interceptor',
    };

    this.recordEntry(entry);
  }

  recordHTTPRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | Buffer | undefined,
    startTime: number,
    statusCode: number,
    statusMessage: string,
    responseHeaders: Record<string, string>,
    responseBody: string | Buffer,
    endTime: number
  ): void {
    const startedDateTime = new Date(startTime).toISOString();
    const totalTime = endTime - startTime;

    // Convert headers to HAR format
    const harRequestHeaders: HARHeader[] = Object.entries(headers).map(([name, value]) => ({
      name,
      value,
    }));
    const harResponseHeaders: HARHeader[] = Object.entries(responseHeaders).map(
      ([name, value]) => ({ name, value })
    );

    // Parse URL for query string
    const urlObj = new URL(url);
    const queryString: HARQueryString[] = [];
    for (const [name, value] of urlObj.searchParams.entries()) {
      queryString.push({ name, value });
    }

    // Handle request body
    let postData: HARPostData | undefined;
    let requestBodySize = 0;
    if (body) {
      const contentType =
        headers['content-type'] || headers['Content-Type'] || 'application/octet-stream';

      if (typeof body === 'string') {
        postData = { mimeType: contentType, text: body };
        requestBodySize = Buffer.byteLength(body, 'utf8');
      } else if (Buffer.isBuffer(body)) {
        postData = { mimeType: contentType, text: body.toString('utf8') };
        requestBodySize = body.length;
      }
    }

    // Handle response body
    let responseText = '';
    let responseSize = 0;
    if (typeof responseBody === 'string') {
      responseText = responseBody;
      responseSize = Buffer.byteLength(responseBody, 'utf8');
    } else if (Buffer.isBuffer(responseBody)) {
      responseText = responseBody.toString('utf8');
      responseSize = responseBody.length;
    }

    const entry: HAREntry = {
      startedDateTime,
      time: totalTime,
      request: {
        method: method.toUpperCase(),
        url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: harRequestHeaders,
        queryString,
        postData,
        headersSize: -1,
        bodySize: requestBodySize,
      },
      response: {
        status: statusCode,
        statusText: statusMessage,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: harResponseHeaders,
        content: {
          size: responseSize,
          mimeType:
            responseHeaders['content-type'] ||
            responseHeaders['Content-Type'] ||
            'application/octet-stream',
          text: responseText,
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: responseSize,
      },
      cache: {},
      timings: {
        send: 1,
        wait: totalTime - 2,
        receive: 1,
      },
      comment: 'Recorded via Node.js http/https interceptor',
    };

    this.recordEntry(entry);
  }

  recordWebSocketConnection(
    url: string,
    headers: Record<string, string>,
    startTime: number,
    endTime: number,
    messages: Array<{ timestamp: number; direction: 'sent' | 'received'; data: string }>
  ): void {
    const startedDateTime = new Date(startTime).toISOString();
    const totalTime = endTime - startTime;

    const harHeaders: HARHeader[] = Object.entries(headers).map(([name, value]) => ({
      name,
      value,
    }));

    // Create a synthetic HAR entry for WebSocket handshake
    const entry: HAREntry = {
      startedDateTime,
      time: totalTime,
      request: {
        method: 'GET',
        url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [
          ...harHeaders,
          { name: 'Upgrade', value: 'websocket' },
          { name: 'Connection', value: 'Upgrade' },
        ],
        queryString: [],
        headersSize: -1,
        bodySize: 0,
      },
      response: {
        status: 101,
        statusText: 'Switching Protocols',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [
          { name: 'Upgrade', value: 'websocket' },
          { name: 'Connection', value: 'Upgrade' },
        ],
        content: {
          size: 0,
          mimeType: 'application/x-websocket-frames',
          text: JSON.stringify(messages, null, 2),
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: 0,
      },
      cache: {},
      timings: {
        send: 1,
        wait: totalTime - 2,
        receive: 1,
      },
      comment: `WebSocket connection with ${messages.length} messages`,
    };

    this.recordEntry(entry);
  }

  private isSSEStream(content: string): boolean {
    if (!content || typeof content !== 'string') return false;

    // Check for SSE format markers
    return (
      content.includes('event: message_start') &&
      content.includes('data: {') &&
      content.includes('event: message_stop')
    );
  }

  private parseSSEStreamForHAR(content: string): string {
    if (!content || typeof content !== 'string') {
      return '[Empty SSE stream]';
    }

    try {
      // Split by double newlines (event boundaries)
      const eventChunks = content.split(/\n\n/);
      const events = [];
      const reconstructedMessage = {
        content: [],
        metadata: {},
      };

      for (const chunk of eventChunks) {
        // Skip empty chunks
        if (!chunk.trim()) continue;

        // Extract event type and data
        const eventMatch = chunk.match(/^event: (.+)$/m);
        const dataMatch = chunk.match(/^data: (.+)$/m);

        if (!eventMatch || !dataMatch) continue;

        const eventType = eventMatch[1];
        let eventData;

        try {
          eventData = JSON.parse(dataMatch[1]) as unknown;
        } catch (e) {
          eventData = {
            raw: dataMatch[1],
            parse_error: e instanceof Error ? e.message : String(e),
          } as unknown;
        }

        // Add to events array
        events.push({
          type: eventType,
          data: eventData,
        });

        // Process content blocks for reconstruction
        this.processSSEEvent(eventType, eventData, reconstructedMessage);
      }

      return JSON.stringify(
        {
          raw_events: events,
          reconstructed_message: reconstructedMessage,
          event_summary: this.getSSEEventSummary(events),
        },
        null,
        2
      );
    } catch (error) {
      return `[Error parsing SSE stream: ${error instanceof Error ? error.message : String(error)}]\n\n${content}`;
    }
  }

  private processSSEEvent(
    eventType: string,
    eventData: unknown,
    message: Record<string, unknown>
  ): void {
    try {
      switch (eventType) {
        case 'message_start': {
          if (this.isMessageStartData(eventData)) {
            if (eventData.message) {
              message.id = eventData.message.id;
              message.role = eventData.message.role;
              message.model = eventData.message.model;
              message.usage = eventData.message.usage;
            }
          }
          break;
        }

        case 'content_block_start': {
          if (this.isContentBlockStartData(eventData)) {
            const index = eventData.index;
            const blockType = eventData.content_block?.type || 'unknown';

            if (!Array.isArray(message.content)) {
              message.content = [];
            }

            const content = message.content as Record<string, unknown>[];
            if (!content[index]) {
              content[index] = {
                type: blockType,
                text: blockType === 'text' ? '' : null,
                tool_use: blockType === 'tool_use' ? null : null,
                thinking: blockType === 'thinking' ? '' : null,
              };
            }
          }
          break;
        }

        case 'content_block_delta': {
          if (this.isContentBlockDeltaData(eventData)) {
            const blockIndex = eventData.index;
            const delta = eventData.delta;

            if (!Array.isArray(message.content)) {
              message.content = [];
            }

            const content = message.content as Record<string, unknown>[];
            if (!content[blockIndex]) {
              content[blockIndex] = {
                type: 'unknown',
                text: '',
              };
            }

            const block = content[blockIndex];

            if (this.isTextDelta(delta)) {
              const existingText = typeof block.text === 'string' ? block.text : '';
              block.text = existingText + String(delta.text || '');
            } else if (this.isToolUseDelta(delta)) {
              block.tool_use = {
                ...(typeof block.tool_use === 'object' && block.tool_use !== null
                  ? block.tool_use
                  : {}),
                ...(delta.tool_use || {}),
              };
            } else if (this.isThinkingDelta(delta)) {
              const existingThinking = typeof block.thinking === 'string' ? block.thinking : '';
              block.thinking = existingThinking + String(delta.thinking || '');
            }
          }
          break;
        }

        case 'message_delta': {
          if (this.isMessageDeltaData(eventData)) {
            if (eventData.delta) {
              message.stop_reason = eventData.delta.stop_reason || message.stop_reason;
              message.usage = {
                ...(typeof message.usage === 'object' && message.usage !== null
                  ? message.usage
                  : {}),
                ...(eventData.delta.usage || {}),
              };
            }
          }
          break;
        }

        case 'error':
          message.error = eventData;
          break;
      }
    } catch (error) {
      if (!Array.isArray(message.errors)) {
        message.errors = [];
      }
      (message.errors as Record<string, unknown>[]).push({
        event_type: eventType,
        error: error instanceof Error ? error.message : String(error),
        data: eventData,
      });
    }
  }

  // Type guard methods for SSE event data
  private isMessageStartData(data: unknown): data is { message?: Record<string, unknown> } {
    return typeof data === 'object' && data !== null;
  }

  private isContentBlockStartData(
    data: unknown
  ): data is { index: number; content_block?: { type?: string } } {
    return (
      typeof data === 'object' &&
      data !== null &&
      'index' in data &&
      typeof (data as Record<string, unknown>).index === 'number'
    );
  }

  private isContentBlockDeltaData(
    data: unknown
  ): data is { index: number; delta: Record<string, unknown> } {
    return (
      typeof data === 'object' &&
      data !== null &&
      'index' in data &&
      typeof (data as Record<string, unknown>).index === 'number' &&
      'delta' in data
    );
  }

  private isMessageDeltaData(data: unknown): data is { delta?: Record<string, unknown> } {
    return typeof data === 'object' && data !== null;
  }

  private isTextDelta(
    delta: Record<string, unknown>
  ): delta is { type: 'text_delta'; text: string } {
    return delta.type === 'text_delta' && typeof delta.text === 'string';
  }

  private isToolUseDelta(
    delta: Record<string, unknown>
  ): delta is { type: 'tool_use_delta'; tool_use: Record<string, unknown> } {
    return (
      delta.type === 'tool_use_delta' &&
      typeof delta.tool_use === 'object' &&
      delta.tool_use !== null
    );
  }

  private isThinkingDelta(
    delta: Record<string, unknown>
  ): delta is { type: 'thinking_delta'; thinking: string } {
    return delta.type === 'thinking_delta' && typeof delta.thinking === 'string';
  }

  private isEventWithMessageContent(event: unknown): event is { message: { content: string } } {
    return (
      typeof event === 'object' &&
      event !== null &&
      'message' in event &&
      typeof (event as Record<string, unknown>).message === 'object' &&
      (event as Record<string, unknown>).message !== null &&
      'content' in ((event as Record<string, unknown>).message as Record<string, unknown>) &&
      typeof ((event as Record<string, unknown>).message as Record<string, unknown>).content ===
        'string'
    );
  }

  private isEventWithDone(event: unknown): event is { done: boolean } {
    return (
      typeof event === 'object' &&
      event !== null &&
      'done' in event &&
      typeof (event as Record<string, unknown>).done === 'boolean'
    );
  }

  private getSSEEventSummary(events: Array<{ type: string }>): Record<string, unknown> {
    const byType: Record<string, number> = {};

    for (const event of events) {
      byType[event.type] = (byType[event.type] || 0) + 1;
    }

    return {
      total: events.length,
      by_type: byType,
    };
  }

  private async createStreamingReader(response: Response, timeoutMs: number): Promise<string> {
    if (!response.body) {
      return '[No response body stream available]';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rawChunks = '';
    let chunks = 0;

    try {
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        const readPromise = reader.read();
        const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array }>(
          (_, reject) => setTimeout(() => reject(new Error('Chunk read timeout')), 2000) // 2s per chunk
        );

        try {
          const { done, value } = await Promise.race([readPromise, timeoutPromise]);

          if (done) {
            break; // Stream completed successfully
          }

          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            rawChunks += chunk;
            chunks++;
          }
        } catch (chunkError) {
          // Timeout on individual chunk, but continue if we have some content
          if (rawChunks.length > 0) {
            break;
          }
          throw chunkError;
        }
      }
    } catch (error) {
      if (rawChunks.length === 0) {
        return `[Stream reader error: ${error instanceof Error ? error.message : String(error)}]`;
      }
      // If we have some content, include the error but continue processing
      rawChunks += `\n[Stream ended with error: ${error instanceof Error ? error.message : String(error)}]`;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Ignore lock release errors
      }
    }

    // Now reconstruct the response
    return this.reconstructStreamingResponse(rawChunks, chunks);
  }

  private reconstructStreamingResponse(rawChunks: string, chunkCount: number): string {
    if (!rawChunks) {
      return '[Empty streaming response]';
    }

    try {
      // Split into individual JSON lines
      const lines = rawChunks.split('\n').filter((line) => line.trim());
      const events = [];
      let reconstructedContent = '';
      let finalMessage = null;

      for (const line of lines) {
        if (line.startsWith('[')) {
          // Status message, keep as-is
          continue;
        }

        try {
          const event = JSON.parse(line) as unknown;
          events.push(event);

          // Reconstruct the message content
          if (this.isEventWithMessageContent(event)) {
            reconstructedContent += event.message.content;
          }

          // Check if this is the final message
          if (this.isEventWithDone(event)) {
            finalMessage = event;
          }
        } catch {
          // Skip malformed JSON lines
          continue;
        }
      }

      // Create a summary with both raw chunks and reconstructed content
      const summary = {
        metadata: {
          total_chunks: chunkCount,
          total_events: events.length,
          final_message: finalMessage,
        },
        reconstructed_content: reconstructedContent || '[No content reconstructed]',
        raw_chunks: rawChunks,
      };

      return JSON.stringify(summary, null, 2);
    } catch (error) {
      // If reconstruction fails, return raw chunks with error
      return `[Reconstruction error: ${error instanceof Error ? error.message : String(error)}]\n\nRaw chunks:\n${rawChunks}`;
    }
  }
}

// Global HAR recorder instance
let globalHARRecorder: HARRecorder | null = null;

export function getHARRecorder(): HARRecorder | null {
  return globalHARRecorder;
}

export function initializeHARRecording(filePath: string): HARRecorder {
  // Flush any existing recorder before replacing
  if (globalHARRecorder) {
    globalHARRecorder.destroy();
  }

  globalHARRecorder = new HARRecorder(filePath);
  logger.info('HAR recording enabled', { filePath });

  // Ensure buffer is flushed on process exit
  const flushOnExit = () => {
    if (globalHARRecorder) {
      globalHARRecorder.destroy();
    }
  };

  process.on('exit', flushOnExit);
  process.on('SIGINT', flushOnExit);
  process.on('SIGTERM', flushOnExit);

  return globalHARRecorder;
}

export function disableHARRecording(): void {
  if (globalHARRecorder) {
    globalHARRecorder.destroy();
  }
  globalHARRecorder = null;
  logger.info('HAR recording disabled');
}
