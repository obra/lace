// ABOUTME: Simple file logger with multiple log levels
// ABOUTME: Does not pollute stdout/stderr, writes only to files

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

class Logger {
  private _level: LogLevel = 'info';
  private _logFile?: string;

  configure(level: LogLevel, logFile?: string) {
    this._level = level;
    this._logFile = logFile;

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

  private _write(level: LogLevel, message: string, data?: unknown) {
    if (!this._shouldLog(level) || !this._logFile) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = data
      ? `${timestamp} [${level.toUpperCase()}] ${message} ${JSON.stringify(data)}\n`
      : `${timestamp} [${level.toUpperCase()}] ${message}\n`;

    try {
      appendFileSync(this._logFile, logEntry);
    } catch {
      // Ignore write errors to avoid breaking the app
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

// Global logger instance
export const logger = new Logger();
