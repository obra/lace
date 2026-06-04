// ABOUTME: E1 registry tests — built-in runtimes registered; resolve by name
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerBuiltinRuntimes,
  createDefaultContainerManager,
} from '@lace/agent/containers/manager-factory';
import { DockerContainerRuntime } from '@lace/agent/containers/docker-container';
import { PlaneRuntime } from '@lace/agent/containers/plane-runtime';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';
import type { ContainerRuntime } from '@lace/agent/containers/types';

describe('runtime registry', () => {
  const originalDockerBin = process.env.LACE_DOCKER_BIN;

  beforeEach(() => {
    delete process.env.LACE_DOCKER_BIN;
    resetRegistriesForTest();
    registerBuiltinRuntimes();
  });

  afterEach(() => {
    if (originalDockerBin === undefined) {
      delete process.env.LACE_DOCKER_BIN;
    } else {
      process.env.LACE_DOCKER_BIN = originalDockerBin;
    }
  });

  it('registers docker + apple built-ins (owner builtin)', () => {
    expect(registries.runtimes.has('docker')).toBe(true);
    expect(registries.runtimes.owner('docker')).toBe('builtin');
    expect(registries.runtimes.has('apple')).toBe(true);
    expect(registries.runtimes.owner('apple')).toBe('builtin');
  });

  it('keeps docker registered as the direct Docker runtime when LACE_DOCKER_BIN is set', () => {
    process.env.LACE_DOCKER_BIN = '/bin/sen-docker-client';
    resetRegistriesForTest();

    registerBuiltinRuntimes();

    expect(registries.runtimes.resolve('docker')).toBeInstanceOf(DockerContainerRuntime);
  });

  it('registers plane when LACE_DOCKER_BIN is set', () => {
    process.env.LACE_DOCKER_BIN = '/bin/sen-docker-client';
    resetRegistriesForTest();

    registerBuiltinRuntimes();

    expect(registries.runtimes.resolve('plane')).toBeInstanceOf(PlaneRuntime);
    expect(registries.runtimes.owner('plane')).toBe('builtin');
  });

  it('selects the built-in plane runtime by name', () => {
    process.env.LACE_DOCKER_BIN = '/bin/sen-docker-client';
    resetRegistriesForTest();
    registerBuiltinRuntimes();

    expect(createDefaultContainerManager('linux', 'plane')).not.toBeNull();
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
