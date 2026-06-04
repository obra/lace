// ABOUTME: registerExecDirInto registers discovered exec tools under a namespace+owner.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerExecDirInto, registerCoreExecTools } from '../register-exec';

function toolDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'xt-'));
  const bin = join(dir, `${name}.mjs`);
  writeFileSync(
    bin,
    '#!/usr/bin/env node\nif (process.argv[2]===\'lace-tool-schema\') process.stdout.write(\'{"name":"' +
      name +
      '","description":"d","inputSchema":{"type":"object"}}\');'
  );
  chmodSync(bin, 0o755);
  return dir;
}

describe('register-exec', () => {
  beforeEach(() => resetRegistriesForTest());
  it('registers a plugin exec dir namespaced ns:entry under the plugin owner', () => {
    registerExecDirInto(toolDir('stats'), { namespace: 'acme', owner: 'acme' });
    expect(registries.tools.has('acme:stats')).toBe(true);
    expect(registries.tools.owner('acme:stats')).toBe('acme');
  });
  it('registerCoreExecTools no-ops when the core dir is absent', () => {
    expect(() => registerCoreExecTools('/nonexistent/agent-exec-tools')).not.toThrow();
  });
});
