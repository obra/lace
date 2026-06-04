// ABOUTME: Tests the LACE_PLUGINS loader against fixture modules
import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins, parsePluginSpec, PluginLoadError } from './loader';
import { makeRegistries } from './api';
import { pluginMayUseCapability, resetManifestsForTest } from './manifest';
import { personaDirs, resetContributedDirsForTest } from './contributed-dirs';

const FIX = './__fixtures__';

describe('parsePluginSpec', () => {
  it('returns [] for empty/undefined', () => {
    expect(parsePluginSpec(undefined)).toEqual([]);
    expect(parsePluginSpec('  ')).toEqual([]);
  });
  it('splits + trims, preserving order', () => {
    expect(parsePluginSpec(' a , b ,c ')).toEqual(['a', 'b', 'c']);
  });
});

describe('loadPlugins', () => {
  beforeEach(() => resetContributedDirsForTest());

  it('no-ops on empty spec', async () => {
    const r = makeRegistries();
    expect((await loadPlugins(undefined, { registries: r })).loaded).toEqual([]);
  });
  it('loads a good plugin, registers its tool with the declared meta as owner, and contributes a persona dir', async () => {
    const r = makeRegistries();
    await loadPlugins(`${FIX}/good-plugin`, { registries: r });
    expect(r.tools.has('good:fixture-tool')).toBe(true);
    expect(r.tools.owner('good:fixture-tool')).toBe('good');
    expect(personaDirs().some((d) => d.namespace === 'good')).toBe(true);
  });
  it('records the manifest so capability checks work', async () => {
    resetManifestsForTest();
    const r = makeRegistries();
    await loadPlugins(`${FIX}/creds-plugin`, { registries: r });
    expect(pluginMayUseCapability('creds', 'credentials')).toBe(true);
    expect(pluginMayUseCapability('good', 'credentials')).toBe(false);
  });
  it('records per-plugin timing', async () => {
    const r = makeRegistries();
    const res = await loadPlugins(`${FIX}/good-plugin`, { registries: r });
    expect(res.loaded[0].name).toBe('good');
    expect(typeof res.loaded[0].ms).toBe('number');
  });
  it('fatal: unimportable specifier', async () => {
    await expect(
      loadPlugins(`${FIX}/nope-missing`, { registries: makeRegistries() })
    ).rejects.toThrow(PluginLoadError);
  });
  it('fatal: no register() export', async () => {
    await expect(
      loadPlugins(`${FIX}/not-a-plugin`, { registries: makeRegistries() })
    ).rejects.toThrow(/register/i);
  });
  it('fatal: register() throws', async () => {
    await expect(
      loadPlugins(`${FIX}/throws-on-register-plugin`, { registries: makeRegistries() })
    ).rejects.toThrow(/boom/);
  });
  it('fatal: duplicate tool name across plugins', async () => {
    await expect(
      loadPlugins(`${FIX}/good-plugin,${FIX}/dup-persona-plugin`, {
        registries: makeRegistries(),
      })
    ).rejects.toThrow(/duplicate/i);
  });
  it('fatal: version skew', async () => {
    await expect(
      loadPlugins(`${FIX}/version-skew-plugin`, { registries: makeRegistries() })
    ).rejects.toThrow(/major/i);
  });
});
