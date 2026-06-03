// ABOUTME: Tests the owner-keyed capability manifest (default-deny)
import { describe, it, expect, beforeEach } from 'vitest';
import { recordManifest, pluginMayUseCapability, resetManifestsForTest } from './manifest';

describe('capability manifest', () => {
  beforeEach(() => resetManifestsForTest());
  it('grants a declared capability', () => {
    recordManifest('vendor/creds', { capabilities: ['credentials'] });
    expect(pluginMayUseCapability('vendor/creds', 'credentials')).toBe(true);
  });
  it('default-denies an undeclared capability', () => {
    recordManifest('vendor/grep', { capabilities: [] });
    expect(pluginMayUseCapability('vendor/grep', 'credentials')).toBe(false);
  });
  it('default-denies an unknown plugin', () => {
    expect(pluginMayUseCapability('never-registered', 'credentials')).toBe(false);
  });
  it("grants 'builtin' all capabilities", () => {
    expect(pluginMayUseCapability('builtin', 'credentials')).toBe(true);
  });
});
