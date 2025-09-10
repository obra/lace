// ABOUTME: Simple file logger with multiple log levels
// ABOUTME: Does not pollute stdout/stderr, writes only to files

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

class Logger {
  private _level: LogLevel = 'info';
  private _logFile?: string;
  private _useStderr: boolean = false;

  configure(level: LogLevel, logFile?: string, useStderr: boolean = false) {
    this._level = level;
    this._logFile = logFile;
    this._useStderr = useStderr;

    if (logFile) {
      const logDir = dirname(logFile);
      if (!existsSync(logDir)) {
        try {
          mkdirSync(logDir, { recursive: true });
        } catch {
          // Ignore directory creation errors
          this._logFile = undefined;
        }
      }
    }
  }

  private _shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= LOG_LEVELS[this._level];
  }

  shouldLog(level: LogLevel): boolean {
    return this._shouldLog(level);
  }

  private _write(level: LogLevel, message: string, data?: unknown) {
    if (!this._shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = data
      ? `${timestamp} [${level.toUpperCase()}] ${message} ${JSON.stringify(data)}\n`
      : `${timestamp} [${level.toUpperCase()}] ${message}\n`;

    // Write to file if configured
    if (this._logFile) {
      try {
        appendFileSync(this._logFile, logEntry);
      } catch {
        // Ignore write errors to avoid breaking the app
      }
    }

    // Write to stderr if configured
    if (this._useStderr) {
      process.stderr.write(logEntry);
    }
  }

  error(message: string, data?: unknown) {
    this._write('error', message, data);
  }

  warn(message: string, data?: unknown) {
    this._write('warn', message, data);
  }

  info(message: string, data?: unknown) {
    this._write('info', message, data);
  }

  debug(message: string, data?: unknown) {
    this._write('debug', message, data);
  }
}

// Global logger instance using globalThis to work across Next.js bundle isolation
declare global {
  var __laceLogger: Logger | undefined;
}

const getLogger = (): Logger => {
  if (!globalThis.__laceLogger) {
    globalThis.__laceLogger = new Logger();

    // Auto-configure from environment variables for multi-process scenarios
    const logLevel = process.env.LACE_LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug' | undefined;
    const logFile = process.env.LACE_LOG_FILE;
    const useStderr = process.env.LACE_LOG_STDERR === 'true';

    if (logLevel || logFile || useStderr) {
      globalThis.__laceLogger.configure(logLevel || 'info', logFile, useStderr);
    }
  }
  return globalThis.__laceLogger;
};

export const logger = getLogger();
