// ABOUTME: injectPersonaTools adds <persona>/tools/ tools, overrides plugin globals, refuses builtins.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetRegistriesForTest } from '@lace/agent/plugins';
import { ToolExecutor } from './executor';
import { registerBuiltinTools } from './builtins';

function personaToolsDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pt-'));
  const td = join(root, 'tools');
  mkdirSync(td, { recursive: true });
  const bin = join(td, `${name}.mjs`);
  writeFileSync(
    bin,
    '#!/usr/bin/env node\nif (process.argv[2]===\'lace-tool-schema\') process.stdout.write(\'{"name":"' +
      name +
      '","description":"d","inputSchema":{"type":"object"}}\');'
  );
  chmodSync(bin, 0o755);
  return td;
}

describe('injectPersonaTools', () => {
  beforeEach(() => {
    resetRegistriesForTest();
    registerBuiltinTools();
  });
  it('injects a per-persona tool', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    ex.injectPersonaTools(personaToolsDir('scout-helper'));
    expect(ex.getTool('scout-helper')).toBeDefined();
  });
  it('refuses to override a reserved builtin (bash)', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const before = ex.getTool('bash');
    ex.injectPersonaTools(personaToolsDir('bash'));
    expect(ex.getTool('bash')).toBe(before); // unchanged — builtin not overridden
  });
  it('does nothing for a null dir', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    expect(() => ex.injectPersonaTools(null)).not.toThrow();
  });
});
