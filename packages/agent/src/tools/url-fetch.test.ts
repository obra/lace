// ABOUTME: Tests for schema-based URL fetch tool with structured output
// ABOUTME: Validates URL fetching, content handling, and enhanced error reporting

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { UrlFetchTool } from '@lace/agent/tools/implementations/url_fetch';
import { createFakeRuntime } from './runtime/__tests__/fake-runtime';

describe('UrlFetchTool with schema validation', () => {
  let tool: UrlFetchTool;
  // Properly typed fetch mock
  const mockFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();

  beforeAll(() => {
    // Stub global fetch for this test suite only
    vi.stubGlobal('fetch', mockFetch);
  });

  afterAll(() => {
    // Clean up global stubbing
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    tool = new UrlFetchTool();
    mockFetch.mockClear();
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('url_fetch');
      expect(tool.description).toBe(
        `Fetch web content with automatic HTML-to-markdown conversion. Content under 32KB returned inline, larger saved to temp files.
No need to delegate for size - tool handles large content automatically. Temp files created for content over 32KB.
Follows redirects by default. Returns detailed error context for failures.`
      );
    });

    it('should have proper input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.url).toBeDefined();
      expect(schema.properties.url.type).toBe('string');
      expect(schema.properties.url).toBeDefined();
      expect(schema.required).toContain('url');
    });

    it('should be marked appropriately', () => {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject missing URL', async () => {
      const result = await tool.execute({}, { signal: new AbortController().signal });

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('Missing required');
    });

    it('should reject empty URL', async () => {
      const result = await tool.execute({ url: '' }, { signal: new AbortController().signal });

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('Cannot be empty');
    });

    it('should reject non-HTTP protocols', async () => {
      const result = await tool.execute(
        { url: 'ftp://example.com' },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('Invalid URL format');
    });

    it('should reject malformed URLs', async () => {
      const result = await tool.execute(
        { url: 'not-a-url' },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should accept valid HTTP/HTTPS URLs', async () => {
      const validUrls = [
        'http://example.com',
        'https://example.com',
        'https://api.github.com/users/octocat',
      ];

      for (const url of validUrls) {
        const result = await tool.execute({ url }, { signal: new AbortController().signal });
        // Should get network error, not validation error
        if (result.status === 'failed') {
          expect(result.content[0].text).not.toContain('ValidationError');
        }
      }
    });

    it('should validate timeout constraints', async () => {
      const result = await tool.execute(
        {
          url: 'https://example.com',
          timeout: 500, // Below minimum
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('timeout');
    });

    it('should validate maxSize constraints', async () => {
      const result = await tool.execute(
        {
          url: 'https://example.com',
          maxSize: 500, // Below minimum
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('maxSize');
    });

    it('should validate method enum', async () => {
      const result = await tool.execute(
        {
          url: 'https://example.com',
          method: 'DELETE',
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('method');
    });

    it('should accept valid parameters', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: new TextEncoder().encode('{"test": "success"}'),
        },
      });

      const result = await tool.execute(
        {
          url: 'https://httpbin.org/get',
          method: 'GET',
          timeout: 30000,
          maxSize: 32768,
          followRedirects: true,
          returnContent: true,
        },
        { signal: new AbortController().signal, runtime }
      );

      // May fail with network error, but should not fail validation
      if (result.status === 'failed') {
        expect(result.content[0].text).not.toContain('ValidationError');
      }
    }, 10000);
  });

  describe('URL validation logic', () => {
    it('should accept various valid URL formats', () => {
      const validUrls = [
        'http://example.com',
        'https://example.com',
        'http://sub.example.com/path',
        'https://example.com:8080/path?query=value',
        'https://github.com/user/repo/blob/main/file.md',
      ];

      for (const url of validUrls) {
        expect(() => tool.validateUrl(url)).not.toThrow();
      }
    });

    it('should reject non-HTTP protocols', () => {
      const invalidUrls = [
        'ftp://example.com',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'mailto:test@example.com',
      ];

      for (const url of invalidUrls) {
        expect(() => tool.validateUrl(url)).toThrow('Only HTTP and HTTPS protocols are allowed');
      }
    });

    it('should reject malformed URLs', () => {
      const invalidUrls = ['not-a-url', 'http://', 'https://', '', 'https://...', 'http://.'];

      for (const url of invalidUrls) {
        expect(() => tool.validateUrl(url)).toThrow('Invalid URL format');
      }
    });
  });

  describe('Content processing', () => {
    it('should detect text content types correctly', () => {
      expect(tool.isTextContent('text/plain')).toBe(true);
      expect(tool.isTextContent('text/html')).toBe(true);
      expect(tool.isTextContent('application/json')).toBe(true);
      expect(tool.isTextContent('application/xml')).toBe(true);
      expect(tool.isTextContent('application/javascript')).toBe(true);

      expect(tool.isTextContent('image/jpeg')).toBe(false);
      expect(tool.isTextContent('application/pdf')).toBe(false);
      expect(tool.isTextContent('application/octet-stream')).toBe(false);
    });

    it('should process HTML content to markdown', () => {
      const html = '<h1>Test</h1><p>This is a <strong>test</strong>.</p>';
      const result = tool.processContent(new TextEncoder().encode(html).buffer, 'text/html');

      expect(result).toContain('# Test');
      expect(result).toContain('**test**');
    });

    it('should pretty-print JSON content', () => {
      const json = '{"name":"test","value":123}';
      const result = tool.processContent(new TextEncoder().encode(json).buffer, 'application/json');

      expect(result).toContain('{\n  "name": "test",\n  "value": 123\n}');
    });

    it('should handle binary content appropriately', () => {
      const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
      const result = tool.processContent(binaryData.buffer, 'image/png');

      expect(result).toContain('Binary content detected');
      expect(result).toContain('image/png');
    });
  });

  describe('Structured output with helpers', () => {
    it('should use createResult for successful responses', () => {
      // Mock the fetch to test the output structure
      const mockBuffer = new TextEncoder().encode('test content').buffer;
      const result = tool['handleInlineContent'](
        mockBuffer,
        'text/plain',
        'https://example.com',
        true
      );

      expect(result.status).toBe('completed');
      // Content should be structured text, not JSON
      expect(result.content[0].text).toContain('Content from https://example.com');
      expect(result.content[0].text).toContain('test content');
    });

    it('should use createError for validation failures', async () => {
      const result = await tool.execute(
        { url: 'invalid' },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should handle returnContent=false properly', () => {
      const mockBuffer = new TextEncoder().encode('<h1>Test</h1>').buffer;
      const result = tool['handleInlineContent'](
        mockBuffer,
        'text/html',
        'https://example.com',
        false
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('Content not returned (returnContent=false)');
      expect(result.content[0].text).not.toContain('# Test');
    });
  });

  describe('Network error scenarios', () => {
    it('should return a system error when runtime is missing', async () => {
      const result = await tool.execute(
        { url: 'https://example.com/hello' },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toBe('Tool context missing runtime. This is a system error.');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should route requests through runtime network fetch', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('hello'),
        },
      });

      const result = await tool.execute(
        { url: 'https://example.com/hello' },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('hello');
      expect(runtime.network.fetch).toHaveBeenCalledWith(
        'https://example.com/hello',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should pass maxSize to runtime network fetch as a byte limit', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('hello'),
        },
      });

      const result = await tool.execute(
        {
          url: 'https://example.com/limited',
          maxSize: 4096,
        },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('completed');
      expect(runtime.network.fetch).toHaveBeenCalledWith(
        'https://example.com/limited',
        expect.objectContaining({
          maxBytes: 4096,
        })
      );
    });

    it('should request manual redirects when followRedirects is false', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('hello'),
        },
      });

      const result = await tool.execute(
        { url: 'https://example.com/redirect', followRedirects: false },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('completed');
      expect(runtime.network.fetch).toHaveBeenCalledWith(
        'https://example.com/redirect',
        expect.objectContaining({
          redirect: 'manual',
        })
      );
    });

    it('should save large responses under the host tool temp directory', async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), 'url-fetch-test-'));

      try {
        const toolTempDir = join(tempRoot, 'tool-call-url-fetch');
        const runtime = createFakeRuntime({
          fetchResult: {
            status: 200,
            headers: { 'content-type': 'text/plain' },
            body: new TextEncoder().encode('x'.repeat(33 * 1024)),
          },
        });

        const result = await tool.execute(
          {
            url: 'https://example.com/large',
            maxSize: 64 * 1024,
            returnContent: false,
          },
          { signal: new AbortController().signal, runtime, toolTempDir }
        );

        expect(result.status).toBe('completed');
        const output = result.content[0].text ?? '';
        const savedPath = output.match(/Saved to: (.+)$/m)?.[1];
        expect(savedPath?.startsWith(join(toolTempDir, 'url-fetch-'))).toBe(true);
        expect(runtime.fs.writeTextFile).not.toHaveBeenCalled();
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    });

    it('should handle timeout errors gracefully', async () => {
      const runtime = createFakeRuntime();
      const timeoutError = new Error('The operation was aborted due to timeout');
      timeoutError.name = 'AbortError';
      vi.mocked(runtime.network.fetch).mockRejectedValueOnce(timeoutError);

      const result = await tool.execute(
        {
          url: 'https://httpbin.org/delay/5',
          timeout: 1000, // 1 second timeout for 5 second delay
        },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('failed');
      // Should get timeout error from mock
      expect(result.content[0].text).toMatch(/(timeout|aborted|TIMEOUT ERROR)/i);
    }, 10000);

    it('should handle invalid domains', async () => {
      const runtime = createFakeRuntime();
      vi.mocked(runtime.network.fetch).mockRejectedValueOnce(
        new Error('getaddrinfo ENOTFOUND this-domain-definitely-does-not-exist-12345.invalid')
      );

      const result = await tool.execute(
        {
          url: 'https://this-domain-definitely-does-not-exist-12345.invalid',
        },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toMatch(/(network|NETWORK ERROR)/i);
    }, 10000);

    it('should provide detailed error context', async () => {
      const result = await tool.execute(
        { url: 'invalid-url' },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      const errorText = result.content[0].text;

      // Schema validation errors come from base Tool class, not the rich error handler
      expect(errorText).toContain('ValidationError');
      // The URL validation happens at schema level, so we get schema validation errors
    });
  });
});
