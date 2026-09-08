// ABOUTME: Unit tests for platform/env based ContainerManager construction

import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { containerOwnerId, createDefaultContainerManager } from './manager-factory';
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

function getOwnerId(manager: ContainerManager | null): string | null | undefined {
  return manager === null ? null : (manager as unknown as { ownerId: string | null }).ownerId;
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
});

describe('containerOwnerId', () => {
  const originalLaceDir = process.env.LACE_DIR;
  const originalRuntimeOverride = process.env[ENV_KEY];

  afterEach(() => {
    if (originalLaceDir === undefined) {
      delete process.env.LACE_DIR;
    } else {
      process.env.LACE_DIR = originalLaceDir;
    }
    if (originalRuntimeOverride === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalRuntimeOverride;
    }
  });

  it('is the agent LACE_DIR, so it survives a restart of the same agent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-owner-'));
    process.env.LACE_DIR = dir;

    // Two calls model two boots of one agent: same directory, same identity.
    expect(containerOwnerId()).toBe(containerOwnerId());
    expect(containerOwnerId()).toBe(path.resolve(dir));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('differs between two agents on one host', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-owner-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-owner-b-'));

    process.env.LACE_DIR = a;
    const ownerA = containerOwnerId();
    process.env.LACE_DIR = b;
    const ownerB = containerOwnerId();

    expect(ownerA).not.toBe(ownerB);

    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  });

  it('still yields an id when LACE_DIR does not exist yet', () => {
    const missing = path.join(os.tmpdir(), 'lace-owner-missing-does-not-exist');
    process.env.LACE_DIR = missing;

    expect(containerOwnerId()).toBe(path.resolve(missing));
  });

  it('is null when LACE_DIR is unset', () => {
    // The default ~/.lace is shared by every agent this OS user runs, so it
    // cannot tell two of them apart. No id at all is the honest answer; the
    // manager then stamps no owner and reaps nothing.
    delete process.env.LACE_DIR;

    expect(containerOwnerId()).toBeNull();
  });

  it('treats an empty LACE_DIR as unset', () => {
    process.env.LACE_DIR = '   ';

    expect(containerOwnerId()).toBeNull();
  });

  it('survives a deploy retargeting the LACE_DIR symlink', () => {
    // The `current -> releases/N` deploy shape. Resolving the symlink would
    // change this agent's identity on every release, permanently stranding the
    // containers it created before the swap: unownable, so unreapable by anyone.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-owner-deploy-'));
    const current = path.join(base, 'current');
    fs.mkdirSync(path.join(base, 'releases', '1'), { recursive: true });
    fs.mkdirSync(path.join(base, 'releases', '2'), { recursive: true });
    fs.symlinkSync(path.join(base, 'releases', '1'), current);
    process.env.LACE_DIR = current;

    const beforeDeploy = containerOwnerId();
    fs.unlinkSync(current);
    fs.symlinkSync(path.join(base, 'releases', '2'), current);

    expect(containerOwnerId()).toBe(beforeDeploy);

    fs.rmSync(base, { recursive: true, force: true });
  });

  it('is the owner id the constructed manager stamps and reaps by', () => {
    // Wiring: the factory must hand the derived identity to the manager, not a
    // constant of its own.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-owner-wiring-'));
    process.env.LACE_DIR = dir;
    process.env[ENV_KEY] = 'docker';

    const manager = createDefaultContainerManager('linux');

    expect(getOwnerId(manager)).toBe(containerOwnerId());
    expect(getOwnerId(manager)).toBe(path.resolve(dir));

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
