// ABOUTME: Tests for the R6 mount-conflict validator.
// Tests that per_invocation personas cannot share mount-registry names
// with persistent personas, and that the boot-time warning function fires correctly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

// We import the logger module before loading the validator so we can spy on it.
// The validator imports logger from the same path; vi.mock will intercept it.
vi.mock('@lace/agent/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Dynamic imports after mock setup so the mock is in place.
let PersonaRegistry: typeof import('../persona-registry').PersonaRegistry;
let assertNoMountConflict: typeof import('../persona-mount-conflict').assertNoMountConflict;
let warnMountConflicts: typeof import('../persona-mount-conflict').warnMountConflicts;
let PersonaSharingViolationError: typeof import('../persona-mount-conflict').PersonaSharingViolationError;

describe('persona-mount-conflict validator', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();

    // Re-import after reset so mocks are fresh
    ({ PersonaRegistry } = await import('../persona-registry'));
    ({ assertNoMountConflict, warnMountConflicts, PersonaSharingViolationError } = await import(
      '../persona-mount-conflict'
    ));

    tempDir = fs.mkdtempSync(path.join(tmpdir(), 'persona-conflict-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Helper: write a persona file into the temp directory
  // ---------------------------------------------------------------------------
  function writePersona(name: string, frontmatter: string, body = 'Body.'): void {
    const content = frontmatter ? `---\n${frontmatter}\n---\n${body}` : body;
    fs.writeFileSync(path.join(tempDir, `${name}.md`), content);
  }

  function makeRegistry(): InstanceType<typeof PersonaRegistry> {
    return new PersonaRegistry({
      bundledPersonasPath: tempDir,
      userPersonasPaths: [],
    });
  }

  // ---------------------------------------------------------------------------
  // Test 1: non-overlapping per_invocation persona passes
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict allows non-overlapping per_invocation persona', () => {
    writePersona(
      'pets',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /home
  mounts:
    home: /home`
    );
    writePersona(
      'cattle',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /data
  mounts:
    data: /data`
    );
    const reg = makeRegistry();
    const parsed = reg.parsePersona('cattle');

    // Should not throw
    expect(() => assertNoMountConflict('cattle', parsed, reg, {})).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Test 2: overlapping mount name (not host path, but registry name) throws
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict throws PersonaSharingViolationError when mount name conflicts', () => {
    writePersona(
      'brain',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /knowledge
  mounts:
    knowledge: /knowledge`
    );
    writePersona(
      'worker',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /shared
  mounts:
    knowledge: /shared`
    );
    const reg = makeRegistry();
    const parsed = reg.parsePersona('worker');

    let caught: unknown;
    try {
      assertNoMountConflict('worker', parsed, reg, {
        knowledge: { hostPath: '/srv/knowledge', readonly: false },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PersonaSharingViolationError);
    const err = caught as InstanceType<typeof PersonaSharingViolationError>;
    expect(err.personaName).toBe('worker');
    expect(err.mountName).toBe('knowledge');
    expect(err.conflictsWith).toContain('brain');
  });

  // ---------------------------------------------------------------------------
  // Test 3: only the Lace-managed scratch mount name is excluded from conflict detection
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict ignores only the scratch mount name', () => {
    // The persona schema rejects scratch on per_invocation at materialization
    // time, but the conflict validator still filters it because Lace owns that
    // injected mount. Legacy auto-injected names are ordinary declared mounts now.
    const parsed = {
      config: {
        runtime: {
          type: 'container' as const,
          containerSharing: 'per_invocation' as const,
          image: 'img:latest',
          workingDirectory: '/work',
          mounts: {
            scratch: '/work',
          },
          env: {},
        },
      },
      body: 'Body.',
    };

    const fakeRegistry = {
      listAvailablePersonas: () => [
        { name: 'persistent-pet', isUserDefined: false, path: '/fake/persistent-pet.md' },
      ],
      parsePersona: (_name: string) => ({
        config: {
          runtime: {
            type: 'container' as const,
            containerSharing: 'persistent' as const,
            image: 'img:latest',
            workingDirectory: '/home',
            mounts: {
              scratch: '/home/scratch',
            },
            env: {},
          },
        },
        body: 'Body.',
      }),
    };

    expect(() =>
      assertNoMountConflict(
        'worker',
        parsed,
        fakeRegistry as Parameters<typeof assertNoMountConflict>[2],
        {}
      )
    ).not.toThrow();
  });

  it('assertNoMountConflict treats legacy auto-injected names as ordinary mounts', () => {
    writePersona(
      'persistent-personas',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /personas
  mounts:
    persona: /personas`
    );
    writePersona(
      'worker',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /work
  mounts:
    persona: /personas`
    );
    const reg = makeRegistry();
    const parsed = reg.parsePersona('worker');

    expect(() => assertNoMountConflict('worker', parsed, reg, {})).toThrow(
      PersonaSharingViolationError
    );
  });

  // ---------------------------------------------------------------------------
  // Test 4: assertNoMountConflict is a no-op for persistent personas
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict is a no-op for persistent personas (even if they overlap)', () => {
    writePersona(
      'pet-a',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /home
  mounts:
    home: /home`
    );
    writePersona(
      'pet-b',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /home
  mounts:
    home: /home`
    );
    const reg = makeRegistry();
    const parsed = reg.parsePersona('pet-b');

    // persistent-on-persistent overlap is fine — no throw
    expect(() => assertNoMountConflict('pet-b', parsed, reg, {})).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Test 5: warnMountConflicts logs a warn for each violation; does not throw
  // ---------------------------------------------------------------------------
  it('warnMountConflicts logs a warn for each violation without throwing', async () => {
    writePersona(
      'brain',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /knowledge
  mounts:
    knowledge: /knowledge`
    );
    writePersona(
      'worker',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /shared
  mounts:
    knowledge: /shared`
    );
    const reg = makeRegistry();
    const { logger } = await import('@lace/agent/utils/logger');

    // Should not throw
    expect(() =>
      warnMountConflicts(reg, { knowledge: { hostPath: '/srv/knowledge', readonly: false } })
    ).not.toThrow();

    // Should have logged a warn with the conflict details
    expect(logger.warn).toHaveBeenCalledWith(
      'persona_mount_conflict',
      expect.objectContaining({
        persona: 'worker',
        mountName: 'knowledge',
        conflictsWith: expect.arrayContaining(['brain']),
      })
    );
  });

  // ---------------------------------------------------------------------------
  // Test 6: warnMountConflicts emits no warnings when no conflicts
  // ---------------------------------------------------------------------------
  it('warnMountConflicts emits zero persona_mount_conflict warnings when no conflicts exist', async () => {
    writePersona(
      'brain',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /home
  mounts:
    home: /home`
    );
    writePersona(
      'worker',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /data
  mounts:
    data: /data`
    );
    const reg = makeRegistry();
    const { logger } = await import('@lace/agent/utils/logger');

    warnMountConflicts(reg, {});

    // Check that warn was not called with the conflict key
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const conflictWarns = warnCalls.filter((args) => args[0] === 'persona_mount_conflict');
    expect(conflictWarns).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test 7: warnMountConflicts handles a parse error gracefully
  // ---------------------------------------------------------------------------
  it('warnMountConflicts skips invalid personas and continues', async () => {
    // Write an invalid persona (bad YAML that the schema will reject)
    fs.writeFileSync(
      path.join(tempDir, 'broken.md'),
      `---\nruntime:\n  type: container\n  containerSharing: BOGUS_VALUE\n  image: img:latest\n  workingDirectory: /w\n  mounts: {}\n---\nBody.`
    );
    writePersona(
      'brain',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /home
  mounts:
    home: /home`
    );
    writePersona(
      'worker',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /data
  mounts:
    data: /data`
    );
    const reg = makeRegistry();
    const { logger } = await import('@lace/agent/utils/logger');

    // Should not throw even though 'broken' fails to parse
    expect(() => warnMountConflicts(reg, {})).not.toThrow();

    // The debug skip log should have been emitted for the broken persona
    const debugCalls = (logger.debug as ReturnType<typeof vi.fn>).mock.calls;
    const skipLogs = debugCalls.filter(
      (args) => args[0] === 'persona_mount_conflict.parse_skipped'
    );
    expect(skipLogs.length).toBeGreaterThan(0);

    // The valid non-conflicting personas should not have produced a warn
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const conflictWarns = warnCalls.filter((args) => args[0] === 'persona_mount_conflict');
    expect(conflictWarns).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test 8: Multiple persistent personas conflicting on the same mount name
  //         produce a single message listing all of them
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict lists all conflicting persistent personas', () => {
    writePersona(
      'pet-a',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /logs
  mounts:
    logs: /logs`
    );
    writePersona(
      'pet-b',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /logs2
  mounts:
    logs: /logs2`
    );
    writePersona(
      'cattle-c',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /cattle-logs
  mounts:
    logs: /cattle-logs`
    );
    const reg = makeRegistry();
    const parsed = reg.parsePersona('cattle-c');

    let caught: unknown;
    try {
      assertNoMountConflict('cattle-c', parsed, reg, {
        logs: { hostPath: '/srv/logs', readonly: false },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PersonaSharingViolationError);
    const err = caught as InstanceType<typeof PersonaSharingViolationError>;
    expect(err.personaName).toBe('cattle-c');
    expect(err.mountName).toBe('logs');
    expect(err.conflictsWith).toHaveLength(2);
    expect(err.conflictsWith).toContain('pet-a');
    expect(err.conflictsWith).toContain('pet-b');
  });

  // ---------------------------------------------------------------------------
  // Test 9: readonly mount in registry — assertNoMountConflict must NOT throw
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict allows overlapping readonly mount when registry says so', () => {
    writePersona(
      'box-shell',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /knowledge
  mounts:
    knowledge: /knowledge`
    );
    writePersona(
      'shell',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /shared
  mounts:
    knowledge: /shared`
    );
    const reg = makeRegistry();
    const parsed = reg.parsePersona('shell');

    // Registry says 'knowledge' is readonly — no threat, should not throw.
    expect(() =>
      assertNoMountConflict('shell', parsed, reg, {
        knowledge: { hostPath: '/srv/knowledge', readonly: true },
      })
    ).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Test 10: read-write mount in registry — assertNoMountConflict must throw
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict still throws on overlapping read-write mount', () => {
    writePersona(
      'box-shell',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /knowledge
  mounts:
    knowledge: /knowledge`
    );
    writePersona(
      'shell',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /shared
  mounts:
    knowledge: /shared`
    );
    const reg = makeRegistry();
    const parsed = reg.parsePersona('shell');

    let caught: unknown;
    try {
      assertNoMountConflict('shell', parsed, reg, {
        knowledge: { hostPath: '/srv/knowledge', readonly: false },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PersonaSharingViolationError);
    const err = caught as InstanceType<typeof PersonaSharingViolationError>;
    expect(err.mountName).toBe('knowledge');
  });

  // ---------------------------------------------------------------------------
  // Test 11: mount not in registry — conservative default (treat as read-write)
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict treats missing-from-registry mounts as read-write (conservative default)', () => {
    writePersona(
      'box-shell',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /knowledge
  mounts:
    knowledge: /knowledge`
    );
    writePersona(
      'shell',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /shared
  mounts:
    knowledge: /shared`
    );
    const reg = makeRegistry();
    const parsed = reg.parsePersona('shell');

    // Pass an empty registry — 'knowledge' is not listed, so treat as read-write → throw.
    let caught: unknown;
    try {
      assertNoMountConflict('shell', parsed, reg, {});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PersonaSharingViolationError);
    const err = caught as InstanceType<typeof PersonaSharingViolationError>;
    expect(err.mountName).toBe('knowledge');
  });

  // ---------------------------------------------------------------------------
  // Test 12: warnMountConflicts skips readonly mounts — no WARN emitted
  // ---------------------------------------------------------------------------
  it('warnMountConflicts skips readonly mounts (no WARN)', async () => {
    writePersona(
      'box-shell',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /knowledge
  mounts:
    knowledge: /knowledge`
    );
    writePersona(
      'shell',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /shared
  mounts:
    knowledge: /shared`
    );
    const reg = makeRegistry();
    const { logger } = await import('@lace/agent/utils/logger');

    // Registry marks 'knowledge' readonly — not a threat, no WARN expected.
    expect(() =>
      warnMountConflicts(reg, { knowledge: { hostPath: '/srv/knowledge', readonly: true } })
    ).not.toThrow();

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const conflictWarns = warnCalls.filter((args) => args[0] === 'persona_mount_conflict');
    expect(conflictWarns).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test 13: warnMountConflicts still warns on read-write overlap
  // ---------------------------------------------------------------------------
  it('warnMountConflicts still warns on read-write overlap', async () => {
    writePersona(
      'box-shell',
      `runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /knowledge
  mounts:
    knowledge: /knowledge`
    );
    writePersona(
      'shell',
      `runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /shared
  mounts:
    knowledge: /shared`
    );
    const reg = makeRegistry();
    const { logger } = await import('@lace/agent/utils/logger');

    // Registry marks 'knowledge' read-write — genuine threat → WARN expected.
    warnMountConflicts(reg, { knowledge: { hostPath: '/srv/knowledge', readonly: false } });

    expect(logger.warn).toHaveBeenCalledWith(
      'persona_mount_conflict',
      expect.objectContaining({
        persona: 'shell',
        mountName: 'knowledge',
        conflictsWith: expect.arrayContaining(['box-shell']),
      })
    );
  });
});
