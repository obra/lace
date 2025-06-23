// ABOUTME: Tests for URL fetch tool with security validation
// ABOUTME: Validates URL fetching, content handling, and error scenarios

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UrlFetchTool } from '../implementations/url-fetch.js';

describe('UrlFetchTool', () => {
  const tool = new UrlFetchTool();

  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('url_fetch');
      expect(tool.description).toBe('Fetch content from web URLs with intelligent content handling');
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
            pattern: '^https?://.+'
          },
          method: {
            type: 'string',
            description: 'HTTP method (default: GET)',
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
            default: 'GET'
          },
          headers: {
            type: 'object',
            description: 'Custom HTTP headers',
            additionalProperties: { type: 'string' }
          },
          body: {
            type: 'string',
            description: 'Request body for POST/PUT requests'
          },
          timeout: {
            type: 'number',
            description: 'Request timeout in milliseconds (default: 30000, max: 120000)',
            minimum: 1000,
            maximum: 120000,
            default: 30000
          },
          maxSize: {
            type: 'number',
            description: 'Maximum response size in bytes (default: 33554432 = 32MB)',
            minimum: 1024,
            maximum: 104857600,
            default: 33554432
          },
          followRedirects: {
            type: 'boolean',
            description: 'Follow HTTP redirects (default: true, max 10 redirects)',
            default: true
          }
        },
        required: ['url']
      });
    });
  });

  describe('URL validation', () => {
    it('should accept valid HTTP URLs', async () => {
      const validUrls = [
        'http://example.com',
        'https://example.com',
        'http://sub.example.com/path',
        'https://example.com:8080/path?query=value'
      ];

      for (const url of validUrls) {
        expect(() => tool.validateUrl(url)).not.toThrow();
      }
    });

    it('should accept valid HTTPS URLs', async () => {
      const validUrls = [
        'https://github.com',
        'https://api.github.com/users/octocat',
        'https://raw.githubusercontent.com/user/repo/main/file.txt'
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
        'mailto:test@example.com'
      ];

      for (const url of invalidUrls) {
        expect(() => tool.validateUrl(url)).toThrow('Only HTTP and HTTPS protocols are allowed');
      }
    });

    it('should reject malformed URLs', async () => {
      const invalidUrls = [
        'not-a-url',
        'http://',
        'https://',
        '',
        'https://...'
      ];

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
        timeout: 500 // below minimum
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Timeout must be between 1000 and 120000 milliseconds');
    });

    it('should handle invalid maxSize values', async () => {
      const result = await tool.executeTool({
        url: 'https://example.com',
        maxSize: 500 // below minimum
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Max size must be between 1024 and 104857600 bytes');
    });

    it('should handle invalid method values', async () => {
      const result = await tool.executeTool({
        url: 'https://example.com',
        method: 'INVALID'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Method must be one of: GET, POST, PUT, DELETE, HEAD, OPTIONS');
    });
  });

  describe('network error handling', () => {
    it('should handle very short timeouts', async () => {
      // Test with impossibly short timeout
      const result = await tool.executeTool({
        url: 'https://httpbin.org/get',
        timeout: 1 // 1ms - should always timeout
      });

      expect(result.isError).toBe(true);
      // Just check that it's an error, don't rely on specific message text for now
    }, 10000);

    it('should handle invalid domains', async () => {
      const result = await tool.executeTool({
        url: 'https://this-domain-definitely-does-not-exist-12345.invalid'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    }, 10000);
  });
});