// ABOUTME: Unit tests for the generic owner-tracking plugin Registry<T>
import { describe, it, expect } from 'vitest';
import { Registry, RegistryError } from './registry';

describe('Registry<T>', () => {
  it('registers and resolves by name, tracking owner', () => {
    const r = new Registry<string>('tools');
    r.register('grep', 'GREP', 'vendor-x');
    expect(r.resolve('grep')).toBe('GREP');
    expect(r.owner('grep')).toBe('vendor-x');
  });

  it('lists names in registration order and reports membership', () => {
    const r = new Registry<number>('compaction');
    r.register('a', 1, 'builtin');
    r.register('b', 2, 'builtin');
    expect(r.names()).toEqual(['a', 'b']);
    expect(r.has('a')).toBe(true);
    expect(r.has('missing')).toBe(false);
  });

  it('throws RegistryError on duplicate name (fatal-at-boot)', () => {
    const r = new Registry<string>('tools');
    r.register('bash', 'builtin-bash', 'builtin');
    expect(() => r.register('bash', 'plugin-bash', 'vendor-x')).toThrow(RegistryError);
    expect(() => r.register('bash', 'plugin-bash', 'vendor-x')).toThrow(/duplicate.*bash.*tools/i);
  });

  it('throws RegistryError when resolving or owning a missing name', () => {
    const r = new Registry<string>('personas');
    expect(() => r.resolve('ghost')).toThrow(/no.*personas.*ghost/i);
    expect(() => r.owner('ghost')).toThrow(RegistryError);
  });

  it('resolves lazily — values registered after construction are visible', () => {
    const r = new Registry<string>('runtimes');
    expect(() => r.resolve('docker')).toThrow(RegistryError);
    r.register('docker', 'DOCKER', 'builtin');
    expect(r.resolve('docker')).toBe('DOCKER');
  });

  it('clear() empties the registry (test-support)', () => {
    const r = new Registry<string>('tools');
    r.register('x', 'X', 'builtin');
    r.clear();
    expect(r.has('x')).toBe(false);
  });
});
