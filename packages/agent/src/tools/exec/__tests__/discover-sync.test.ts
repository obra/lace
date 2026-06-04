// ABOUTME: discoverExecToolsSync scans a dir, probes each executable synchronously.
import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverExecToolsSync } from '../discover';

it('discovers a valid exec tool and skips a bad one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'disc-'));
  const good = join(dir, 'good.mjs');
  writeFileSync(
    good,
    '#!/usr/bin/env node\nif (process.argv[2]===\'lace-tool-schema\') process.stdout.write(\'{"name":"good","description":"d","inputSchema":{"type":"object"}}\');'
  );
  chmodSync(good, 0o755);
  const bad = join(dir, 'bad.mjs');
  writeFileSync(bad, '#!/usr/bin/env node\nprocess.exit(3);');
  chmodSync(bad, 0o755);
  const tools = discoverExecToolsSync(dir);
  expect(tools.map((t) => t.name)).toEqual(['good']);
});

it('applies a namePrefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'disc2-'));
  const good = join(dir, 'g.mjs');
  writeFileSync(
    good,
    '#!/usr/bin/env node\nif (process.argv[2]===\'lace-tool-schema\') process.stdout.write(\'{"name":"g","description":"d","inputSchema":{"type":"object"}}\');'
  );
  chmodSync(good, 0o755);
  expect(discoverExecToolsSync(dir, 'acme:').map((t) => t.name)).toEqual(['acme:g']);
});
