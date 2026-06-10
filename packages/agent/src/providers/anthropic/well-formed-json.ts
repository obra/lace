// ABOUTME: Replaces lone UTF-16 surrogates so request bodies stay well-formed JSON.

// A lone surrogate (a high D800–DBFF not followed by a low DC00–DFFF, or a low
// not preceded by a high) survives JSON.stringify as a bare \uD8XX escape. That
// is technically legal JSON syntax, but strict server parsers — including the
// Anthropic API — reject it ("no low surrogate in string"). Such code units only
// appear when some upstream step (e.g. history compaction) truncates a string
// mid-surrogate-pair. We replace each lone surrogate with U+FFFD before send.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Return `value` with every lone surrogate inside any string replaced by U+FFFD,
 * walking nested arrays/objects. Strings and containers that need no fixing are
 * returned by the same reference, so a clean payload is structurally untouched
 * (preserving prompt-cache identity); only the subtree holding a lone surrogate
 * is rebuilt.
 */
export function sanitizeLoneSurrogates<T>(value: T): T {
  if (typeof value === 'string') {
    const fixed = value.replace(LONE_SURROGATE, '�');
    return (fixed === value ? value : fixed) as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const sanitized = sanitizeLoneSurrogates(item);
      if (sanitized !== item) changed = true;
      return sanitized;
    });
    return changed ? (out as T) : value;
  }
  if (value !== null && typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const sanitized = sanitizeLoneSurrogates(item);
      if (sanitized !== item) changed = true;
      out[key] = sanitized;
    }
    return changed ? (out as T) : value;
  }
  return value;
}
