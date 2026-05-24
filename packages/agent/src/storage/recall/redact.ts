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
