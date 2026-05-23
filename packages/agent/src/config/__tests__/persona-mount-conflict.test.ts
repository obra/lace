// ABOUTME: Tests for the R6 mount-conflict validator (PRI-1796).
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
  agentPlacement: host
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
  agentPlacement: host
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /data
  mounts:
    data: /data`
    );
    const reg = makeRegistry();
    const parsed = reg.parsePersona('cattle');

    // Should not throw
    expect(() => assertNoMountConflict('cattle', parsed, reg)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Test 2: overlapping mount name (not host path, but registry name) throws
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict throws PersonaSharingViolationError when mount name conflicts', () => {
    writePersona(
      'brain',
      `runtime:
  type: container
  agentPlacement: host
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
  agentPlacement: host
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
      assertNoMountConflict('worker', parsed, reg);
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
  // Test 3: reserved mount names are excluded from conflict detection
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict ignores reserved mount names', () => {
    // The schema rejects some of these (e.g., 'scratch' on per_invocation, 'persona', 'lace-data',
    // 'credentials', 'lace' are rejected by resolvePersonaMountsAndEnv at materialization time).
    // The conflict validator itself must filter reserved names regardless of whether the schema
    // would also catch them. We test this by constructing ParsedPersona objects directly
    // rather than going through the registry parser (which enforces schema rules on mount names).
    //
    // The reserved names at the validator level are: persona, lace-data, credentials, lace, scratch.
    // We create a minimal parsed persona manually so we can use normally-invalid names for the test.
    const parsed = {
      config: {
        runtime: {
          type: 'container' as const,
          agentPlacement: 'host' as const,
          containerSharing: 'per_invocation' as const,
          image: 'img:latest',
          workingDirectory: '/work',
          mounts: {
            scratch: '/work',
            persona: '/personas',
            'lace-data': '/var/lace',
            credentials: '/creds',
            lace: '/lace',
          },
          env: {},
        },
      },
      body: 'Body.',
    };

    // Build a registry that has a persistent persona claiming the same reserved names.
    // We do this by creating a ParsedPersona-shaped object directly rather than a file,
    // since the schema rejects these names as mount names. Instead, we construct a
    // minimal fake registry.
    const fakeRegistry = {
      listAvailablePersonas: () => [
        { name: 'persistent-pet', isUserDefined: false, path: '/fake/persistent-pet.md' },
      ],
      parsePersona: (_name: string) => ({
        config: {
          runtime: {
            type: 'container' as const,
            agentPlacement: 'host' as const,
            containerSharing: 'persistent' as const,
            image: 'img:latest',
            workingDirectory: '/home',
            mounts: {
              scratch: '/home/scratch',
              persona: '/personas',
              'lace-data': '/var/lace',
              credentials: '/creds',
              lace: '/lace',
            },
            env: {},
          },
        },
        body: 'Body.',
      }),
    };

    // Should not throw — all declared mounts are reserved names
    expect(() =>
      assertNoMountConflict(
        'worker',
        parsed,
        fakeRegistry as Parameters<typeof assertNoMountConflict>[2]
      )
    ).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Test 4: assertNoMountConflict is a no-op for persistent personas
  // ---------------------------------------------------------------------------
  it('assertNoMountConflict is a no-op for persistent personas (even if they overlap)', () => {
    writePersona(
      'pet-a',
      `runtime:
  type: container
  agentPlacement: host
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
  agentPlacement: host
  containerSharing: persistent
  image: img:latest
  workingDirectory: /home
  mounts:
    home: /home`
    );
    const reg = makeRegistry();
    const parsed = reg.parsePersona('pet-b');

    // persistent-on-persistent overlap is fine — no throw
    expect(() => assertNoMountConflict('pet-b', parsed, reg)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Test 5: warnMountConflicts logs a warn for each violation; does not throw
  // ---------------------------------------------------------------------------
  it('warnMountConflicts logs a warn for each violation without throwing', async () => {
    writePersona(
      'brain',
      `runtime:
  type: container
  agentPlacement: host
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
  agentPlacement: host
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /shared
  mounts:
    knowledge: /shared`
    );
    const reg = makeRegistry();
    const { logger } = await import('@lace/agent/utils/logger');

    // Should not throw
    expect(() => warnMountConflicts(reg)).not.toThrow();

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
  agentPlacement: host
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
  agentPlacement: host
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /data
  mounts:
    data: /data`
    );
    const reg = makeRegistry();
    const { logger } = await import('@lace/agent/utils/logger');

    warnMountConflicts(reg);

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
  agentPlacement: host
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
  agentPlacement: host
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /data
  mounts:
    data: /data`
    );
    const reg = makeRegistry();
    const { logger } = await import('@lace/agent/utils/logger');

    // Should not throw even though 'broken' fails to parse
    expect(() => warnMountConflicts(reg)).not.toThrow();

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
  agentPlacement: host
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
  agentPlacement: host
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
  agentPlacement: host
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
      assertNoMountConflict('cattle-c', parsed, reg);
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
});
