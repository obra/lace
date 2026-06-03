// ABOUTME: secret-scanner-plugin — detects secrets and credentials in text or files.
// ABOUTME: Provides two tools under the 'secret-scanner' namespace:
// ABOUTME:   secret-scanner/scan-text — scan a text string for secrets/credentials
// ABOUTME:   secret-scanner/scan-file — read a file from disk and scan it for secrets
// ABOUTME: Detects: AWS access keys, generic API keys, JWTs, GitHub tokens, PEM private
// ABOUTME: keys, and high-entropy bearer tokens. No network, no npm deps — stdlib only.
//
// ── PACKAGING CONTRACT ────────────────────────────────────────────────────────
// Ships as a SEPARATE package from @lace/agent. Mark @lace/agent EXTERNAL in
// your bundler so there is exactly one registry instance.
// Type-only imports are erased at build time and are safe.
// The only value import from the kernel is the Tool base class (you extends it).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';

export const meta = {
  name: 'secret-scanner',
  namespace: 'secret-scanner',
  version: '1.0.0',
};

// ── Detection rules ───────────────────────────────────────────────────────────

/**
 * A single detection rule: a named pattern with a regex and an optional entropy
 * gate (Shannon entropy threshold for the matched capture group).
 */
interface SecretRule {
  /** Human-readable kind label, e.g. "AWS Access Key ID" */
  kind: string;
  /** Regex with exactly one capture group: the secret value itself */
  pattern: RegExp;
  /**
   * Minimum Shannon entropy (bits per character) for the captured value.
   * Skipping the gate (undefined) trusts the pattern alone — appropriate for
   * fixed-format tokens like AWS key IDs or JWTs where the structure is
   * already highly discriminating.
   */
  minEntropy?: number;
}

/**
 * A single finding: a rule match at a specific location in the input.
 */
interface Finding {
  kind: string;
  /** The matched secret value (first capture group) */
  value: string;
  /** 1-based line number in the input */
  line: number;
  /** Shannon entropy of the matched value in bits per character */
  entropy: number;
}

/**
 * Computes Shannon entropy (bits per character) of a string.
 * Returns 0 for empty strings.
 */
function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Ordered from most-specific (fixed-format) to most-generic (high-entropy fallback).
// Each rule's pattern must have exactly one capture group (the secret value).
const RULES: SecretRule[] = [
  {
    // AWS Access Key IDs: always start with AKIA (long-term) or ASIA (session),
    // followed by exactly 16 uppercase letters/digits.
    kind: 'AWS Access Key ID',
    pattern: /\b((?:AKIA|ASIA|AROA|ABIA|ACCA)[A-Z0-9]{16})\b/g,
  },
  {
    // AWS Secret Access Keys: 40-character base64url string typically preceded
    // by context keywords. No keyword gate here — the entropy alone is high enough,
    // and the tight length + charset makes false positives rare.
    kind: 'AWS Secret Access Key',
    pattern: /\b([A-Za-z0-9/+]{40})\b/g,
    minEntropy: 4.5,
  },
  {
    // GitHub personal access tokens (classic): ghp_<36 alphanumeric>
    kind: 'GitHub Personal Access Token (classic)',
    pattern: /\b(ghp_[A-Za-z0-9]{36})\b/g,
  },
  {
    // GitHub fine-grained PATs: github_pat_<22 base62>_<59 base62>
    kind: 'GitHub Fine-Grained PAT',
    pattern: /\b(github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})\b/g,
  },
  {
    // GitHub OAuth tokens: gho_<36 alphanumeric>
    kind: 'GitHub OAuth Token',
    pattern: /\b(gho_[A-Za-z0-9]{36})\b/g,
  },
  {
    // GitHub Actions tokens: ghs_<36 alphanumeric>
    kind: 'GitHub Actions Token',
    pattern: /\b(ghs_[A-Za-z0-9]{36})\b/g,
  },
  {
    // JWTs: three base64url segments separated by dots, first two non-trivially long.
    // The header must decode to a valid JSON object (we don't validate, just length-gate).
    kind: 'JSON Web Token (JWT)',
    pattern: /\b(ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
  },
  {
    // PEM-encoded private keys: PKCS#8, RSA, EC, DSA, OpenSSH.
    kind: 'PEM Private Key',
    pattern:
      /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |)?PRIVATE KEY-----[\s\S]{20,}?-----END (?:RSA |EC |DSA |OPENSSH |)?PRIVATE KEY-----)/g,
  },
  {
    // Slack API tokens: xoxb (bot), xoxp (user), xoxs (workspace), xoxa (app-level)
    kind: 'Slack Token',
    pattern: /\b(xox[bpsa]-[0-9A-Za-z-]{24,})\b/g,
  },
  {
    // Stripe live secret keys: sk_live_<24+ alphanumeric>
    kind: 'Stripe Live Secret Key',
    pattern: /\b(sk_live_[0-9A-Za-z]{24,})\b/g,
  },
  {
    // Stripe test secret keys: sk_test_<24+ alphanumeric> (useful to flag in prod configs)
    kind: 'Stripe Test Secret Key',
    pattern: /\b(sk_test_[0-9A-Za-z]{24,})\b/g,
  },
  {
    // Generic high-entropy API key assignment: key = "...high-entropy-value..."
    // Requires both a keyword context and high entropy to minimise false positives.
    kind: 'Generic API Key (high-entropy assignment)',
    pattern:
      /(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|bearer)\s*[=:]\s*["']?([A-Za-z0-9/+_.-]{32,})["']?/gi,
    minEntropy: 4.0,
  },
];

/**
 * Scan the given text for secret patterns. Returns all findings in order of
 * appearance. Overlapping matches from the same rule are deduplicated.
 */
function scanText(text: string): Finding[] {
  const lines = text.split('\n');
  // Build a line-start offset table for converting absolute offsets to line numbers.
  const lineStartOffsets: number[] = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    lineStartOffsets.push(lineStartOffsets[i] + lines[i].length + 1);
  }

  function offsetToLine(offset: number): number {
    // Binary search for the line containing offset.
    let lo = 0;
    let hi = lineStartOffsets.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStartOffsets[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1; // 1-based
  }

  const findings: Finding[] = [];
  // Track (kind, value) pairs already emitted to avoid duplicates from overlapping
  // global-flag re-runs on the same text.
  const seen = new Set<string>();

  for (const rule of RULES) {
    // Reset lastIndex so each scan starts from the top.
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(text)) !== null) {
      const value = match[1];
      if (!value) continue;

      const entropy = shannonEntropy(value);
      if (rule.minEntropy !== undefined && entropy < rule.minEntropy) continue;

      const key = `${rule.kind}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      findings.push({
        kind: rule.kind,
        value,
        line: offsetToLine(match.index),
        entropy: Math.round(entropy * 100) / 100,
      });
    }
    // Reset lastIndex after the loop so subsequent calls reuse the compiled regex cleanly.
    rule.pattern.lastIndex = 0;
  }

  // Sort findings by line number for a deterministic, readable output.
  findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));

  return findings;
}

/**
 * Format findings as a human-readable summary string.
 */
function formatFindings(findings: Finding[], source: string): string {
  if (findings.length === 0) {
    return `No secrets detected in ${source}.`;
  }

  const lines: string[] = [`Found ${findings.length} potential secret(s) in ${source}:\n`];
  for (const f of findings) {
    // Truncate values 16+ chars for display — never emit a full secret in a tool
    // result that might be logged or displayed verbatim in a UI.
    const display = f.value.length >= 16 ? `${f.value.slice(0, 10)}…[redacted]` : f.value;
    lines.push(`  Line ${f.line}: [${f.kind}] ${display} (entropy: ${f.entropy} bits/char)`);
  }
  return lines.join('\n');
}

// ── Tool: secret-scanner/scan-text ───────────────────────────────────────────

class ScanTextTool extends Tool {
  name = 'secret-scanner/scan-text';
  description =
    'Scans a text string for secrets and credentials — AWS access keys, GitHub tokens, ' +
    'JWTs, Stripe keys, Slack tokens, PEM private keys, and high-entropy API key ' +
    'assignments. Returns a list of findings with kind, line number, and entropy. ' +
    'Useful for reviewing code snippets, config files, or log output before sharing ' +
    'or committing them. Never transmits data externally; all analysis is local.';

  schema = z.object({
    text: z
      .string()
      .min(1)
      .describe('The text to scan. May be multi-line (e.g. a file snippet or config block).'),
    source_label: z
      .string()
      .optional()
      .describe(
        'Optional label for the text origin (e.g. filename or URL). Used only in the ' +
          'result summary string; does not affect detection. Defaults to "<input>".'
      ),
  });

  protected async executeValidated(
    args: { text: string; source_label?: string },
    _ctx: ToolContext
  ): Promise<ToolResult> {
    const source = args.source_label ?? '<input>';
    const findings = scanText(args.text);
    const summary = formatFindings(findings, source);

    return this.createResult(
      JSON.stringify({
        source,
        findingCount: findings.length,
        clean: findings.length === 0,
        findings: findings.map((f) => ({
          kind: f.kind,
          line: f.line,
          entropy: f.entropy,
          // Never echo the full secret value in the structured result — include only
          // a truncated preview to help the caller identify which occurrence to fix.
          valuePreview: f.value.length >= 16 ? `${f.value.slice(0, 10)}…[redacted]` : f.value,
        })),
        summary,
      })
    );
  }
}

// ── Tool: secret-scanner/scan-file ───────────────────────────────────────────

class ScanFileTool extends Tool {
  name = 'secret-scanner/scan-file';
  description =
    'Reads a file from disk and scans it for secrets and credentials. Supports any ' +
    'text file (source code, config, dotenv, YAML, JSON, etc.). Returns the same ' +
    'structured findings as secret-scanner/scan-text. The file is read relative to ' +
    'the session working directory (workingDirectory context field) if the path is ' +
    'not absolute. Fails gracefully if the file does not exist or cannot be read.';

  schema = z.object({
    path: z
      .string()
      .min(1)
      .describe(
        'Path to the file to scan. May be absolute or relative to the session ' +
          'working directory.'
      ),
  });

  protected async executeValidated(args: { path: string }, ctx: ToolContext): Promise<ToolResult> {
    // Resolve the path against the session working directory if relative.
    const { resolve, isAbsolute } = await import('node:path');
    const resolvedPath = isAbsolute(args.path)
      ? args.path
      : resolve(ctx.workingDirectory ?? process.cwd(), args.path);

    let text: string;
    try {
      text = readFileSync(resolvedPath, 'utf8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return this.createError(`Cannot read file "${resolvedPath}": ${message}`);
    }

    const findings = scanText(text);
    const summary = formatFindings(findings, resolvedPath);

    return this.createResult(
      JSON.stringify({
        source: resolvedPath,
        findingCount: findings.length,
        clean: findings.length === 0,
        findings: findings.map((f) => ({
          kind: f.kind,
          line: f.line,
          entropy: f.entropy,
          valuePreview: f.value.length >= 16 ? `${f.value.slice(0, 10)}…[redacted]` : f.value,
        })),
        summary,
      })
    );
  }
}

// ── register ──────────────────────────────────────────────────────────────────

export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.tools.register('secret-scanner/scan-text', new ScanTextTool());
  api.tools.register('secret-scanner/scan-file', new ScanFileTool());
}

export default { meta, register } satisfies PluginModule;
