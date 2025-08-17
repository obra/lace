// ABOUTME: Structured error types for API client with proper error classification
// ABOUTME: Provides type-safe error handling with context and retry information

/**
 * Base class for all API-related errors
 */
export abstract class ApiError extends Error {
  abstract readonly type: string;
  abstract readonly isRetryable: boolean;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * HTTP errors (4xx, 5xx status codes)
 */
export class HttpError extends ApiError {
  readonly type = 'HTTP_ERROR';

  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
    context?: Record<string, unknown>
  ) {
    super(`HTTP ${status}: ${statusText}`, { url, ...context });
  }

  get isRetryable(): boolean {
    // Only retry server errors, not client errors
    return this.status >= 500;
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/**
 * Network-related errors (timeout, connection issues)
 */
export class NetworkError extends ApiError {
  readonly type = 'NETWORK_ERROR';
  readonly isRetryable = true;

  constructor(
    message: string,
    public readonly url: string,
    public readonly cause?: Error,
    context?: Record<string, unknown>
  ) {
    super(message, { url, cause: cause?.message, ...context });
    this.cause = cause;
  }
}

/**
 * Request was aborted by user/timeout
 */
export class AbortError extends ApiError {
  readonly type = 'ABORT_ERROR';
  readonly isRetryable = false;

  constructor(
    public readonly url: string,
    context?: Record<string, unknown>
  ) {
    super('Request was aborted', { url, ...context });
  }
}

/**
 * Invalid JSON or response parsing errors
 */
export class ParseError extends ApiError {
  readonly type = 'PARSE_ERROR';
  readonly isRetryable = false;

  constructor(
    message: string,
    public readonly url: string,
    public readonly responseText: string,
    context?: Record<string, unknown>
  ) {
    super(message, { url, responseText: responseText.slice(0, 200), ...context });
  }
}

/**
 * Business logic errors from API (successful HTTP but error response)
 */
export class BusinessError extends ApiError {
  readonly type = 'BUSINESS_ERROR';
  readonly isRetryable = false;

  constructor(
    message: string,
    public readonly code?: string,
    context?: Record<string, unknown>
  ) {
    super(message, { code, ...context });
  }
}

/**
 * Type guard to check if error is retryable
 */
export function isRetryableError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.isRetryable;
}

/**
 * Type guard to check if error is an API error
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Extract error details for logging/debugging
 */
export function getErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof ApiError) {
    return {
      type: error.type,
      message: error.message,
      isRetryable: error.isRetryable,
      context: error.context,
    };
  }

  if (error instanceof Error) {
    return {
      type: 'UNKNOWN_ERROR',
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    type: 'UNKNOWN_ERROR',
    message: String(error),
  };
}
