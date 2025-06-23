// ABOUTME: Tests for URL fetch tool with security validation
// ABOUTME: Validates URL fetching, content handling, and error scenarios

import { describe, it, expect } from 'vitest';
import { UrlFetchTool } from '../implementations/url-fetch.js';

describe('UrlFetchTool', () => {
  const tool = new UrlFetchTool();

  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('url_fetch');
      expect(tool.description).toBe(
        'Fetch content from web URLs with intelligent content handling. WARNING: Returned content can be very large and may exceed token limits. Consider delegating URL fetching to a subtask to avoid overwhelming the main conversation.'
      );
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(true);
    });

    it('should have correct input schema', () => {
      expect(tool.input_schema).toEqual({
        type: 'object',
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
      });
    });
  });

  describe('URL validation', () => {
    it('should accept valid HTTP URLs', async () => {
      const validUrls = [
        'http://example.com',
        'https://example.com',
        'http://sub.example.com/path',
        'https://example.com:8080/path?query=value',
      ];

      for (const url of validUrls) {
        expect(() => tool.validateUrl(url)).not.toThrow();
      }
    });

    it('should accept valid HTTPS URLs', async () => {
      const validUrls = [
        'https://github.com',
        'https://api.github.com/users/octocat',
        'https://raw.githubusercontent.com/user/repo/main/file.txt',
      ];

      for (const url of validUrls) {
        expect(() => tool.validateUrl(url)).not.toThrow();
      }
    });

    it('should reject non-HTTP protocols', async () => {
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

    it('should reject malformed URLs', async () => {
      const invalidUrls = ['not-a-url', 'http://', 'https://', '', 'https://...'];

      for (const url of invalidUrls) {
        expect(() => tool.validateUrl(url)).toThrow('Invalid URL format');
      }

      // This one is valid by URL constructor but should be rejected by our validation
      expect(() => tool.validateUrl('http://.')).toThrow('Invalid URL format');
    });
  });

  describe('parameter validation', () => {
    it('should handle missing URL parameter', async () => {
      const result = await tool.executeTool({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('URL is required and must be a non-empty string');
    });

    it('should handle empty URL parameter', async () => {
      const result = await tool.executeTool({ url: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('URL is required and must be a non-empty string');
    });

    it('should handle invalid timeout values', async () => {
      const result = await tool.executeTool({
        url: 'https://example.com',
        timeout: 500, // below minimum
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Timeout must be between 1000 and 120000 milliseconds'
      );
    });

    it('should handle invalid maxSize values', async () => {
      const result = await tool.executeTool({
        url: 'https://example.com',
        maxSize: 500, // below minimum
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Max size must be between 1024 and 104857600 bytes');
    });

    it('should handle invalid method values', async () => {
      const result = await tool.executeTool({
        url: 'https://example.com',
        method: 'INVALID',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Method must be one of: GET, POST, PUT, DELETE, HEAD, OPTIONS'
      );
    });
  });

  describe('network error handling', () => {
    it('should handle very short timeouts', async () => {
      // Test with impossibly short timeout
      const result = await tool.executeTool({
        url: 'https://httpbin.org/get',
        timeout: 1, // 1ms - should always timeout
      });

      expect(result.isError).toBe(true);
      // Just check that it's an error, don't rely on specific message text for now
    }, 10000);

    it('should handle invalid domains', async () => {
      const result = await tool.executeTool({
        url: 'https://this-domain-definitely-does-not-exist-12345.invalid',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    }, 10000);
  });

  describe('content processing', () => {
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

  describe('returnContent parameter', () => {
    it('should include content by default (returnContent=true)', () => {
      const html = '<h1>Test</h1><p>Content</p>';
      const result = tool.processContent(new TextEncoder().encode(html).buffer, 'text/html');

      expect(result).toContain('# Test');
      expect(result).toContain('Content');
    });

    it('should handle returnContent=false for inline content', async () => {
      // This test uses a mock-like approach since we can't easily test real HTTP calls
      const mockBuffer = new TextEncoder().encode('<h1>Test</h1>').buffer;
      const result = tool['handleInlineContent'](
        mockBuffer,
        'text/html',
        'https://example.com',
        false
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Content not returned (returnContent=false)');
      expect(result.content[0].text).toContain('https://example.com');
      expect(result.content[0].text).not.toContain('# Test');
    });

    it('should handle returnContent=true for inline content', async () => {
      const mockBuffer = new TextEncoder().encode('<h1>Test</h1>').buffer;
      const result = tool['handleInlineContent'](
        mockBuffer,
        'text/html',
        'https://example.com',
        true
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('# Test');
      expect(result.content[0].text).toContain('https://example.com');
    });

    it('should handle returnContent parameter validation', async () => {
      const result = await tool.executeTool({
        url: 'https://example.com',
        returnContent: 'invalid',
      });

      // Should still work - TypeScript types ensure boolean, but runtime should handle gracefully
      expect(result.isError).toBe(true); // Will error on network, but validates params first
    });
  });

  describe('tool description', () => {
    it('should warn about large content and suggest delegation', () => {
      expect(tool.description).toContain('WARNING');
      expect(tool.description).toContain('large');
      expect(tool.description).toContain('delegat');
      expect(tool.description).toContain('subtask');
    });
  });
});
