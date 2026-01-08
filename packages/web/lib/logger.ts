// ABOUTME: Web-local logger to avoid importing agent internals from packages/web.
// ABOUTME: Minimal structured wrapper over console.* with safe metadata serialization.

function format(message: string, meta?: unknown): string {
  if (meta === null || meta === undefined) return message;
  try {
    return `${message} ${JSON.stringify(meta)}`;
  } catch {
    return message;
  }
}

function writeLine(message: string) {
  try {
    process.stdout.write(`${message}\n`);
  } catch {
    // Ignore logging failures (e.g. during tests with stubbed stdio).
  }
}

export const logger = {
  info(message: string, meta?: unknown) {
    if (process.env.LACE_WEB_LOG) writeLine(format(message, meta));
  },
  warn(message: string, meta?: unknown) {
    console.warn(format(message, meta));
  },
  error(message: string, meta?: unknown) {
    console.error(format(message, meta));
  },
  debug(message: string, meta?: unknown) {
    if (process.env.LACE_WEB_LOG) writeLine(format(message, meta));
  },
};
