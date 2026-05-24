// ABOUTME: Best-effort secret redaction for the recall tool
// ABOUTME: Hardcoded pattern list; defense in depth, not a security boundary

const PATTERNS: Array<{ tag: string; re: RegExp }> = [
  { tag: 'slack', re: /xox[bpa]-[A-Za-z0-9-]{20,}/g },
  { tag: 'anthropic-or-openai', re: /sk-(?:ant|proj)-[A-Za-z0-9_-]{20,}/g },
  { tag: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  { tag: 'github', re: /gh[pousr]_[A-Za-z0-9]{36,}(?![A-Za-z0-9])/g },
  { tag: '1password', re: /ops_[A-Za-z0-9_-]{20,}/g },
  { tag: 'google', re: /AIza[0-9A-Za-z_-]{35}/g },
];

export function redact(text: string): string {
  let out = text;
  for (const { tag, re } of PATTERNS) {
    out = out.replace(re, `<REDACTED:${tag}>`);
  }
  return out;
}

/**
 * Prefix-only variants of the redaction patterns, for snippet boundaries where
 * the secret may have been truncated below the main regex's minimum-tail length.
 * Apply ONLY to FTS5 snippet output, not to full content — these are looser and
 * may false-positive on `xoxb-`-prefixed non-secret strings.
 *
 * Note: aws-access-key is omitted because its strict pattern is already a
 * fixed-length 20-char token (no minimum-tail concern), and AKIA-prefixed
 * non-secret strings are too common to risk a prefix-only match.
 */
const PREFIX_PATTERNS: Array<{ tag: string; re: RegExp }> = [
  { tag: 'slack', re: /xox[bpa]-[A-Za-z0-9-]{5,}/g },
  { tag: 'anthropic-or-openai', re: /sk-(?:ant|proj)-[A-Za-z0-9_-]{5,}/g },
  { tag: 'github', re: /gh[pousr]_[A-Za-z0-9]{5,}/g },
  { tag: '1password', re: /ops_[A-Za-z0-9_-]{5,}/g },
  { tag: 'google', re: /AIza[0-9A-Za-z_-]{5,}/g },
];

/**
 * Like `redact`, but adds a second prefix-only pass for truncated secrets at
 * FTS5 snippet boundaries. Order matters: a full strict match consumes more
 * chars and produces a `<REDACTED:...>` marker that the prefix pass won't
 * re-match (the marker has no `xoxb-`-shaped prefix).
 */
export function redactSnippet(text: string): string {
  let out = redact(text);
  for (const { tag, re } of PREFIX_PATTERNS) {
    out = out.replace(re, `<REDACTED:${tag}>`);
  }
  return out;
}
