// ABOUTME: Unit tests for platform/env based ContainerManager construction

import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultContainerManager } from './manager-factory';
import type { ContainerManager } from './container-manager';
import type { ContainerRuntime } from './types';

const ENV_KEY = 'LACE_CONTAINER_RUNTIME';

// Constructing AppleContainerRuntime kicks off a floating `container system
// start` probe that rejects on non-macOS hosts (CLI absent) and surfaces as an
// unhandled rejection. The darwin-default branch can only be exercised on macOS.
const isDarwin = process.platform === 'darwin';

function getRuntime(manager: ContainerManager | null): ContainerRuntime | null {
  return manager === null ? null : (manager as unknown as { runtime: ContainerRuntime }).runtime;
}

describe('createDefaultContainerManager', () => {
  const originalRuntimeOverride = process.env[ENV_KEY];

  afterEach(() => {
    if (originalRuntimeOverride === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalRuntimeOverride;
    }
  });

  it.skipIf(!isDarwin)('selects Apple Container by default on macOS', () => {
    delete process.env[ENV_KEY];

    const manager = createDefaultContainerManager('darwin');

    expect(getRuntime(manager)?.constructor.name).toBe('AppleContainerRuntime');
  });

  it('selects Docker on macOS when LACE_CONTAINER_RUNTIME=docker', () => {
    process.env[ENV_KEY] = 'docker';

    const manager = createDefaultContainerManager('darwin');

    expect(getRuntime(manager)?.constructor.name).toBe('DockerContainerRuntime');
  });

  it('fails clearly for an invalid LACE_CONTAINER_RUNTIME value', () => {
    process.env[ENV_KEY] = 'podman';

    expect(() => createDefaultContainerManager('darwin')).toThrow(
      /LACE_CONTAINER_RUNTIME must be one of: auto, apple, docker/
    );
  });
});
