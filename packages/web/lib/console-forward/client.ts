// ABOUTME: Client-side console patching for forwarding logs to server
// ABOUTME: Buffers console calls and sends them via fetch to avoid network spam
//
// This module patches browser console methods to intercept all console calls,
// serializes them using SuperJSON for robust object handling, and forwards them
// to a server API endpoint in batches for performance.

import superjson from 'superjson';
import type { ConsoleForwardConfig, ConsoleLogEntry } from './index';

/**
 * Console forwarding class that patches browser console methods
 * and forwards console calls to a server endpoint in batches
 */
class ConsoleForwarder {
  private config: ConsoleForwardConfig;
  private buffer: ConsoleLogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  /** Store original console methods to restore later and call for local output */
  private originalConsole: Record<string, (...args: unknown[]) => void> = {};
  /** Track if forwarding has failed to stop future attempts */
  private forwardingFailed = false;

  constructor(config: ConsoleForwardConfig) {
    this.config = config;
    this.patchConsole();
    this.startFlushTimer();
  }

  /**
   * Patches console methods to intercept calls while preserving original functionality
   * Each console call will still appear in browser DevTools AND be forwarded to server
   */
  private patchConsole(): void {
    this.config.levels.forEach((level) => {
      // Store original method so we can restore it later
      // eslint-disable-next-line no-console
      this.originalConsole[level] = console[level as keyof Console] as (...args: unknown[]) => void;

      // Replace console method with our interceptor
      (console as unknown as Record<string, (...args: unknown[]) => void>)[level] = (
        ...args: unknown[]
      ) => {
        // IMPORTANT: Call original method first to maintain normal console behavior
        this.originalConsole[level](...args);

        // Add to forwarding buffer (only if enabled)
        this.addToBuffer(level, args);
      };
    });
  }

  /**
   * Adds a console call to the forwarding buffer with metadata
   * Triggers immediate flush if buffer is full to prevent memory issues
   */
  private addToBuffer(level: string, args: unknown[]): void {
    if (!this.config.enabled || this.forwardingFailed) return;

    const entry: ConsoleLogEntry = {
      level,
      args: this.serializeArgs(args), // SuperJSON serialization
      timestamp: Date.now(),
      url: window.location.href, // Current page URL for context
      userAgent: navigator.userAgent, // Browser info for debugging
    };

    this.buffer.push(entry);

    // Auto-flush if buffer is getting full to prevent memory bloat
    if (this.buffer.length >= this.config.bufferSize) {
      this.flush();
    }
  }

  /**
   * Serializes console arguments using SuperJSON for robust object handling
   * Handles dates, undefined, BigInt, circular references, and other complex types
   * Falls back to safe JSON stringify with circular reference detection
   */
  private serializeArgs(args: unknown[]): unknown {
    try {
      // Use SuperJSON to serialize the entire args array
      // This preserves dates, handles circular refs, and maintains type information
      return superjson.serialize(args);
    } catch (_error) {
      // If SuperJSON fails, fall back to individual serialization with error handling
      return args.map((arg) => {
        try {
          return this.safeStringify(arg);
        } catch {
          // Final fallback: create error metadata object
          return {
            __serialization_error: true,
            type: typeof arg,
            constructor: arg?.constructor?.name || 'unknown',
            string_representation: String(arg),
          };
        }
      });
    }
  }

  /**
   * Safe JSON.stringify that handles circular references
   * Used as fallback when SuperJSON fails
   */
  private safeStringify(obj: unknown): string {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      obj,
      (key, val: unknown) => {
        if (val != null && typeof val === 'object') {
          if (seen.has(val)) return '[Circular Reference]';
          seen.add(val);
        }
        return val as unknown;
      },
      2
    );
  }

  /**
   * Starts the auto-flush timer to periodically send buffered console messages
   * Ensures messages don't get stuck in the buffer indefinitely
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  /**
   * Sends buffered console messages to the server API endpoint
   * Uses fire-and-forget approach to avoid blocking console output on network issues
   */
  private flush(): void {
    if (this.buffer.length === 0 || this.forwardingFailed) return;

    // Copy buffer and clear it immediately to avoid blocking subsequent calls
    const logs = [...this.buffer];
    this.buffer = [];

    // Send to server with fire-and-forget approach using void operator
    const sendLogs = async (): Promise<void> => {
      try {
        await fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ logs }),
        });
      } catch (error) {
        // Set failure flag to stop future forwarding attempts for this browser session
        this.forwardingFailed = true;

        // Log error once in development to help debug forwarding issues
        if (process.env.NODE_ENV === 'development') {
          // Use original console to avoid infinite loops
          this.originalConsole.error?.(
            'Console forwarding failed. Stopping further attempts for this session:',
            error
          );
        }

        // Stop the flush timer since we're no longer forwarding
        if (this.flushTimer) {
          clearInterval(this.flushTimer);
          this.flushTimer = null;
        }
      }
    };

    // Use void operator to satisfy @typescript-eslint/no-floating-promises
    void sendLogs();
  }

  /**
   * Cleans up console forwarding by restoring original console methods
   * and sending any remaining buffered messages
   */
  public destroy(): void {
    // Restore original console methods to their unpatched state
    Object.entries(this.originalConsole).forEach(([level, originalMethod]) => {
      (console as unknown as Record<string, (...args: unknown[]) => void>)[level] = originalMethod;
    });

    // Stop the flush timer to prevent further automatic flushes
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Send any remaining buffered messages before cleanup
    this.flush();
  }
}

// Global instance to ensure only one forwarder is active at a time
let forwarder: ConsoleForwarder | null = null;

/**
 * Initializes console forwarding with the given configuration
 * Only one forwarder can be active at a time - destroys existing one if present
 */
export function initConsoleForwarding(config: ConsoleForwardConfig): void {
  if (!config.enabled) return;

  // Destroy existing forwarder to avoid double-patching console methods
  if (forwarder) {
    forwarder.destroy();
  }

  forwarder = new ConsoleForwarder(config);
}

/**
 * Destroys the active console forwarder and restores original console methods
 * Safe to call multiple times or when no forwarder is active
 */
export function destroyConsoleForwarding(): void {
  if (forwarder) {
    forwarder.destroy();
    forwarder = null;
  }
}
