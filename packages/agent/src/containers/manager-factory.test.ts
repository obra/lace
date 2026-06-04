// ABOUTME: Unit tests for platform/env based ContainerManager construction

import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultContainerManager } from './manager-factory';
import type { ContainerManager } from './container-manager';
import type { ContainerRuntime } from './types';

const ENV_KEY = 'LACE_CONTAINER_RUNTIME';
// Constructing AppleContainerRuntime on Linux kicks off an async `container
// system start` that rejects (no Apple runtime) → unhandled rejection. Guard the
// Apple-constructing case to darwin; the docker/linux selection paths still run.
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

  it('fails clearly for an unregistered LACE_CONTAINER_RUNTIME value', () => {
    // Previously: parseContainerRuntimeSelection hard-rejected names outside {auto,apple,docker}.
    // Now: any name is accepted and resolved against the plugin registry; an unknown name throws
    // with a registry-miss message so embedders get a clear error.
    process.env[ENV_KEY] = 'podman';

    expect(() => createDefaultContainerManager('darwin')).toThrow(
      /LACE_CONTAINER_RUNTIME="podman" but no runtime registered under that name/
    );
  });

  // PRI-2012 B8: when SEN_SPAWN_BROKER_SOCKET is set, main-sen has no docker.sock
  // and MUST drive the broker — this takes precedence over platform + selection.
  describe('spawn-broker selection (SEN_SPAWN_BROKER_SOCKET)', () => {
    it('selects the spawn-broker runtime when the broker socket is set', () => {
      delete process.env[ENV_KEY];
      const manager = createDefaultContainerManager('linux', undefined, '/run/sen/broker.sock');
      expect(getRuntime(manager)?.constructor.name).toBe('SpawnBrokerContainerRuntime');
    });

    it('takes precedence over platform and LACE_CONTAINER_RUNTIME', () => {
      const manager = createDefaultContainerManager('darwin', 'docker', '/run/sen/broker.sock');
      expect(getRuntime(manager)?.constructor.name).toBe('SpawnBrokerContainerRuntime');
    });

    it('ignores an empty broker socket (falls back to the platform default)', () => {
      delete process.env[ENV_KEY];
      const manager = createDefaultContainerManager('linux', undefined, '');
      expect(getRuntime(manager)?.constructor.name).toBe('DockerContainerRuntime');
    });
  });
});
