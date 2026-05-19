// ABOUTME: Reproduces the kata #55 secondary bug — when a user-persona path
// doesn't exist at first scan, the 5-second TTL cache locks in an empty
// userPersonasCache for 5 seconds even after the directory appears.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonaRegistry } from '../persona-registry';

describe('PersonaRegistry user-persona scan with missing path at construction', () => {
  let tempDir: string;
  let bundledPath: string;
  let userPersonasDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-persona-race-'));
    bundledPath = join(tempDir, 'bundled');
    userPersonasDir = join(tempDir, 'user-personas');
    mkdirSync(bundledPath, { recursive: true });
    // Deliberately do NOT create userPersonasDir yet.
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('picks up user personas that appear after the first scan', () => {
    const registry = new PersonaRegistry({
      bundledPersonasPath: bundledPath,
      userPersonasPaths: [userPersonasDir],
    });

    // First call: path does not exist yet. Scan finds nothing.
    expect(registry.listAvailablePersonas()).toEqual([]);

    // Create the dir and a persona AFTER the first scan. This mimics a
    // Docker mount or symlink target appearing slightly after the agent
    // process initializes its registry.
    mkdirSync(userPersonasDir, { recursive: true });
    writeFileSync(join(userPersonasDir, 'test-shell.md'), 'You are a shell tester.');

    // With a 5-second TTL cache that always sets expiry (even on a
    // missed scan), this returns [] for the next 5 seconds — masking
    // the user persona. The fix is to skip the cache when every
    // configured path was missing.
    const personas = registry.listAvailablePersonas();
    expect(personas.map((p) => p.name)).toContain('test-shell');
  });

  it('handles userPersonasPaths: [] without scanning or erroring', () => {
    // The empty-paths branch in loadUserPersonas: the loop never iterates,
    // anyPathScanned stays false, but length === 0 means the cache expiry
    // is still set so subsequent calls are no-ops. Without that branch,
    // every list call would re-enter the no-op scan loop.
    const registry = new PersonaRegistry({
      bundledPersonasPath: bundledPath,
      userPersonasPaths: [],
    });

    // Multiple calls return a consistent empty result and do not throw.
    expect(registry.listAvailablePersonas()).toEqual([]);
    expect(registry.listAvailablePersonas()).toEqual([]);
    expect(registry.hasPersona('anything')).toBe(false);
    expect(registry.getPersonaPath('anything')).toBeNull();
  });

  it('still caches when the path exists but is empty', () => {
    // Empty-but-existing dir is a legit empty result — cache should hold.
    mkdirSync(userPersonasDir, { recursive: true });
    const registry = new PersonaRegistry({
      bundledPersonasPath: bundledPath,
      userPersonasPaths: [userPersonasDir],
    });

    expect(registry.listAvailablePersonas()).toEqual([]);

    // Adding files after the cache is populated still gets picked up
    // eventually (after TTL), but within TTL we treat the cache as
    // authoritative. The important invariant is: a SUCCESSFUL scan of an
    // empty dir IS cached (we don't re-scan needlessly).
    writeFileSync(join(userPersonasDir, 'late.md'), 'late persona');
    // Within TTL, cache remains empty.
    expect(registry.listAvailablePersonas()).toEqual([]);
  });
});
