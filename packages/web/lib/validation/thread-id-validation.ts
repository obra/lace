// ABOUTME: Client-safe ThreadId validation for web interface
// ABOUTME: Replicates core ThreadId validation logic without server-only imports

/**
 * Client-safe ThreadId validation that mirrors the core isThreadId function
 * Accepts both lace_YYYYMMDD_randomId format and UUID format, with optional .N suffix for agents
 */
export function isValidThreadId(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  // Pattern for lace_YYYYMMDD_randomId format with optional .N suffix
  const lacePattern = /^lace_\d{8}_[a-zA-Z0-9]+(\.\d+)?$/;

  // Pattern for UUID format with optional .N suffix
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.\d+)?$/;

  return lacePattern.test(value) || uuidPattern.test(value);
}

/**
 * Convert a validated string to ThreadId type
 * This is a simple type assertion since ThreadId is just a branded string
 */
export function asValidThreadId(value: string): string {
  if (!isValidThreadId(value)) {
    throw new Error(`Invalid ThreadId format: ${value}`);
  }
  return value;
}
