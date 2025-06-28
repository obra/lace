// ABOUTME: HTTP Archive (HAR) format recorder for debugging HTTP/WebSocket traffic
// ABOUTME: Captures all provider HTTP requests, responses, and timing data in standard HAR format

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from './logger.js';

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

    try {
      // Read current HAR file, add entry, write back
      const content = readFileSync(this.filePath, 'utf8');
      const harFile: HARFile = JSON.parse(content);
      harFile.log.entries.push(entry);

      writeFileSync(this.filePath, JSON.stringify(harFile, null, 2));
      logger.debug('HAR entry recorded', {
        url: entry.request.url,
        method: entry.request.method,
        status: entry.response.status,
      });
    } catch (error) {
      logger.error('Failed to record HAR entry', { error, entry });
    }
  }

  async recordFetchRequest(
    url: string,
    init: Record<string, unknown> = {},
    startTime: number,
    response: Response,
    endTime: number
  ): Promise<void> {
    const method = init.method || 'GET';
    const startedDateTime = new Date(startTime).toISOString();
    const totalTime = endTime - startTime;

    // Parse headers
    const requestHeaders: HARHeader[] = [];
    if (init.headers) {
      const headers =
        init.headers instanceof Headers
          ? init.headers
          : new Headers(init.headers as Record<string, string>);
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
        postData = {
          mimeType: 'application/x-www-form-urlencoded',
          text: init.body.toString(),
        };
        requestBodySize = Buffer.byteLength(init.body.toString(), 'utf8');
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

  async recordHTTPRequest(
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
  ): Promise<void> {
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
          eventData = JSON.parse(dataMatch[1]);
        } catch (e) {
          eventData = {
            raw: dataMatch[1],
            parse_error: e instanceof Error ? e.message : String(e),
          };
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
          const data = eventData as { message?: Record<string, unknown> };
          if (data.message) {
            message.id = data.message.id;
            message.role = data.message.role;
            message.model = data.message.model;
            message.usage = data.message.usage;
          }
          break;
        }

        case 'content_block_start': {
          const data = eventData as { index: number; content_block?: { type?: string } };
          const index = data.index;
          const blockType = data.content_block?.type || 'unknown';

          if (!message.content[index]) {
            message.content[index] = {
              type: blockType,
              text: blockType === 'text' ? '' : null,
              tool_use: blockType === 'tool_use' ? {} : null,
              thinking: blockType === 'thinking' ? '' : null,
            };
          }
          break;
        }

        case 'content_block_delta': {
          const data = eventData as { index: number; delta: Record<string, unknown> };
          const blockIndex = data.index;
          const delta = data.delta;

          if (!message.content[blockIndex]) {
            message.content[blockIndex] = {
              type: 'unknown',
              text: '',
            };
          }

          const block = message.content[blockIndex];

          if (delta.type === 'text_delta') {
            block.text = (block.text || '') + (delta.text || '');
          } else if (delta.type === 'tool_use_delta') {
            block.tool_use = {
              ...(block.tool_use || {}),
              ...(delta.tool_use || {}),
            };
          } else if (delta.type === 'thinking_delta') {
            block.thinking = (block.thinking || '') + (delta.thinking || '');
          }
          break;
        }

        case 'message_delta': {
          const data = eventData as { delta?: Record<string, unknown> };
          if (data.delta) {
            message.stop_reason = data.delta.stop_reason || message.stop_reason;
            message.usage = {
              ...(message.usage || {}),
              ...(data.delta.usage || {}),
            };
          }
          break;
        }

        case 'error':
          message.error = eventData;
          break;
      }
    } catch (error) {
      if (!message.errors) message.errors = [];
      message.errors.push({
        event_type: eventType,
        error: error instanceof Error ? error.message : String(error),
        data: eventData,
      });
    }
  }

  private getSSEEventSummary(events: Array<{ type: string }>): Record<string, unknown> {
    const summary = {
      total: events.length,
      by_type: {} as Record<string, number>,
    };

    for (const event of events) {
      summary.by_type[event.type] = (summary.by_type[event.type] || 0) + 1;
    }

    return summary;
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
          const event = JSON.parse(line);
          events.push(event);

          // Reconstruct the message content
          if (event.message?.content) {
            reconstructedContent += event.message.content;
          }

          // Check if this is the final message
          if (event.done) {
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
  globalHARRecorder = new HARRecorder(filePath);
  logger.info('HAR recording enabled', { filePath });
  return globalHARRecorder;
}

export function disableHARRecording(): void {
  globalHARRecorder = null;
  logger.info('HAR recording disabled');
}
