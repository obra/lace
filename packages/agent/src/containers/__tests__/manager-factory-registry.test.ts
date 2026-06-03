// ABOUTME: E1 registry tests — built-in runtimes registered; resolve by name
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerBuiltinRuntimes,
  createDefaultContainerManager,
} from '@lace/agent/containers/manager-factory';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';
import type { ContainerRuntime } from '@lace/agent/containers/types';

describe('runtime registry', () => {
  beforeEach(() => {
    resetRegistriesForTest();
    registerBuiltinRuntimes();
  });

  it('registers docker + apple built-ins (owner builtin)', () => {
    expect(registries.runtimes.has('docker')).toBe(true);
    expect(registries.runtimes.owner('docker')).toBe('builtin');
    expect(registries.runtimes.has('apple')).toBe(true);
    expect(registries.runtimes.owner('apple')).toBe('builtin');
  });

  it('auto selects the platform default', () => {
    expect(createDefaultContainerManager('linux', 'auto')).not.toBeNull();
    expect(createDefaultContainerManager('darwin', 'auto')).not.toBeNull();
  });

  it('resolves an embedder runtime by name', () => {
    registries.runtimes.register(
      'plane',
      { create: () => 'x' } as never as ContainerRuntime,
      'vendor'
    );
    expect(createDefaultContainerManager('linux', 'plane')).not.toBeNull();
  });

  it('throws when the selected name is not registered', () => {
    expect(() => createDefaultContainerManager('linux', 'ghost')).toThrow();
  });
});
