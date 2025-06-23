// ABOUTME: URL fetch tool for web content retrieval with security validation
// ABOUTME: Handles various content types and provides temp file management for large responses

import { writeFile, mkdir } from 'fs/promises';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import TurndownService from 'turndown';
import { Tool, ToolResult, ToolContext, createSuccessResult, createErrorResult } from '../types.js';
import { logger } from '../../utils/logger.js';

// Constants for configuration and validation
const INLINE_CONTENT_LIMIT = 32 * 1024; // 32KB
const DEFAULT_MAX_SIZE = 33554432; // 32MB
const MAX_TIMEOUT = 120000; // 2 minutes
const MIN_TIMEOUT = 1000; // 1 second
const MIN_SIZE = 1024; // 1KB
const MAX_SIZE_LIMIT = 104857600; // 100MB
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const VALID_HTTP_METHODS = ['GET', 'POST'] as const;
const MAX_TEMP_FILES = 1000; // Limit temp files array to prevent memory leaks

type HttpMethod = (typeof VALID_HTTP_METHODS)[number];

interface UrlFetchInput {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  maxSize?: number;
  followRedirects?: boolean;
  returnContent?: boolean;
}

interface RequestTiming {
  start: number;
  dns?: number;
  connect?: number;
  total?: number;
}

interface RichErrorContext {
  error: {
    type: 'network' | 'http' | 'timeout' | 'size' | 'content' | 'validation';
    message: string;
    code?: string;
  };
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    finalUrl?: string;
    redirectChain?: string[];
    timing?: RequestTiming;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyPreview?: string;
    size?: number;
  };
}

export class UrlFetchTool implements Tool {
  name = 'url_fetch';
  description =
    'Fetch content from web URLs with intelligent content handling. WARNING: Returned content can be very large and may exceed token limits. Consider delegating URL fetching to a subtask to avoid overwhelming the main conversation.';
  annotations = {
    title: 'URL Fetcher',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  };

  input_schema = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch (must be http:// or https://)',
        pattern: '^https?://.+',
      },
      method: {
        type: 'string',
        description: 'HTTP method (default: GET)',
        enum: [...VALID_HTTP_METHODS],
        default: 'GET',
      },
      headers: {
        type: 'object',
        description: 'Custom HTTP headers',
        additionalProperties: { type: 'string' },
      },
      body: {
        type: 'string',
        description: 'Request body for POST requests',
      },
      timeout: {
        type: 'number',
        description: `Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT}, max: ${MAX_TIMEOUT})`,
        minimum: MIN_TIMEOUT,
        maximum: MAX_TIMEOUT,
        default: DEFAULT_TIMEOUT,
      },
      maxSize: {
        type: 'number',
        description: `Maximum response size in bytes (default: ${DEFAULT_MAX_SIZE} = 32MB)`,
        minimum: MIN_SIZE,
        maximum: MAX_SIZE_LIMIT,
        default: DEFAULT_MAX_SIZE,
      },
      followRedirects: {
        type: 'boolean',
        description: 'Follow HTTP redirects (default: true, max 10 redirects)',
        default: true,
      },
      returnContent: {
        type: 'boolean',
        description:
          'Whether to return the processed content in the tool result (default: true). Set to false to only save to temp file without returning content.',
        default: true,
      },
    },
    required: ['url'],
  };

  private static tempFiles: string[] = [];
  private static cleanupRegistered = false;
  private static readonly cleanupLock = Symbol('cleanup-lock');
  private turndownService: TurndownService;

  constructor() {
    this.registerCleanup();
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
    });

    // Configure turndown to strip noise and focus on content (like lynx)
    this.turndownService.remove([
      'script',
      'style',
      'noscript',
      'meta',
      'link',
      'header',
      'nav',
      'footer',
    ] as any);
  }

  validateUrl(url: string): void {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('Invalid URL format');
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only HTTP and HTTPS protocols are allowed');
    }

    // Additional validation for empty or invalid hostnames
    if (!parsedUrl.hostname || parsedUrl.hostname === '.' || parsedUrl.hostname === '...') {
      throw new Error('Invalid URL format');
    }
  }

  private registerCleanup(): void {
    // Use a more robust singleton pattern to prevent race conditions
    if (UrlFetchTool.cleanupRegistered) return;

    // Double-check locking pattern for thread safety
    if ((globalThis as any)[UrlFetchTool.cleanupLock]) return;
    (globalThis as any)[UrlFetchTool.cleanupLock] = true;

    UrlFetchTool.cleanupRegistered = true;

    const cleanup = () => {
      for (const tempFile of UrlFetchTool.tempFiles) {
        try {
          if (existsSync(tempFile)) {
            unlinkSync(tempFile);
          }
        } catch {
          // Ignore cleanup errors during exit
        }
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  async executeTool(input: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    // Validate required properties before destructuring
    if (!input.url || typeof input.url !== 'string') {
      return this.createRichError({
        error: {
          type: 'validation',
          message: 'URL is required and must be a non-empty string',
        },
        request: {
          url: String(input.url || 'undefined'),
          method: 'GET',
          headers: {},
          timing: { start: Date.now() },
        },
      });
    }

    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = DEFAULT_TIMEOUT,
      maxSize = DEFAULT_MAX_SIZE,
      followRedirects = true,
      returnContent = true,
    } = input as unknown as UrlFetchInput;

    const timing: RequestTiming = {
      start: Date.now(),
    };

    try {
      this.validateUrl(url);
    } catch (error) {
      return this.createRichError({
        error: {
          type: 'validation',
          message: error instanceof Error ? error.message : 'Invalid URL',
        },
        request: {
          url,
          method,
          headers,
        },
      });
    }

    if (typeof timeout !== 'number' || timeout < MIN_TIMEOUT || timeout > MAX_TIMEOUT) {
      return this.createRichError({
        error: {
          type: 'validation',
          message: `Timeout must be between ${MIN_TIMEOUT} and ${MAX_TIMEOUT} milliseconds`,
        },
        request: {
          url,
          method,
          headers,
        },
      });
    }

    if (typeof maxSize !== 'number' || maxSize < MIN_SIZE || maxSize > MAX_SIZE_LIMIT) {
      return this.createRichError({
        error: {
          type: 'validation',
          message: `Max size must be between ${MIN_SIZE} and ${MAX_SIZE_LIMIT} bytes`,
        },
        request: {
          url,
          method,
          headers,
        },
      });
    }

    if (!VALID_HTTP_METHODS.includes(method as HttpMethod)) {
      return this.createRichError({
        error: {
          type: 'validation',
          message: `Method must be one of: ${VALID_HTTP_METHODS.join(', ')}`,
        },
        request: {
          url,
          method,
          headers,
        },
      });
    }

    // Set up fetch options with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const fetchOptions: {
      method: string;
      headers: Record<string, string>;
      redirect: 'follow' | 'manual';
      signal: AbortSignal;
      body?: string;
    } = {
      method,
      headers: {
        'User-Agent': 'Lace/1.0 (AI Assistant)',
        ...headers,
      },
      redirect: followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
    };

    if (body && method === 'POST') {
      fetchOptions.body = body;
    }

    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      timing.total = Date.now() - timing.start;

      // Collect response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      // Track redirects if any occurred
      const redirectChain: string[] = [];
      const finalUrl = response.url;
      if (finalUrl !== url) {
        // Note: We can't get the full redirect chain from fetch API
        // This is a limitation, but we can at least show the final URL
        redirectChain.push(url, finalUrl);
      }

      if (!response.ok) {
        // Try to get response body for error context
        let bodyPreview: string | undefined;
        try {
          const text = await response.text();
          bodyPreview = text.length > 1000 ? text.substring(0, 1000) + '...' : text;
        } catch {
          // Ignore errors reading body
        }

        return this.createRichError({
          error: {
            type: 'http',
            message: `HTTP ${response.status} ${response.statusText}`,
            code: response.status.toString(),
          },
          request: {
            url,
            method,
            headers,
            finalUrl,
            redirectChain: redirectChain.length > 0 ? redirectChain : undefined,
            timing,
          },
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            bodyPreview,
          },
        });
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLength = response.headers.get('content-length');
      const size = contentLength ? parseInt(contentLength, 10) : 0;

      // Check size limits
      if (size > maxSize) {
        return this.createRichError({
          error: {
            type: 'size',
            message: `Response size (${size} bytes) exceeds maximum allowed size (${maxSize} bytes)`,
          },
          request: {
            url,
            method,
            headers,
            finalUrl,
            redirectChain: redirectChain.length > 0 ? redirectChain : undefined,
            timing,
          },
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            size,
          },
        });
      }

      // Read response
      const buffer = await response.arrayBuffer();
      const actualSize = buffer.byteLength;

      if (actualSize > maxSize) {
        return this.createRichError({
          error: {
            type: 'size',
            message: `Response size (${actualSize} bytes) exceeds maximum allowed size (${maxSize} bytes)`,
          },
          request: {
            url,
            method,
            headers,
            finalUrl,
            redirectChain: redirectChain.length > 0 ? redirectChain : undefined,
            timing,
          },
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            size: actualSize,
          },
        });
      }

      // Handle small responses inline
      if (actualSize <= INLINE_CONTENT_LIMIT) {
        return this.handleInlineContent(buffer, contentType, url, returnContent);
      }

      // Handle large responses with temp files
      return await this.handleLargeContent(buffer, contentType, url, actualSize, returnContent);
    } catch (error) {
      clearTimeout(timeoutId);
      timing.total = Date.now() - timing.start;

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return this.createRichError({
            error: {
              type: 'timeout',
              message: `Request timeout after ${timeout}ms`,
              code: 'TIMEOUT',
            },
            request: {
              url,
              method,
              headers,
              timing,
            },
          });
        }

        // Determine error type based on error details
        let errorType: 'network' | 'timeout' = 'network';
        let errorCode: string | undefined;

        if ('code' in error) {
          errorCode = error.code as string;
        }

        return this.createRichError({
          error: {
            type: errorType,
            message: error.message,
            code: errorCode,
          },
          request: {
            url,
            method,
            headers,
            timing,
          },
        });
      }

      return this.createRichError({
        error: {
          type: 'network',
          message: 'Unknown network error occurred',
        },
        request: {
          url,
          method,
          headers,
          timing,
        },
      });
    }
  }

  private handleInlineContent(
    buffer: ArrayBuffer,
    contentType: string,
    url: string,
    returnContent: boolean
  ): ToolResult {
    try {
      if (!returnContent) {
        return createSuccessResult([
          {
            type: 'text',
            text: `Content fetched from ${url}:\n\nContent-Type: ${contentType}\nSize: ${buffer.byteLength} bytes\n\nContent not returned (returnContent=false). Use file tools to access if needed.`,
          },
        ]);
      }

      const processedContent = this.processContent(buffer, contentType);

      return createSuccessResult([
        {
          type: 'text',
          text: `Content from ${url}:\n\nContent-Type: ${contentType}\nSize: ${buffer.byteLength} bytes\n\n${processedContent}`,
        },
      ]);
    } catch (error) {
      return createErrorResult(
        `Failed to process content: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  processContent(buffer: ArrayBuffer, contentType: string): string {
    const cleanType = contentType.split(';')[0].trim().toLowerCase();

    // Only handle known text types, everything else is binary
    if (!this.isTextContent(cleanType)) {
      return `Binary content detected (${cleanType})\nSize: ${buffer.byteLength} bytes\n\nUse temp file for full content access.`;
    }

    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);

    // Convert HTML to markdown for better readability
    if (cleanType === 'text/html') {
      try {
        const markdown = this.turndownService.turndown(text);
        // Clean up excessive whitespace
        return markdown
          .replace(/\n\s*\n\s*\n/g, '\n\n') // Remove excessive line breaks
          .trim();
      } catch (error) {
        // Log the HTML parsing error for debugging while falling back to raw HTML
        logger.warn('HTML to markdown conversion failed, falling back to raw HTML', {
          error: error instanceof Error ? error.message : 'Unknown error',
          contentType: cleanType,
          contentLength: text.length,
        });
        return text; // Fallback to raw HTML
      }
    }

    // Pretty-print JSON
    if (cleanType === 'application/json') {
      try {
        const parsed = JSON.parse(text);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return text; // Fallback to raw text if parsing fails
      }
    }

    return text;
  }

  isTextContent(contentType: string): boolean {
    return (
      contentType.startsWith('text/') ||
      contentType === 'application/json' ||
      contentType === 'application/xml' ||
      contentType === 'application/javascript'
    );
  }

  private createRichError(context: RichErrorContext): ToolResult {
    const errorDetails = {
      ...context,
      // Add timestamp for debugging
      timestamp: new Date().toISOString(),
    };

    // Format for human-readable display
    let errorMessage = `${context.error.type.toUpperCase()} ERROR: ${context.error.message}\n\n`;

    // Request details
    errorMessage += `REQUEST:\n`;
    errorMessage += `  URL: ${context.request.url}\n`;
    errorMessage += `  Method: ${context.request.method}\n`;

    if (context.request.finalUrl && context.request.finalUrl !== context.request.url) {
      errorMessage += `  Final URL: ${context.request.finalUrl}\n`;
    }

    if (context.request.redirectChain && context.request.redirectChain.length > 0) {
      errorMessage += `  Redirects: ${context.request.redirectChain.join(' → ')}\n`;
    }

    if (context.request.timing) {
      errorMessage += `  Timing: ${context.request.timing.total}ms total\n`;
    }

    // Response details (if available)
    if (context.response) {
      errorMessage += `\nRESPONSE:\n`;
      errorMessage += `  Status: ${context.response.status} ${context.response.statusText}\n`;

      // Show relevant headers
      const relevantHeaders = [
        'content-type',
        'content-length',
        'location',
        'retry-after',
        'x-ratelimit-remaining',
      ];
      for (const header of relevantHeaders) {
        if (context.response.headers[header]) {
          errorMessage += `  ${header}: ${context.response.headers[header]}\n`;
        }
      }

      if (context.response.bodyPreview) {
        errorMessage += `\nResponse preview:\n${context.response.bodyPreview}\n`;
      }
    }

    errorMessage += `\nDiagnostic data: ${JSON.stringify(errorDetails, null, 2)}`;

    return createErrorResult(errorMessage);
  }

  private async handleLargeContent(
    buffer: ArrayBuffer,
    contentType: string,
    url: string,
    size: number,
    returnContent: boolean
  ): Promise<ToolResult> {
    try {
      // Create temp directory if it doesn't exist
      const tempDir = join(process.cwd(), 'temp');
      if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
      }

      // Generate temp file name
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const hash = Math.random().toString(36).substring(2, 8);
      const ext = this.getFileExtension(contentType);
      const tempFileName = `url-fetch-${timestamp}-${hash}${ext}`;
      const tempFilePath = join(tempDir, tempFileName);

      // Write full content to temp file
      const uint8Array = new Uint8Array(buffer);
      await writeFile(tempFilePath, uint8Array);

      // Track for cleanup with size limit to prevent memory leaks
      UrlFetchTool.tempFiles.push(tempFilePath);

      // Prevent memory leaks by limiting temp files array size
      if (UrlFetchTool.tempFiles.length > MAX_TEMP_FILES) {
        // Remove oldest entries while keeping the cleanup array manageable
        const excess = UrlFetchTool.tempFiles.length - MAX_TEMP_FILES;
        const removedFiles = UrlFetchTool.tempFiles.splice(0, excess);

        // Attempt to clean up the oldest files immediately
        for (const oldFile of removedFiles) {
          try {
            if (existsSync(oldFile)) {
              unlinkSync(oldFile);
            }
          } catch {
            // Ignore errors during proactive cleanup
          }
        }
      }

      const sizeInMB = (size / (1024 * 1024)).toFixed(1);

      if (!returnContent) {
        return createSuccessResult([
          {
            type: 'text',
            text: `Large file fetched from ${url}:\n\nContent-Type: ${contentType}\nSize: ${size} bytes (${sizeInMB}MB)\nSaved to: ${tempFilePath}\n\nContent not returned (returnContent=false). Use file tools to access the temp file.`,
          },
        ]);
      }

      // Process the full content and provide that as the main response
      const processedContent = this.isTextContent(contentType.split(';')[0].trim().toLowerCase())
        ? this.processContent(buffer, contentType)
        : `[Binary content - ${contentType}]`;

      return createSuccessResult([
        {
          type: 'text',
          text: `Content from ${url}:\n\nContent-Type: ${contentType}\nSize: ${size} bytes (${sizeInMB}MB)\nFull content saved to: ${tempFilePath}\n\n${processedContent}`,
        },
      ]);
    } catch (error) {
      return createErrorResult(
        `Failed to save large content: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private getFileExtension(contentType: string): string {
    const mimeMap: Record<string, string> = {
      'text/html': '.html',
      'text/plain': '.txt',
      'text/css': '.css',
      'text/javascript': '.js',
      'application/javascript': '.js',
      'application/json': '.json',
      'application/xml': '.xml',
      'text/xml': '.xml',
      'text/csv': '.csv',
      'text/markdown': '.md',
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
    };

    const cleanType = contentType.split(';')[0].trim().toLowerCase();
    return mimeMap[cleanType] || '.bin';
  }
}
