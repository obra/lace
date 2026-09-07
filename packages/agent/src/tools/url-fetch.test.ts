// ABOUTME: Tests for schema-based URL fetch tool with structured output
// ABOUTME: Validates URL fetching, content handling, and enhanced error reporting

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { UrlFetchTool } from '@lace/agent/tools/implementations/url_fetch';
import { createFakeRuntime } from './runtime/__tests__/fake-runtime';
import type { ToolRuntime } from './runtime/types';

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

    it('reports the post-redirect URL in error context, not the requested one', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 404,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('not found'),
          url: 'https://example.com/moved-here',
        },
      });

      const result = await tool.execute(
        { url: 'https://example.com/original' },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('failed');
      const errorText = result.content[0].text ?? '';
      expect(errorText).toContain('Final URL: https://example.com/moved-here');
    });

    it('omits Final URL when the runtime cannot report one (e.g. curl-based container fetch)', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 500,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('boom'),
          // No `url` — mirrors ContainerExecNetworkClient, which cannot observe it.
        },
      });

      const result = await tool.execute(
        { url: 'https://example.com/original' },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('failed');
      const errorText = result.content[0].text ?? '';
      expect(errorText).not.toContain('Final URL:');
    });

    it('does not report a Final URL when the runtime only normalized the requested URL', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 404,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('not found'),
          // What a real `Response.url` gives back for a host-only request:
          // WHATWG-normalized, with the empty path filled in.
          url: 'https://example.com/',
        },
      });

      const result = await tool.execute(
        { url: 'https://example.com' },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('failed');
      const errorText = result.content[0].text ?? '';
      expect(errorText).not.toContain('Final URL:');
    });

    it('does not report a Final URL when normalization only dropped a fragment or encoded a space', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 404,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('not found'),
          url: 'http://example.com:8080/a%20b',
        },
      });

      const result = await tool.execute(
        { url: 'http://example.com:8080/a b#frag' },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('failed');
      const errorText = result.content[0].text ?? '';
      expect(errorText).not.toContain('Final URL:');
    });

    it('omits finalUrl from the diagnostic data when the runtime reports an empty URL', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 500,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('boom'),
          // A Response not produced by a network fetch has `url === ''`.
          url: '',
        },
      });

      const result = await tool.execute(
        { url: 'https://example.com/original' },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('failed');
      const errorText = result.content[0].text ?? '';
      expect(errorText).not.toContain('"finalUrl": ""');
      expect(errorText).toContain('"finalUrl": "https://example.com/original"');
    });
  });

  describe('Effective URL on the success path', () => {
    it('reports the post-redirect URL for inline content, not the requested one', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('please log in'),
          url: 'https://example.com/login',
        },
      });

      const result = await tool.execute(
        { url: 'https://api.example.com/v2/orders' },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text ?? '';
      expect(output).toContain('Content from https://example.com/login');
      expect(output).toContain('redirected from https://api.example.com/v2/orders');
    });

    it('reports the post-redirect URL when returnContent is false', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('please log in'),
          url: 'https://example.com/login',
        },
      });

      const result = await tool.execute(
        { url: 'https://api.example.com/v2/orders', returnContent: false },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text ?? '';
      expect(output).toContain('https://example.com/login');
      expect(output).toContain('redirected from https://api.example.com/v2/orders');
    });

    it('reports the post-redirect URL for large content saved to a temp file', async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), 'url-fetch-test-'));

      try {
        const runtime = createFakeRuntime({
          fetchResult: {
            status: 200,
            headers: { 'content-type': 'text/plain' },
            body: new TextEncoder().encode('x'.repeat(33 * 1024)),
            url: 'https://example.com/login',
          },
        });

        const result = await tool.execute(
          { url: 'https://api.example.com/v2/orders', maxSize: 64 * 1024 },
          {
            signal: new AbortController().signal,
            runtime,
            toolTempDir: join(tempRoot, 'tool-call-url-fetch'),
          }
        );

        expect(result.status).toBe('completed');
        const output = result.content[0].text ?? '';
        expect(output).toContain('Content from https://example.com/login');
        expect(output).toContain('redirected from https://api.example.com/v2/orders');
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    });

    it('reports only the requested URL when the runtime merely normalized it', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('hello'),
          url: 'https://example.com/',
        },
      });

      const result = await tool.execute(
        { url: 'https://example.com' },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text ?? '';
      expect(output).toContain('Content from https://example.com');
      expect(output).not.toContain('redirected from');
    });

    it('reports only the requested URL when the runtime cannot observe one', async () => {
      const runtime = createFakeRuntime({
        fetchResult: {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('hello'),
        },
      });

      const result = await tool.execute(
        { url: 'https://example.com/plain' },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text ?? '';
      expect(output).toContain('Content from https://example.com/plain');
      expect(output).not.toContain('redirected from');
    });
  });

  describe('Credential redaction in surfaced URLs', () => {
    const okRuntime = (finalUrl?: string) =>
      createFakeRuntime({
        fetchResult: {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('hello'),
          ...(finalUrl === undefined ? {} : { url: finalUrl }),
        },
      });

    const failingRuntime = (finalUrl?: string) =>
      createFakeRuntime({
        fetchResult: {
          status: 404,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('not found'),
          ...(finalUrl === undefined ? {} : { url: finalUrl }),
        },
      });

    const runTool = async (url: string, runtime: ReturnType<typeof createFakeRuntime>) => {
      const result = await tool.execute({ url }, { signal: new AbortController().signal, runtime });
      return result.content[0].text ?? '';
    };

    it('redacts a denylisted query parameter while keeping the key and benign params', async () => {
      const output = await runTool(
        'https://example.com/cb?page=3&code=4%2F0AeanS0abcdef&sort=asc',
        failingRuntime()
      );

      expect(output).not.toContain('4%2F0AeanS0abcdef');
      expect(output).toContain('code=[REDACTED]');
      expect(output).toContain('page=3');
      expect(output).toContain('sort=asc');
      expect(output).toContain('https://example.com/cb?');
    });

    it('redacts a signed-URL signature parameter', async () => {
      const signature = 'a'.repeat(20) + '9b2c3d4e5f60718293a4b5c6d7e8f901';
      const output = await runTool(
        `https://bucket.s3.amazonaws.com/report.csv?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE&X-Amz-Expires=900&X-Amz-Signature=${signature}`,
        failingRuntime()
      );

      expect(output).not.toContain(signature);
      expect(output).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(output).toContain('X-Amz-Signature=[REDACTED]');
      expect(output).toContain('X-Amz-Credential=[REDACTED]');
      expect(output).toContain('X-Amz-Expires=900');
    });

    it('redacts a long high-entropy value under a key that is not on the denylist', async () => {
      const opaque = 'f3a91c7de204b8615c9d0af27be431905ca8d76e12b34f9087ac5de6103b2f4d';
      const output = await runTool(`https://example.com/x?blob=${opaque}&page=2`, failingRuntime());

      expect(output).not.toContain(opaque);
      expect(output).toContain('blob=[REDACTED]');
      expect(output).toContain('page=2');
    });

    it('redacts userinfo credentials from the URL', async () => {
      const output = await runTool('https://alice:hunter2@example.com/private', failingRuntime());

      expect(output).not.toContain('hunter2');
      expect(output).not.toContain('alice');
      expect(output).toContain('https://[REDACTED]@example.com/private');
    });

    it('redacts an implicit-flow token carried in the fragment', async () => {
      const output = await runTool(
        'https://example.com/cb#access_token=ya29.a0AfB_byXXXXX&state=xyz789&token_type=Bearer',
        failingRuntime()
      );

      expect(output).not.toContain('ya29.a0AfB_byXXXXX');
      expect(output).toContain('access_token=[REDACTED]');
      expect(output).toContain('state=xyz789');
      // `token_type` is over-redacted: the denylist matches the word `token`.
      // Losing `Bearer` costs nothing, and the parameter name still shows.
      expect(output).toContain('token_type=[REDACTED]');
    });

    it('keeps a plain anchor fragment intact', async () => {
      const output = await runTool('https://example.com/docs#installation', failingRuntime());

      expect(output).toContain('URL: https://example.com/docs#installation');
    });

    it('leaves a benign URL untouched', async () => {
      const output = await runTool(
        'https://example.com/docs/guide?page=3&lang=en#section-2',
        failingRuntime()
      );

      expect(output).toContain('URL: https://example.com/docs/guide?page=3&lang=en#section-2');
      expect(output).not.toContain('[REDACTED]');
    });

    it('redacts both the requested and the effective URL of a redirect on the error path', async () => {
      const output = await runTool(
        'https://example.com/start?api_key=sk-live-01234567890',
        failingRuntime('https://login.example.com/cb?code=SECRETCODE01234')
      );

      expect(output).not.toContain('sk-live-01234567890');
      expect(output).not.toContain('SECRETCODE01234');
      expect(output).toContain('URL: https://example.com/start?api_key=[REDACTED]');
      expect(output).toContain('Final URL: https://login.example.com/cb?code=[REDACTED]');
    });

    it('redacts both URLs in the success-path content attribution', async () => {
      const output = await runTool(
        'https://example.com/start?api_key=sk-live-01234567890',
        okRuntime('https://login.example.com/cb?code=SECRETCODE01234')
      );

      expect(output).not.toContain('sk-live-01234567890');
      expect(output).not.toContain('SECRETCODE01234');
      expect(output).toContain('Content from https://login.example.com/cb?code=[REDACTED]');
      expect(output).toContain('redirected from https://example.com/start?api_key=[REDACTED]');
    });

    it('redacts the URL inside the diagnostic JSON blob', async () => {
      const output = await runTool('https://example.com/cb?token=abc123secret', failingRuntime());

      expect(output).not.toContain('abc123secret');
      expect(output).toContain('"url": "https://example.com/cb?token=[REDACTED]"');
    });

    it('still reports a redirect when both URLs redact to the same text', async () => {
      const output = await runTool(
        'https://example.com/cb?code=AAAA1111',
        failingRuntime('https://example.com/cb?code=BBBB2222')
      );

      expect(output).toContain('Final URL: https://example.com/cb?code=[REDACTED]');
    });

    it('does not report a phantom Final URL for a non-redirected request with query params', async () => {
      const url = 'https://example.com/cb?code=SECRETCODE01234&page=3';
      const output = await runTool(url, failingRuntime(url));

      expect(output).not.toContain('Final URL:');
      expect(output).not.toContain('SECRETCODE01234');
      expect(output).toContain('code=[REDACTED]');
    });

    it('does not report a phantom redirect on the success path for a redacted URL', async () => {
      const url = 'https://example.com/cb?code=SECRETCODE01234&page=3';
      const output = await runTool(url, okRuntime(url));

      expect(output).not.toContain('redirected from');
      expect(output).not.toContain('SECRETCODE01234');
      expect(output).toContain('Content from https://example.com/cb?code=[REDACTED]&page=3');
    });
  });

  describe('Credential redaction in runtime error messages', () => {
    const throwingRuntime = (message: string): ToolRuntime => ({
      ...createFakeRuntime(),
      network: { fetch: vi.fn().mockRejectedValue(new Error(message)) },
    });

    const runToolAgainst = async (url: string, message: string) => {
      const result = await tool.execute(
        { url },
        { signal: new AbortController().signal, runtime: throwingRuntime(message) }
      );
      return result.content[0].text ?? '';
    };

    it('redacts a credentialed URL embedded in the runtime error message', async () => {
      const secret = 'SECRETVALUE0123456789abcdef0123456789';
      const output = await runToolAgainst(
        'https://example.com/x',
        `curl: (3) unmatched brace in URL position 20:\nhttps://example.com/{a?token=${secret}\n`
      );

      expect(output).not.toContain(secret);
      expect(output).toContain('token=[REDACTED]');
      expect(output).toContain('unmatched brace in URL position 20');
    });

    it('redacts userinfo credentials embedded in the runtime error message', async () => {
      const output = await runToolAgainst(
        'https://example.com/private',
        'connect ECONNREFUSED for https://alice:hunter2@example.com/private'
      );

      expect(output).not.toContain('hunter2');
      expect(output).toContain('https://[REDACTED]@example.com/private');
    });

    it('redacts a URL the error message wrapped in parentheses', async () => {
      // The trailing `).` is punctuation, not URL: left inside the value it
      // fails the credential-shape charset test and the token survives.
      const secret = 'f3a91c7de204b8615c9d0af27be431905ca8d76e12b34f9087ac5de6103b2f4d';
      const output = await runToolAgainst(
        'https://example.com/x',
        `request failed (https://example.com/x?blob=${secret}).`
      );

      expect(output).not.toContain(secret);
      expect(output).toContain('blob=[REDACTED]');
    });

    it('leaves an error message with no URL in it alone', async () => {
      const output = await runToolAgainst('https://example.com/x', 'socket hang up');

      expect(output).toContain('NETWORK ERROR: socket hang up');
      expect(output).not.toContain('[REDACTED]');
    });
  });
});
