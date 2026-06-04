// ABOUTME: runExecToolSchemaSync runs a real <bin> lace-tool-schema synchronously.
import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExecToolSchemaSync, minimalEnv } from '../run-once';

it('minimalEnv exposes a minimal allowlist', () => {
  expect(Object.keys(minimalEnv())).toEqual(expect.arrayContaining(['PATH', 'HOME']));
});

it('runs lace-tool-schema synchronously and captures stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exec-'));
  const bin = join(dir, 't.mjs');
  writeFileSync(
    bin,
    "#!/usr/bin/env node\nif (process.argv[2] === 'lace-tool-schema') { process.stdout.write('{\"ok\":true}'); }"
  );
  chmodSync(bin, 0o755);
  const res = runExecToolSchemaSync(bin, dir, 5000);
  expect(res.exitCode).toBe(0);
  expect(res.stdout).toContain('"ok":true');
});
