// ABOUTME: Typed error classes for agent-specific errors

/**
 * Error thrown when session storage is unavailable.
 * Includes the path that was attempted for debugging.
 */
export class SessionStorageError extends Error {
  readonly code = 'SessionStorageUnavailable' as const;

  constructor(
    message: string,
    public readonly path: string
  ) {
    super(message);
    this.name = 'SessionStorageError';
    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, SessionStorageError);
  }
}

/**
 * Error for RPC protocol errors with structured data.
 */
export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: { category?: string; path?: string; reason?: string }
  ) {
    super(message);
    this.name = 'RpcError';
    Error.captureStackTrace?.(this, RpcError);
  }
}
