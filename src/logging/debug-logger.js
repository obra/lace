// ABOUTME: Configurable debug logger with dual output support (stderr and file)
// ABOUTME: Implements log levels (debug/info/warn/error) with thread-safe file writing

import { promises as fs } from "fs";
import { dirname } from "path";

export class DebugLogger {
  constructor(options = {}) {
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      off: 999,
    };

    this.stderrLevel = this.parseLevel(options.logLevel || "off");
    this.fileLevel = this.parseLevel(options.logFileLevel || "off");
    this.filePath = options.logFile;

    this.pendingWrites = [];
    this.writeQueue = Promise.resolve();
  }

  parseLevel(level) {
    if (!level || typeof level !== "string") {
      return "off";
    }
    const normalizedLevel = level.toLowerCase();
    if (this.levels.hasOwnProperty(normalizedLevel)) {
      return normalizedLevel;
    }
    return "off";
  }

  shouldLog(level, outputType) {
    const levelNum = this.levels[level];
    if (outputType === "stderr") {
      return levelNum >= this.levels[this.stderrLevel];
    } else if (outputType === "file") {
      return !!this.filePath && levelNum >= this.levels[this.fileLevel];
    }
    return false;
  }

  formatMessage(level, message, timestamp = new Date()) {
    const ts = timestamp.toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    return `${ts} [${levelStr}] ${message}`;
  }

  async writeToFile(message) {
    if (!this.filePath) return;

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.mkdir(dirname(this.filePath), { recursive: true });
        await fs.appendFile(this.filePath, `${message}\n`, "utf8");
      } catch (error) {
        console.error(
          `Failed to write to log file ${this.filePath}:`,
          error.message,
        );
      }
    });

    return this.writeQueue;
  }

  log(level, message) {
    const timestamp = new Date();
    const formattedMessage = this.formatMessage(level, message, timestamp);

    if (this.shouldLog(level, "stderr")) {
      console.error(formattedMessage);
    }

    if (this.shouldLog(level, "file")) {
      this.writeToFile(formattedMessage);
    }
  }

  debug(message) {
    this.log("debug", message);
  }

  info(message) {
    this.log("info", message);
  }

  warn(message) {
    this.log("warn", message);
  }

  error(message) {
    this.log("error", message);
  }
}
