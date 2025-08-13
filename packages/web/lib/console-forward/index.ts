// ABOUTME: Console forwarding system for Next.js development
// ABOUTME: Forwards browser console messages to server terminal for better debugging
//
// Inspired by mitsuhiko/vite-console-forward-plugin for Vite projects.
// This implementation uses Next.js API routes and React components to achieve
// the same functionality in a Next.js environment.

/**
 * Configuration for the console forwarding system
 */
export interface ConsoleForwardConfig {
  /** Whether console forwarding is enabled (typically only in development) */
  enabled: boolean;
  /** API endpoint to send console messages to */
  endpoint: string;
  /** Console levels to forward (log, warn, error, info, debug) */
  levels: Array<'log' | 'warn' | 'error' | 'info' | 'debug'>;
  /** Maximum number of messages to buffer before sending */
  bufferSize: number;
  /** Interval in milliseconds to auto-flush buffered messages */
  flushInterval: number;
}

/**
 * Default configuration for console forwarding
 * Only enabled in development mode with sensible batching defaults
 */
export const DEFAULT_CONFIG: ConsoleForwardConfig = {
  enabled: process.env.NODE_ENV === 'development', // Only in development
  endpoint: '/api/debug/console', // Next.js API route
  levels: ['log', 'warn', 'error', 'info', 'debug'], // All console levels
  bufferSize: 50, // Batch up to 50 messages before sending
  flushInterval: 1000, // Auto-flush every 1 second
};

/**
 * Structure of a console log entry sent to the server
 * Contains the console call details plus browser metadata
 */
export interface ConsoleLogEntry {
  /** Console level (log, warn, error, etc.) */
  level: string;
  /** Serialized console arguments (SuperJSON format or fallback) */
  args: unknown; // SuperJSON serialized data or fallback array
  /** Timestamp when the console call was made */
  timestamp: number;
  /** URL where the console call originated */
  url: string;
  /** Browser user agent for context */
  userAgent: string;
}
