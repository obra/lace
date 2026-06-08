// ABOUTME: Tests for the R6 mount-conflict validator, re-homed onto environments.
// Tests that per_invocation environments cannot share a writable mount-registry
// name with persistent environments, and that the boot-time assert fires.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { EnvironmentRegistry } from '../environment-registry';
import {
  findEnvironmentMountConflicts,
  assertNoEnvironmentMountConflict,
  EnvironmentMountConflictError,
} from '../persona-mount-conflict';

describe('environment-mount-conflict validator', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), 'env-conflict-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeEnv(name: string, body: string): void {
    fs.writeFileSync(path.join(dir, `${name}.md`), body);
  }

  function persistentEnv(mounts: string[]): string {
    return `---
runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /home
  mounts:
${mounts.map((m) => `    - ${m}`).join('\n')}
---
Body.`;
  }

  function ephemeralEnv(mounts: string[]): string {
    return `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /work
  mounts:
${mounts.map((m) => `    - ${m}`).join('\n')}
---
Body.`;
  }

  it('flags a per_invocation environment sharing a writable mount with a persistent environment', () => {
    writeEnv('persistent-box', persistentEnv(['home']));
    writeEnv('leaky-ephemeral', ephemeralEnv(['home']));
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    const conflicts = findEnvironmentMountConflicts(reg, {
      home: { hostPath: '/h/home', containerPath: '/home/sen', readonly: false },
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].environment).toBe('leaky-ephemeral');
    expect(conflicts[0].mountName).toBe('home');
    expect(conflicts[0].conflictsWith).toEqual(['persistent-box']);
  });

  it('does not flag a readonly shared mount (no write path)', () => {
    writeEnv('persistent-box', persistentEnv(['knowledge']));
    writeEnv('eph', ephemeralEnv(['knowledge']));
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    const conflicts = findEnvironmentMountConflicts(reg, {
      knowledge: { hostPath: '/h/k', containerPath: '/knowledge', readonly: true },
    });
    expect(conflicts).toHaveLength(0);
  });

  it('treats a mount missing from the registry as read-write (conservative default)', () => {
    writeEnv('persistent-box', persistentEnv(['knowledge']));
    writeEnv('eph', ephemeralEnv(['knowledge']));
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    const conflicts = findEnvironmentMountConflicts(reg, {});
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].mountName).toBe('knowledge');
  });

  it('does not flag non-overlapping environments', () => {
    writeEnv('persistent-box', persistentEnv(['home']));
    writeEnv('eph', ephemeralEnv(['data']));
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(findEnvironmentMountConflicts(reg, {})).toHaveLength(0);
  });

  it('ignores the reserved mount name (scratch)', () => {
    writeEnv('persistent-box', persistentEnv(['scratch']));
    writeEnv('eph', ephemeralEnv(['scratch']));
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(findEnvironmentMountConflicts(reg, {})).toHaveLength(0);
  });

  it('does not flag persistent-on-persistent overlap', () => {
    writeEnv('pet-a', persistentEnv(['home']));
    writeEnv('pet-b', persistentEnv(['home']));
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(findEnvironmentMountConflicts(reg, {})).toHaveLength(0);
  });

  it('lists all conflicting persistent environments for a single mount', () => {
    writeEnv('pet-a', persistentEnv(['logs']));
    writeEnv('pet-b', persistentEnv(['logs']));
    writeEnv('cattle', ephemeralEnv(['logs']));
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    const conflicts = findEnvironmentMountConflicts(reg, {
      logs: { hostPath: '/srv/logs', containerPath: '/logs', readonly: false },
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictsWith).toEqual(['pet-a', 'pet-b']);
  });

  it('skips environments that fail to parse and still scans the rest', () => {
    writeEnv('persistent-box', persistentEnv(['home']));
    writeEnv('leaky-ephemeral', ephemeralEnv(['home']));
    writeEnv('broken', `---\nruntime:\n  type: container\n  containerSharing: BOGUS\n---\nBody.`);
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    const conflicts = findEnvironmentMountConflicts(reg, {
      home: { hostPath: '/h/home', containerPath: '/home/sen', readonly: false },
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].environment).toBe('leaky-ephemeral');
  });

  it('assertNoEnvironmentMountConflict throws on the first conflict', () => {
    writeEnv('persistent-box', persistentEnv(['home']));
    writeEnv('leaky-ephemeral', ephemeralEnv(['home']));
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    let caught: unknown;
    try {
      assertNoEnvironmentMountConflict(reg, {
        home: { hostPath: '/h/home', containerPath: '/home/sen', readonly: false },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvironmentMountConflictError);
    const err = caught as EnvironmentMountConflictError;
    expect(err.environmentName).toBe('leaky-ephemeral');
    expect(err.mountName).toBe('home');
    expect(err.conflictsWith).toEqual(['persistent-box']);
  });

  it('assertNoEnvironmentMountConflict is a no-op when there are no conflicts', () => {
    writeEnv('persistent-box', persistentEnv(['home']));
    writeEnv('eph', ephemeralEnv(['data']));
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(() => assertNoEnvironmentMountConflict(reg, {})).not.toThrow();
  });
});
