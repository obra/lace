// ABOUTME: Safe JSON stringification utility that handles circular references and errors
// ABOUTME: Returns '[unserializable]' fallback when JSON.stringify fails

/**
 * Safely stringify an object to JSON, handling circular references and other errors
 * @param obj - Object to stringify
 * @returns JSON string or '[unserializable]' on error
 */
export function safeStringify(obj: unknown): string {
  try {
    const seen = new WeakSet<WeakKey>();
    return JSON.stringify(
      obj,
      (_key, value: unknown) => {
        if (typeof value === 'object' && value !== null) {
          const weakValue = value as WeakKey;
          if (seen.has(weakValue)) {
            return '[Circular]';
          }
          seen.add(weakValue);
        }
        return value;
      },
      2
    );
  } catch (_error) {
    return '[unserializable]';
  }
}
