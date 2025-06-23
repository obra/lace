// ABOUTME: URL fetch tool for web content retrieval with security validation
// ABOUTME: Handles various content types and provides temp file management for large responses

import { writeFile, mkdir } from 'fs/promises';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import TurndownService from 'turndown';
import { Tool, ToolResult, ToolContext, createSuccessResult, createErrorResult } from '../types.js';

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
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
        default: 'GET',
      },
      headers: {
        type: 'object',
        description: 'Custom HTTP headers',
        additionalProperties: { type: 'string' },
      },
      body: {
        type: 'string',
        description: 'Request body for POST/PUT requests',
      },
      timeout: {
        type: 'number',
        description: 'Request timeout in milliseconds (default: 30000, max: 120000)',
        minimum: 1000,
        maximum: 120000,
        default: 30000,
      },
      maxSize: {
        type: 'number',
        description: 'Maximum response size in bytes (default: 33554432 = 32MB)',
        minimum: 1024,
        maximum: 104857600,
        default: 33554432,
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
    ] as string[]);
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
    if (UrlFetchTool.cleanupRegistered) return;

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
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = 30000,
      maxSize = 33554432, // 32MB
      followRedirects = true,
      returnContent = true,
    } = input as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
      maxSize?: number;
      followRedirects?: boolean;
      returnContent?: boolean;
    };

    // Validate parameters
    if (!url || typeof url !== 'string') {
      return createErrorResult('URL is required and must be a non-empty string');
    }

    try {
      this.validateUrl(url);
    } catch (error) {
      return createErrorResult(error instanceof Error ? error.message : 'Invalid URL');
    }

    if (typeof timeout !== 'number' || timeout < 1000 || timeout > 120000) {
      return createErrorResult('Timeout must be between 1000 and 120000 milliseconds');
    }

    if (typeof maxSize !== 'number' || maxSize < 1024 || maxSize > 104857600) {
      return createErrorResult('Max size must be between 1024 and 104857600 bytes');
    }

    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];
    if (!validMethods.includes(method)) {
      return createErrorResult(`Method must be one of: ${validMethods.join(', ')}`);
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

    if (body && ['POST', 'PUT'].includes(method)) {
      fetchOptions.body = body;
    }

    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      if (!response.ok) {
        return createErrorResult(`HTTP ${response.status} ${response.statusText}: ${url}`);
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLength = response.headers.get('content-length');
      const size = contentLength ? parseInt(contentLength, 10) : 0;

      // Check size limits
      if (size > maxSize) {
        return createErrorResult(
          `Response size (${size} bytes) exceeds maximum allowed size (${maxSize} bytes)`
        );
      }

      // Read response
      const buffer = await response.arrayBuffer();
      const actualSize = buffer.byteLength;

      if (actualSize > maxSize) {
        return createErrorResult(
          `Response size (${actualSize} bytes) exceeds maximum allowed size (${maxSize} bytes)`
        );
      }

      // Handle small responses inline (≤ 32KB)
      const inlineLimit = 32 * 1024;
      if (actualSize <= inlineLimit) {
        return this.handleInlineContent(buffer, contentType, url, returnContent);
      }

      // Handle large responses with temp files
      return await this.handleLargeContent(buffer, contentType, url, actualSize, returnContent);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return createErrorResult(`Request timeout after ${timeout}ms: ${url}`);
        }
        return createErrorResult(`Network error: ${error.message}`);
      }
      return createErrorResult('Unknown network error occurred');
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
      } catch {
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

      // Track for cleanup
      UrlFetchTool.tempFiles.push(tempFilePath);

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
