// ABOUTME: Whole-system integration test — one plugin registers into all four registries;
// ABOUTME: asserts visibility at every consumption site (executor, compaction, runtimes, personas).
// ABOUTME: If this test breaks, the mechanism is broken end-to-end. Keep it green.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPlugins,
  registries,
  resetRegistriesForTest,
  pluginMayUseCapability,
} from '@lace/agent/plugins';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';
import {
  registerBuiltinCompaction,
  resolveCompactionStrategy,
} from '@lace/agent/compaction/strategy';
import {
  registerBuiltinRuntimes,
  createDefaultContainerManager,
} from '@lace/agent/containers/manager-factory';
import { ToolExecutor } from '@lace/agent/tools/executor';
import { PersonaRegistry } from '@lace/agent/config/persona-registry';

// The specifier resolves relative to loader.ts (src/plugins/loader.ts), which
// is the importer. The examples directory is a sibling of __fixtures__: both
// live under src/plugins/. Same resolution pattern the loader.test.ts uses for
// './__fixtures__/good-plugin'.
const REF = './__examples__/reference-plugin';

describe('whole plugin system — reference plugin reaches all four registries', () => {
  beforeEach(async () => {
    resetRegistriesForTest();
    // Built-ins must register BEFORE plugins so a plugin name-clash with a
    // built-in is fatal at load (dup→fatal, uniform for both sources).
    registerBuiltinTools();
    registerBuiltinCompaction();
    registerBuiltinRuntimes();
    // Then load the plugin.
    await loadPlugins(REF);
  });

  it('tools: the plugin tool is drawn into a session executor alongside built-ins', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    expect(ex.getTool('reference/greet')).toBeDefined();
    expect(ex.getTool('bash')).toBeDefined(); // built-in still present
  });

  it('compaction: the plugin strategy resolves by name; built-in track-based still present', () => {
    expect(resolveCompactionStrategy('reference/quiet').name).toBe('reference/quiet');
    expect(resolveCompactionStrategy('track-based').name).toBe('track-based');
  });

  it('runtimes: the plugin runtime is selectable by name', () => {
    expect(createDefaultContainerManager('linux', 'reference/mem')).not.toBeNull();
  });

  it('personas: the plugin persona resolves through PersonaRegistry (disk-absent paths)', () => {
    const pr = new PersonaRegistry({ bundledPersonasPath: '/nonexistent', userPersonasPaths: [] });
    expect(pr.parsePersona('reference/scout').body).toContain('Scout');
  });

  it('manifest + owner: plugin owns its entries; credential capability granted; builtin owned by builtin', () => {
    expect(registries.tools.owner('reference/greet')).toBe('reference');
    expect(registries.tools.owner('bash')).toBe('builtin');
    expect(pluginMayUseCapability('reference', 'credentials')).toBe(true);
  });
});
