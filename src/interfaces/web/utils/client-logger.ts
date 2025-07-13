// ABOUTME: Client-side logger for web interface with same API as server logger
// ABOUTME: Provides consistent logging interface without Node.js dependencies

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface ClientLogger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

class ClientLoggerImpl implements ClientLogger {
  error(message: string, ...args: unknown[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    console.info(`[INFO] ${message}`, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    console.debug(`[DEBUG] ${message}`, ...args);
  }
}

export const logger: ClientLogger = new ClientLoggerImpl();