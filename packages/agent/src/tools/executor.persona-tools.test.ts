// ABOUTME: injectPersonaTools adds <persona>/tools/ tools, overrides plugin globals, refuses builtins.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { resetRegistriesForTest, registries } from '@lace/agent/plugins';
import { Tool } from './tool';
import type { ToolResult, ToolContext } from './types';
import { ToolExecutor } from './executor';
import { registerBuiltinTools } from './builtins';
import { ExecToolAdapter } from './exec/exec-tool-adapter';

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

  it('per-persona tool overrides a same-named non-reserved global tool', () => {
    // Register a stub plugin/global tool under a non-reserved name.
    // beforeEach has already run resetRegistriesForTest + registerBuiltinTools, so
    // registries.tools contains only builtins — 'plugin-thing' is free to register.
    class StubGlobalTool extends Tool {
      name = 'plugin-thing';
      description = 'a non-reserved plugin tool';
      schema = z.object({});
      protected async executeValidated(_args: unknown, _ctx: ToolContext): Promise<ToolResult> {
        return this.createResult('stub');
      }
    }
    registries.tools.register('plugin-thing', new StubGlobalTool(), 'test-plugin');

    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const globalTool = ex.getTool('plugin-thing');
    expect(globalTool).toBeInstanceOf(StubGlobalTool);

    // Build a persona tools dir with a tool whose schema name matches the global.
    const td = personaToolsDir('plugin-thing');
    ex.injectPersonaTools(td);

    // The global tool must have been overridden by the per-persona ExecToolAdapter.
    const afterInject = ex.getTool('plugin-thing');
    expect(afterInject).toBeInstanceOf(ExecToolAdapter);
    expect(afterInject).not.toBe(globalTool);
  });
});
