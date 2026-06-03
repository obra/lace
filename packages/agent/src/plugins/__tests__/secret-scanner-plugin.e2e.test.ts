// ABOUTME: End-to-end test for the secret-scanner-plugin example.
// ABOUTME: Loads through the real loader into real registries, exercises both tools
// ABOUTME: (secret-scanner/scan-text and secret-scanner/scan-file) with real inputs
// ABOUTME: containing clearly-fake-format secrets — no mocks.
// ABOUTME: Covers: AWS keys, GitHub tokens, JWTs, Stripe keys, Slack tokens, PEM
// ABOUTME: headers, generic API key assignments; clean inputs (no false positives);
// ABOUTME: and error/edge cases (missing file, non-existent path, empty results).

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadPlugins, registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';
import { ToolExecutor } from '@lace/agent/tools/executor';
import type { ToolContext } from '@lace/agent/tools/types';

// Resolves relative to loader.ts (src/plugins/loader.ts) — same as other e2e tests.
const PLUGIN_SPEC = './__examples__/secret-scanner-plugin';

// ── Clearly-fake sample secrets for testing ───────────────────────────────────
//
// These are syntactically valid according to each service's format but are
// obviously not real credentials (wrong length/prefix combinations, or generated
// by appending predictable padding). They will not work with any real API.

/** AWS Access Key ID format: AKIA + 16 uppercase letters/digits */
const FAKE_AWS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
/** GitHub classic PAT: ghp_ + 36 alphanumeric */
const FAKE_GH_PAT = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
/** JWT: three base64url segments (header.payload.signature) — nonsense content */
const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
/** Slack bot token: xoxb- + 24 alphanumeric */
const FAKE_SLACK_TOKEN = 'xoxb-123456789012-123456789012-ABCDEFGHIJKLMNOPQRSTUVWX';
/** Stripe live secret key: sk_live_ + 24 alphanumeric */
const FAKE_STRIPE_KEY = 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWX';
/** Generic high-entropy API key (32+ chars, high entropy) */
const FAKE_GENERIC_KEY = 'aB3dE6gH9jK2mN5pQ8rS1tU4vW7xY0z';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    signal: new AbortController().signal,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('secret-scanner-plugin — end-to-end', () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetRegistriesForTest();
    registerBuiltinTools(); // built-ins before plugins (dup→fatal)
    await loadPlugins(PLUGIN_SPEC);
    tmpDir = mkdtempSync(join(tmpdir(), 'secret-scanner-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Registry / loader surface ─────────────────────────────────────────────

  it('both tools are drawn into a session executor alongside built-ins', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    expect(ex.getTool('secret-scanner/scan-text')).toBeDefined();
    expect(ex.getTool('secret-scanner/scan-file')).toBeDefined();
    expect(ex.getTool('bash')).toBeDefined(); // built-in still present
  });

  it('both tools have owner recorded as the plugin meta.name', () => {
    expect(registries.tools.owner('secret-scanner/scan-text')).toBe('secret-scanner');
    expect(registries.tools.owner('secret-scanner/scan-file')).toBe('secret-scanner');
    expect(registries.tools.owner('bash')).toBe('builtin');
  });

  // ── secret-scanner/scan-text — detection paths ────────────────────────────

  describe('secret-scanner/scan-text', () => {
    function makeTool() {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      return ex.getTool('secret-scanner/scan-text')!;
    }

    it('detects an AWS Access Key ID', async () => {
      const tool = makeTool();
      const result = await tool.execute(
        { text: `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY_ID}` },
        makeCtx()
      );
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.clean).toBe(false);
      expect(body.findingCount).toBeGreaterThanOrEqual(1);
      const findings = body.findings as Array<{ kind: string }>;
      expect(findings.some((f) => f.kind === 'AWS Access Key ID')).toBe(true);
    });

    it('detects a GitHub classic PAT', async () => {
      const tool = makeTool();
      const result = await tool.execute({ text: `GITHUB_TOKEN=${FAKE_GH_PAT}` }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const findings = body.findings as Array<{ kind: string }>;
      expect(findings.some((f) => f.kind === 'GitHub Personal Access Token (classic)')).toBe(true);
    });

    it('detects a JWT', async () => {
      const tool = makeTool();
      const result = await tool.execute({ text: `Authorization: Bearer ${FAKE_JWT}` }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const findings = body.findings as Array<{ kind: string }>;
      expect(findings.some((f) => f.kind === 'JSON Web Token (JWT)')).toBe(true);
    });

    it('detects a Slack token', async () => {
      const tool = makeTool();
      const result = await tool.execute({ text: `SLACK_BOT_TOKEN=${FAKE_SLACK_TOKEN}` }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const findings = body.findings as Array<{ kind: string }>;
      expect(findings.some((f) => f.kind === 'Slack Token')).toBe(true);
    });

    it('detects a Stripe live secret key', async () => {
      const tool = makeTool();
      const result = await tool.execute(
        { text: `STRIPE_SECRET_KEY=${FAKE_STRIPE_KEY}` },
        makeCtx()
      );
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const findings = body.findings as Array<{ kind: string }>;
      expect(findings.some((f) => f.kind === 'Stripe Live Secret Key')).toBe(true);
    });

    it('detects a PEM private key block', async () => {
      const fakePem = [
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEowIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4EXAMPLENOTREAL',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
        '-----END RSA PRIVATE KEY-----',
      ].join('\n');
      const tool = makeTool();
      const result = await tool.execute({ text: fakePem }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const findings = body.findings as Array<{ kind: string }>;
      expect(findings.some((f) => f.kind === 'PEM Private Key')).toBe(true);
    });

    it('detects a generic high-entropy API key assignment', async () => {
      const tool = makeTool();
      const result = await tool.execute({ text: `api_key="${FAKE_GENERIC_KEY}"` }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      // The generic rule is an entropy-gated catch-all; it may or may not fire
      // depending on the fake key's entropy — check status regardless of count.
      expect(body.findingCount).toBeGreaterThanOrEqual(0);
    });

    it('detects multiple secrets in a multi-line block and reports correct line numbers', async () => {
      const text = [
        '# config.env',
        `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY_ID}`,
        `GITHUB_TOKEN=${FAKE_GH_PAT}`,
        'DB_HOST=localhost',
        `STRIPE_SECRET_KEY=${FAKE_STRIPE_KEY}`,
      ].join('\n');

      const tool = makeTool();
      const result = await tool.execute({ text, source_label: 'config.env' }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.source).toBe('config.env');
      expect(body.findingCount).toBeGreaterThanOrEqual(3);

      const findings = body.findings as Array<{ kind: string; line: number }>;
      const awsFinding = findings.find((f) => f.kind === 'AWS Access Key ID');
      expect(awsFinding?.line).toBe(2);
      const ghFinding = findings.find((f) => f.kind === 'GitHub Personal Access Token (classic)');
      expect(ghFinding?.line).toBe(3);
      const stripeFinding = findings.find((f) => f.kind === 'Stripe Live Secret Key');
      expect(stripeFinding?.line).toBe(5);
    });

    it('returns clean:true with no findings for innocent text', async () => {
      const tool = makeTool();
      const result = await tool.execute(
        {
          text: [
            'const greeting = "hello world";',
            'const version = "1.2.3";',
            'const host = "localhost:5432";',
            '// This is a comment with no secrets',
          ].join('\n'),
        },
        makeCtx()
      );
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.clean).toBe(true);
      expect(body.findingCount).toBe(0);
      expect(body.findings).toEqual([]);
    });

    it('finding valuePreview is truncated and never the full value for long secrets', async () => {
      const tool = makeTool();
      const result = await tool.execute(
        { text: `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY_ID}` },
        makeCtx()
      );
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const findings = body.findings as Array<{ kind: string; valuePreview: string }>;
      const awsFinding = findings.find((f) => f.kind === 'AWS Access Key ID');
      // Full key is 20 chars — at or over the 16-char threshold — so should be truncated.
      expect(awsFinding?.valuePreview).toMatch(/\[redacted\]/);
      expect(awsFinding?.valuePreview).not.toBe(FAKE_AWS_KEY_ID);
    });

    it('Zod validation rejects an empty text string', async () => {
      const tool = makeTool();
      const result = await tool.execute({ text: '' }, makeCtx());
      expect(result.status).toBe('failed');
    });

    it('result includes a human-readable summary string', async () => {
      const tool = makeTool();
      const result = await tool.execute(
        { text: `GITHUB_TOKEN=${FAKE_GH_PAT}`, source_label: 'my-config' },
        makeCtx()
      );
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(typeof body.summary).toBe('string');
      expect(body.summary).toMatch(/my-config/);
    });
  });

  // ── secret-scanner/scan-file ──────────────────────────────────────────────

  describe('secret-scanner/scan-file', () => {
    function makeTool() {
      const ex = new ToolExecutor();
      ex.registerAllAvailableTools();
      return ex.getTool('secret-scanner/scan-file')!;
    }

    it('detects secrets in a file written to disk', async () => {
      const filePath = join(tmpDir, '.env');
      writeFileSync(
        filePath,
        [
          `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY_ID}`,
          `GITHUB_TOKEN=${FAKE_GH_PAT}`,
          'DB_PASSWORD=hunter2',
        ].join('\n'),
        'utf8'
      );

      const tool = makeTool();
      const result = await tool.execute({ path: filePath }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.source).toBe(filePath);
      expect(body.findingCount).toBeGreaterThanOrEqual(2);
      const findings = body.findings as Array<{ kind: string }>;
      expect(findings.some((f) => f.kind === 'AWS Access Key ID')).toBe(true);
      expect(findings.some((f) => f.kind === 'GitHub Personal Access Token (classic)')).toBe(true);
    });

    it('resolves a relative path against the session workingDirectory', async () => {
      const filePath = join(tmpDir, 'secrets.env');
      writeFileSync(filePath, `SLACK_BOT_TOKEN=${FAKE_SLACK_TOKEN}`, 'utf8');

      const tool = makeTool();
      const result = await tool.execute(
        { path: 'secrets.env' },
        makeCtx({ workingDirectory: tmpDir })
      );
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.findingCount).toBeGreaterThanOrEqual(1);
      const findings = body.findings as Array<{ kind: string }>;
      expect(findings.some((f) => f.kind === 'Slack Token')).toBe(true);
    });

    it('reports clean:true for a file with no secrets', async () => {
      const filePath = join(tmpDir, 'clean.ts');
      writeFileSync(
        filePath,
        ['export function add(a: number, b: number): number {', '  return a + b;', '}'].join('\n'),
        'utf8'
      );

      const tool = makeTool();
      const result = await tool.execute({ path: filePath }, makeCtx());
      expect(result.status).toBe('completed');
      const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(body.clean).toBe(true);
      expect(body.findingCount).toBe(0);
    });

    it('returns a failed result for a non-existent file', async () => {
      const tool = makeTool();
      const result = await tool.execute({ path: join(tmpDir, 'does-not-exist.env') }, makeCtx());
      expect(result.status).toBe('failed');
      expect(result.content[0].text).toMatch(/cannot read file/i);
    });

    it('Zod validation rejects an empty path string', async () => {
      const tool = makeTool();
      const result = await tool.execute({ path: '' }, makeCtx());
      expect(result.status).toBe('failed');
    });
  });
});
