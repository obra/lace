// ABOUTME: Tests for structured API error types and error classification
// ABOUTME: Validates error handling, retry logic, and proper error context

import { describe, it, expect } from 'vitest';
import {
  HttpError,
  NetworkError,
  AbortError,
  ParseError,
  BusinessError,
  isRetryableError,
  isApiError,
  getErrorDetails,
} from '@/lib/api-errors';

describe('ApiError Types', () => {
  describe('HttpError', () => {
    it('should create HTTP error with proper classification', () => {
      const error = new HttpError(404, 'Not Found', '/api/test');

      expect(error.type).toBe('HTTP_ERROR');
      expect(error.status).toBe(404);
      expect(error.statusText).toBe('Not Found');
      expect(error.url).toBe('/api/test');
      expect(error.message).toBe('HTTP 404: Not Found');
      expect(error.isRetryable).toBe(false); // 4xx not retryable
      expect(error.isClientError).toBe(true);
      expect(error.isServerError).toBe(false);
    });

    it('should mark 5xx errors as retryable', () => {
      const error = new HttpError(500, 'Internal Server Error', '/api/test');

      expect(error.isRetryable).toBe(true);
      expect(error.isClientError).toBe(false);
      expect(error.isServerError).toBe(true);
    });

    it('should include context in error details', () => {
      const error = new HttpError(403, 'Forbidden', '/api/test', { userId: '123' });

      expect(error.context).toEqual({ url: '/api/test', userId: '123' });
    });
  });

  describe('NetworkError', () => {
    it('should create network error as retryable', () => {
      const cause = new TypeError('Failed to fetch');
      const error = new NetworkError('Connection failed', '/api/test', cause);

      expect(error.type).toBe('NETWORK_ERROR');
      expect(error.isRetryable).toBe(true);
      expect(error.url).toBe('/api/test');
      expect(error.cause).toBe(cause);
      expect(error.context).toEqual({
        url: '/api/test',
        cause: 'Failed to fetch',
      });
    });
  });

  describe('AbortError', () => {
    it('should create non-retryable abort error', () => {
      const error = new AbortError('/api/test');

      expect(error.type).toBe('ABORT_ERROR');
      expect(error.isRetryable).toBe(false);
      expect(error.message).toBe('Request was aborted');
      expect(error.context).toEqual({ url: '/api/test' });
    });
  });

  describe('ParseError', () => {
    it('should create non-retryable parse error with response text', () => {
      const error = new ParseError('Invalid JSON', '/api/test', '<html>Error page</html>');

      expect(error.type).toBe('PARSE_ERROR');
      expect(error.isRetryable).toBe(false);
      expect(error.responseText).toBe('<html>Error page</html>');
    });

    it('should truncate long response text', () => {
      const longText = 'a'.repeat(300);
      const error = new ParseError('Invalid JSON', '/api/test', longText);

      expect(error.context?.responseText).toBe('a'.repeat(200));
    });
  });

  describe('BusinessError', () => {
    it('should create non-retryable business error', () => {
      const error = new BusinessError('User not authorized', 'UNAUTHORIZED');

      expect(error.type).toBe('BUSINESS_ERROR');
      expect(error.isRetryable).toBe(false);
      expect(error.context).toEqual({ code: 'UNAUTHORIZED' });
    });
  });

  describe('Type Guards', () => {
    it('should identify retryable errors', () => {
      const retryableErrors = [
        new HttpError(500, 'Error', '/api/test'),
        new NetworkError('Failed', '/api/test'),
      ];

      const nonRetryableErrors = [
        new HttpError(404, 'Not Found', '/api/test'),
        new AbortError('/api/test'),
        new ParseError('Invalid', '/api/test', ''),
        new BusinessError('Error'),
        new Error('Regular error'),
      ];

      retryableErrors.forEach((error) => {
        expect(isRetryableError(error)).toBe(true);
      });

      nonRetryableErrors.forEach((error) => {
        expect(isRetryableError(error)).toBe(false);
      });
    });

    it('should identify API errors', () => {
      const apiErrors = [
        new HttpError(404, 'Not Found', '/api/test'),
        new NetworkError('Failed', '/api/test'),
        new AbortError('/api/test'),
        new ParseError('Invalid', '/api/test', ''),
        new BusinessError('Error'),
      ];

      const nonApiErrors = [new Error('Regular error'), 'string error', null, undefined];

      apiErrors.forEach((error) => {
        expect(isApiError(error)).toBe(true);
      });

      nonApiErrors.forEach((error) => {
        expect(isApiError(error)).toBe(false);
      });
    });
  });

  describe('Error Details Extraction', () => {
    it('should extract details from API errors', () => {
      const error = new HttpError(500, 'Error', '/api/test', { userId: '123' });
      const details = getErrorDetails(error);

      expect(details).toEqual({
        type: 'HTTP_ERROR',
        message: 'HTTP 500: Error',
        isRetryable: true,
        context: { url: '/api/test', userId: '123' },
      });
    });

    it('should handle regular errors', () => {
      const error = new Error('Regular error');
      const details = getErrorDetails(error);

      expect(details.type).toBe('UNKNOWN_ERROR');
      expect(details.message).toBe('Regular error');
      expect(details.stack).toBeDefined();
    });

    it('should handle unknown error types', () => {
      const details = getErrorDetails('string error');

      expect(details).toEqual({
        type: 'UNKNOWN_ERROR',
        message: 'string error',
      });
    });
  });
});
