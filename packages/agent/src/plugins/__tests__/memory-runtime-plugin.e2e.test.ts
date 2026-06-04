// ABOUTME: E2E test for memory-runtime-plugin — loads the plugin through the real loader
// ABOUTME: and asserts it is visible at the real consumption site (createDefaultContainerManager).
// ABOUTME: No mocks. Mirrors the whole-system.integration.test.ts template.

import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins, registries, resetRegistriesForTest } from '@lace/agent/plugins';
import {
  registerBuiltinRuntimes,
  createDefaultContainerManager,
} from '@lace/agent/containers/manager-factory';

// The specifier resolves relative to src/plugins/loader.ts (the importer).
// __examples__ is a sibling directory of __tests__, so this path is correct.
const PLUGIN_SPECIFIER = './__examples__/memory-runtime-plugin';

describe('memory-runtime-plugin e2e', () => {
  beforeEach(async () => {
    resetRegistriesForTest();
    // Built-ins must be registered before the plugin so name-clashes are caught.
    registerBuiltinRuntimes();
    await loadPlugins(PLUGIN_SPECIFIER);
  });

  it('the runtime is registered and owned by the plugin', () => {
    expect(registries.runtimes.has('mem/memory')).toBe(true);
    expect(registries.runtimes.owner('mem/memory')).toBe('memory-runtime');
  });

  it('createDefaultContainerManager resolves the plugin runtime by name', () => {
    // Pass 'linux' as the platform so the factory does not use auto-selection
    // (which would pick 'docker'). The second arg overrides the runtime name,
    // bypassing the platform→built-in mapping and selecting our plugin runtime.
    const manager = createDefaultContainerManager('linux', 'mem/memory');
    expect(manager).not.toBeNull();
  });
});
