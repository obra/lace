// ABOUTME: Web-local logger to avoid importing agent internals from packages/web.
// ABOUTME: Minimal structured wrapper over console.* with safe metadata serialization.

function format(message: string, meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return message;
  try {
    return `${message} ${JSON.stringify(meta)}`;
  } catch {
    return message;
  }
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    console.info(format(message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(format(message, meta));
  },
  error(message: string, meta?: Record<string, unknown>) {
    console.error(format(message, meta));
  },
  debug(message: string, meta?: Record<string, unknown>) {
    console.debug(format(message, meta));
  },
};
