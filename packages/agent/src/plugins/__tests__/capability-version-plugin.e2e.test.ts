// ABOUTME: E2E test for the capability-version-plugin example.
// ABOUTME: Exercises the capability manifest + version contract through the REAL
// ABOUTME: loader + registries — no mocks. Mirrors whole-system.integration.test.ts.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPlugins,
  registries,
  resetRegistriesForTest,
  pluginMayUseCapability,
  createPluginApi,
  makeRegistries,
  PluginVersionError,
} from '@lace/agent/plugins';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';

// The loader resolves specifiers relative to src/plugins/loader.ts.
// __examples__ is a sibling of __tests__, both under src/plugins/ — same
// resolution pattern used by whole-system.integration.test.ts for reference-plugin.
const PLUGIN_SPEC = './__examples__/capability-version-plugin';

describe('capability-version-plugin — capability manifest + version contract', () => {
  beforeEach(async () => {
    // resetRegistriesForTest() clears all four registries AND the manifests map.
    // Must call BEFORE loading to avoid dup-fatal across test cases.
    resetRegistriesForTest();
    // Built-ins register before plugins (dup→fatal is symmetric).
    registerBuiltinTools();
    await loadPlugins(PLUGIN_SPEC);
  });

  // ── Capability manifest ───────────────────────────────────────────────────

  it('pluginMayUseCapability: declared capability returns true for this plugin', () => {
    expect(pluginMayUseCapability('capability-demo', 'credentials')).toBe(true);
  });

  it('pluginMayUseCapability: undeclared owner returns false (default-deny)', () => {
    // A plugin name that never loaded and never called recordManifest.
    expect(pluginMayUseCapability('no-such-plugin', 'credentials')).toBe(false);
  });

  it('pluginMayUseCapability: builtin owner always returns true (trusted kernel code)', () => {
    // The 'builtin' owner is permanently trusted regardless of any manifest.
    expect(pluginMayUseCapability('builtin', 'credentials')).toBe(true);
  });

  // ── Tool ownership ────────────────────────────────────────────────────────

  it('registries.tools.owner: the tool is owned by this plugin', () => {
    expect(registries.tools.owner('capability-demo/credential-ping')).toBe('capability-demo');
  });

  // ── Version skew ──────────────────────────────────────────────────────────
  // DOC-GAP-NOTE: The docs list createPluginApi in the public exports table
  // but do not explain how to use it directly in a test to exercise
  // assertVersion without writing a whole separate fixture file. Reading api.ts
  // was necessary to understand the call signature.

  it('assertVersion(2) throws PluginVersionError (kernel is major 1)', () => {
    // createPluginApi is exported for tests/kernel use. We construct a fresh
    // api instance against a scratch registry so we don't pollute global state.
    const scratchRegistries = makeRegistries();
    const api = createPluginApi(
      { name: 'skew-probe', namespace: 'skew-probe', version: '0.0.0' },
      scratchRegistries
    );

    expect(() => api.assertVersion(2)).toThrow(PluginVersionError);
    expect(() => api.assertVersion(2)).toThrow(/major 2/);
  });

  it('assertVersion(1) does not throw (current kernel major)', () => {
    const scratchRegistries = makeRegistries();
    const api = createPluginApi(
      { name: 'version-ok-probe', namespace: 'version-ok-probe', version: '0.0.0' },
      scratchRegistries
    );

    expect(() => api.assertVersion(1)).not.toThrow();
  });
});
