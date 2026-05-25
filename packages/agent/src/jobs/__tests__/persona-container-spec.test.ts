// ABOUTME: Unit tests for buildPersonaContainerSpec — name composition + mount resolution

import { describe, it, expect } from 'vitest';
import {
  buildPersonaContainerSpec,
  PersonaContainerSpecError,
  SUBAGENT_USER_PERSONAS_TARGET,
  SUBAGENT_LACE_DATA_TARGET,
  SUBAGENT_CREDENTIALS_TARGET,
  SUBAGENT_LACE_TARGET,
  SUBAGENT_SKILLS_TARGET,
} from '@lace/agent/jobs/persona-container-spec';

// per_invocation requires childSessionId + scratchDirHostPath
const baseRuntime = {
  type: 'container' as const,
  agentPlacement: 'host' as const,
  containerSharing: 'per_invocation' as const,
  image: 'devcontainer:latest',
  workingDirectory: '/workspace',
  mounts: {},
};

// Stable ids for existing tests migrated to the new per_invocation signature.
// parentSessionId 'sess_pppppppp00000000' → short 'pppppppp'
// childSessionId  'sess_cccccccc00000000' → short 'cccccccc'
const BASE_PARENT_SESSION_ID = 'sess_pppppppp00000000';
const BASE_CHILD_SESSION_ID = 'sess_cccccccc00000000';
const BASE_SCRATCH_PATH = '/tmp/test-scratch';

// The auto-injected scratch mount present on every per_invocation spec.
const SCRATCH_MOUNT = {
  source: BASE_SCRATCH_PATH,
  target: '/work',
  readonly: false,
};

describe('buildPersonaContainerSpec', () => {
  it('composes spec.name from parent8 + personaName + child8 for per_invocation', () => {
    // parentSessionId 'sess_aaaaaaaa11111111' → short 'aaaaaaaa'
    // childSessionId  'sess_bbbbbbbb22222222' → short 'bbbbbbbb'
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess_aaaaaaaa11111111',
      personaName: 'shell',
      childSessionId: 'sess_bbbbbbbb22222222',
      scratchDirHostPath: '/tmp/scratch',
      runtime: baseRuntime,
      containerMounts: {},
    });

    expect(spec.name).toBe('aaaaaaaa-shell-bbbbbbbb');
    expect(spec.image).toBe('devcontainer:latest');
    expect(spec.workingDirectory).toBe('/workspace');
  });

  it('resolves runtime.mounts against the registry into ContainerMount entries', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'browser',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: {
        ...baseRuntime,
        mounts: { identity: '/etc/identity' },
      },
      containerMounts: {
        identity: { hostPath: '/host/identity', readonly: true },
        unused: { hostPath: '/host/unused', readonly: false },
      },
    });

    expect(spec.mounts).toEqual(
      expect.arrayContaining([
        { source: '/host/identity', target: '/etc/identity', readonly: true },
        SCRATCH_MOUNT,
      ])
    );
    // identity + auto-injected scratch
    expect(spec.mounts).toHaveLength(2);
  });

  it('mounts inherited skillDirs read-only at stable in-container targets', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: baseRuntime,
      containerMounts: {},
      skillDirs: ['/host/skills/innate', '/host/skills/learned'],
    });

    expect(spec.mounts).toEqual(
      expect.arrayContaining([
        { source: '/host/skills/innate', target: `${SUBAGENT_SKILLS_TARGET}/0`, readonly: true },
        { source: '/host/skills/learned', target: `${SUBAGENT_SKILLS_TARGET}/1`, readonly: true },
        SCRATCH_MOUNT,
      ])
    );
    expect(spec.managedMountTargetPrefixes).toContain(`${SUBAGENT_SKILLS_TARGET}/`);
  });

  it('throws PersonaContainerSpecError on unknown mount name', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: BASE_PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: BASE_CHILD_SESSION_ID,
        scratchDirHostPath: BASE_SCRATCH_PATH,
        runtime: {
          ...baseRuntime,
          mounts: { phantom: '/phantom' },
        },
        containerMounts: {},
      })
    ).toThrow(PersonaContainerSpecError);
  });

  it('rejects persona-declared mount targets in the managed skill namespace', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: BASE_PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: BASE_CHILD_SESSION_ID,
        scratchDirHostPath: BASE_SCRATCH_PATH,
        runtime: {
          ...baseRuntime,
          mounts: { identity: SUBAGENT_SKILLS_TARGET },
        },
        containerMounts: {
          identity: { hostPath: '/host/identity', readonly: true },
        },
      })
    ).toThrow(/managed skill mount namespace/);

    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: BASE_PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: BASE_CHILD_SESSION_ID,
        scratchDirHostPath: BASE_SCRATCH_PATH,
        runtime: {
          ...baseRuntime,
          mounts: { identity: `${SUBAGENT_SKILLS_TARGET}/0` },
        },
        containerMounts: {
          identity: { hostPath: '/host/identity', readonly: true },
        },
      })
    ).toThrow(/managed skill mount namespace/);
  });

  it('rejects parentSessionId containing unsafe characters', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'evil; rm -rf /',
        personaName: 'shell',
        childSessionId: BASE_CHILD_SESSION_ID,
        scratchDirHostPath: BASE_SCRATCH_PATH,
        runtime: baseRuntime,
        containerMounts: {},
      })
    ).toThrow(/Invalid parentSessionId/);
  });

  it('rejects personaName containing unsafe characters', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: BASE_PARENT_SESSION_ID,
        personaName: '../etc/passwd',
        childSessionId: BASE_CHILD_SESSION_ID,
        scratchDirHostPath: BASE_SCRATCH_PATH,
        runtime: baseRuntime,
        containerMounts: {},
      })
    ).toThrow(/Invalid personaName/);
  });

  it('auto-injects the persona registry mount at the well-known target', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: baseRuntime,
      containerMounts: {
        persona: { hostPath: '/host/agent-personas', readonly: true },
      },
    });

    expect(spec.mounts).toContainEqual({
      source: '/host/agent-personas',
      target: SUBAGENT_USER_PERSONAS_TARGET,
      readonly: true,
    });
  });

  it('only auto-injects scratch when registry has no other entries', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: baseRuntime,
      containerMounts: {},
    });

    // Only the scratch mount is auto-injected; no other entries.
    expect(spec.mounts).toEqual([SCRATCH_MOUNT]);
  });

  it('rejects a persona file declaring runtime.mounts.persona — reserved name', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: BASE_PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: BASE_CHILD_SESSION_ID,
        scratchDirHostPath: BASE_SCRATCH_PATH,
        runtime: {
          ...baseRuntime,
          mounts: { persona: '/somewhere' },
        },
        containerMounts: {
          persona: { hostPath: '/host/agent-personas', readonly: true },
        },
      })
    ).toThrow(/reserved/);
  });

  it('auto-injects the lace-data registry mount and LACE_DIR env at the well-known target', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: baseRuntime,
      containerMounts: {
        'lace-data': { hostPath: '/host/history/lace', readonly: false },
      },
    });

    expect(spec.mounts).toContainEqual({
      source: '/host/history/lace',
      target: SUBAGENT_LACE_DATA_TARGET,
      readonly: false,
    });
    expect(spec.env).toEqual({ LACE_DIR: SUBAGENT_LACE_DATA_TARGET });
  });

  it('does not inject LACE_DIR env when the registry omits lace-data', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: baseRuntime,
      containerMounts: {},
    });

    expect(spec.env).toEqual({});
    expect(spec.env).not.toHaveProperty('LACE_DIR');
  });

  it('rejects a persona file declaring runtime.mounts["lace-data"] — reserved name', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: BASE_PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: BASE_CHILD_SESSION_ID,
        scratchDirHostPath: BASE_SCRATCH_PATH,
        runtime: {
          ...baseRuntime,
          mounts: { 'lace-data': '/somewhere' },
        },
        containerMounts: {
          'lace-data': { hostPath: '/host/history/lace', readonly: false },
        },
      })
    ).toThrow(/reserved/);
  });

  it('LACE_DIR auto-inject overrides a persona-supplied LACE_DIR in runtime.env', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: {
        ...baseRuntime,
        env: { LACE_DIR: '/wrong/path', OTHER: 'keep' },
      },
      containerMounts: {
        'lace-data': { hostPath: '/host/history/lace', readonly: false },
      },
    });

    expect(spec.env.LACE_DIR).toBe(SUBAGENT_LACE_DATA_TARGET);
    expect(spec.env.OTHER).toBe('keep');
  });

  it('auto-injects the credentials registry mount at the well-known target', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: baseRuntime,
      containerMounts: {
        credentials: { hostPath: '/host/credentials', readonly: true },
      },
    });

    expect(spec.mounts).toContainEqual({
      source: '/host/credentials',
      target: SUBAGENT_CREDENTIALS_TARGET,
      readonly: true,
    });
    // Auto-inject does not touch env — the symlink in lace-data resolves it.
    expect(spec.env).toEqual({});
  });

  it('rejects a persona file declaring runtime.mounts.credentials — reserved name', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: BASE_PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: BASE_CHILD_SESSION_ID,
        scratchDirHostPath: BASE_SCRATCH_PATH,
        runtime: {
          ...baseRuntime,
          mounts: { credentials: '/somewhere' },
        },
        containerMounts: {
          credentials: { hostPath: '/host/credentials', readonly: true },
        },
      })
    ).toThrow(/reserved/);
  });

  it('auto-injects the lace registry mount at the well-known target (PRI-1774)', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: baseRuntime,
      containerMounts: {
        lace: { hostPath: '/host/lace', readonly: true },
      },
    });

    expect(spec.mounts).toContainEqual({
      source: '/host/lace',
      target: SUBAGENT_LACE_TARGET,
      readonly: true,
    });
    expect(spec.env).toEqual({});
  });

  it('rejects a persona file declaring runtime.mounts.lace — reserved name (PRI-1774)', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: BASE_PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: BASE_CHILD_SESSION_ID,
        scratchDirHostPath: BASE_SCRATCH_PATH,
        runtime: {
          ...baseRuntime,
          mounts: { lace: '/somewhere' },
        },
        containerMounts: {
          lace: { hostPath: '/host/lace', readonly: true },
        },
      })
    ).toThrow(/reserved/);
  });

  it('auto-injects persona + lace-data + credentials together when registry has all three', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: baseRuntime,
      containerMounts: {
        persona: { hostPath: '/host/agent-personas', readonly: true },
        'lace-data': { hostPath: '/host/history/lace', readonly: false },
        credentials: { hostPath: '/host/credentials', readonly: true },
      },
    });

    expect(spec.mounts).toContainEqual({
      source: '/host/agent-personas',
      target: SUBAGENT_USER_PERSONAS_TARGET,
      readonly: true,
    });
    expect(spec.mounts).toContainEqual({
      source: '/host/history/lace',
      target: SUBAGENT_LACE_DATA_TARGET,
      readonly: false,
    });
    expect(spec.mounts).toContainEqual({
      source: '/host/credentials',
      target: SUBAGENT_CREDENTIALS_TARGET,
      readonly: true,
    });
    expect(spec.env.LACE_DIR).toBe(SUBAGENT_LACE_DATA_TARGET);
  });

  it('passes through env and ports when provided', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: {
        ...baseRuntime,
        env: { FOO: 'bar' },
        ports: [{ host: 9222, container: 9222 }],
      },
      containerMounts: {},
    });

    expect(spec.env).toEqual({ FOO: 'bar' });
    expect(spec.ports).toEqual([{ host: 9222, container: 9222 }]);
  });

  it('passes through sysctls when provided (PRI-1790)', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: {
        ...baseRuntime,
        sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' },
      },
      containerMounts: {},
    });

    expect(spec.sysctls).toEqual({ 'net.ipv6.conf.lo.disable_ipv6': '0' });
  });

  it('leaves spec.sysctls undefined when persona declares none', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: BASE_PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: BASE_CHILD_SESSION_ID,
      scratchDirHostPath: BASE_SCRATCH_PATH,
      runtime: baseRuntime,
      containerMounts: {},
    });

    expect(spec.sysctls).toBeUndefined();
  });
});

describe('buildPersonaContainerSpec with containerSharing: per_invocation (PRI-1796)', () => {
  const perInvocationRuntime = {
    type: 'container' as const,
    agentPlacement: 'host' as const,
    containerSharing: 'per_invocation' as const,
    image: 'devcontainer:latest',
    workingDirectory: '/workspace',
    mounts: {},
  };

  it('composes name from parentSessionId8 + persona + childSessionId8', () => {
    // sess_aaaaaaaa11111111 → strip 'sess_' → 'aaaaaaaa11111111' → first 8 → 'aaaaaaaa'
    // sess_bbbbbbbb22222222 → strip 'sess_' → 'bbbbbbbb22222222' → first 8 → 'bbbbbbbb'
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess_aaaaaaaa11111111',
      personaName: 'shell',
      childSessionId: 'sess_bbbbbbbb22222222',
      scratchDirHostPath: '/tmp/scratch',
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    expect(spec.name).toBe('aaaaaaaa-shell-bbbbbbbb');
  });

  it('auto-injects scratch mount at /work for per_invocation', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess_aaaaaaaa11111111',
      personaName: 'shell',
      childSessionId: 'sess_bbbbbbbb22222222',
      scratchDirHostPath: '/tmp/scratch',
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    expect(spec.mounts).toEqual(
      expect.arrayContaining([{ source: '/tmp/scratch', target: '/work', readonly: false }])
    );
  });

  it('rejects mounts.scratch declared by per_invocation persona', () => {
    // per_invocation persona cannot declare 'scratch' — reserved for auto-injection of /work
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess_aaaaaaaa11111111',
        personaName: 'shell',
        childSessionId: 'sess_bbbbbbbb22222222',
        scratchDirHostPath: '/tmp/scratch',
        runtime: {
          ...perInvocationRuntime,
          mounts: { scratch: '/work' },
        },
        containerMounts: { scratch: { hostPath: '/somewhere', readonly: false } },
      })
    ).toThrow(PersonaContainerSpecError);

    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess_aaaaaaaa11111111',
        personaName: 'shell',
        childSessionId: 'sess_bbbbbbbb22222222',
        scratchDirHostPath: '/tmp/scratch',
        runtime: {
          ...perInvocationRuntime,
          mounts: { scratch: '/work' },
        },
        containerMounts: { scratch: { hostPath: '/somewhere', readonly: false } },
      })
    ).toThrow(/scratch/);

    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess_aaaaaaaa11111111',
        personaName: 'shell',
        childSessionId: 'sess_bbbbbbbb22222222',
        scratchDirHostPath: '/tmp/scratch',
        runtime: {
          ...perInvocationRuntime,
          mounts: { scratch: '/work' },
        },
        containerMounts: { scratch: { hostPath: '/somewhere', readonly: false } },
      })
    ).toThrow(/per_invocation/);
  });

  it('allows mounts.scratch on persistent persona (not reserved for persistent)', () => {
    // For persistent personas, 'scratch' is resolved through the registry like any other mount.
    const persistentRuntime = {
      type: 'container' as const,
      agentPlacement: 'host' as const,
      containerSharing: 'persistent' as const,
      image: 'sen-box:dev',
      workingDirectory: '/home/agent',
      mounts: { scratch: '/work' },
    };

    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'sen',
        runtime: persistentRuntime,
        containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
      })
    ).not.toThrow();

    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: persistentRuntime,
      containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
    });
    expect(spec.mounts).toContainEqual({
      source: '/host/scratch',
      target: '/work',
      readonly: false,
    });
  });

  it('rejects invalid childSessionId for spec name', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess_aaaaaaaa11111111',
        personaName: 'shell',
        childSessionId: '!!!',
        scratchDirHostPath: '/tmp/scratch',
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(PersonaContainerSpecError);
  });

  it('throws when childSessionId is missing for per_invocation', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess_aaaaaaaa11111111',
        personaName: 'shell',
        scratchDirHostPath: '/tmp/scratch',
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(PersonaContainerSpecError);
  });

  it('throws when scratchDirHostPath is missing for per_invocation', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess_aaaaaaaa11111111',
        personaName: 'shell',
        childSessionId: 'sess_bbbbbbbb22222222',
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(PersonaContainerSpecError);
  });

  it('does not auto-inject scratch mount for persistent containers', () => {
    const persistentRuntime = {
      type: 'container' as const,
      agentPlacement: 'host' as const,
      containerSharing: 'persistent' as const,
      image: 'sen-box:dev',
      workingDirectory: '/home/agent',
      mounts: {},
    };

    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: persistentRuntime,
      containerMounts: {},
    });

    // No scratch auto-injection for persistent containers.
    const hasScratch = spec.mounts.some((m) => m.target === '/work');
    expect(hasScratch).toBe(false);
  });
});

describe('buildPersonaContainerSpec with containerSharing: persistent', () => {
  const basePersistentRuntime = {
    type: 'container' as const,
    agentPlacement: 'host' as const,
    containerSharing: 'persistent' as const,
    image: 'sen-box:dev',
    workingDirectory: '/home/agent',
    mounts: {},
  };

  it('produces a per-persona spec with personaName, containerId, and restartPolicy', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'box-shell',
      runtime: basePersistentRuntime,
      containerMounts: {},
    });

    expect(spec.name).toBe('box-shell');
    expect(spec.containerId).toBe('sen-box-shell');
    expect(spec.restartPolicy).toBe('unless-stopped');
    expect(spec.image).toBe('sen-box:dev');
    expect(spec.workingDirectory).toBe('/home/agent');
    expect(spec.mounts).toEqual([]);
    expect(spec.env).toEqual({});
    // Persistent lifecycle has no ports.
    expect(spec.ports).toBeUndefined();
  });

  it('derives spec.name and spec.containerId from personaName (PRI-1796)', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'box-shell',
      runtime: basePersistentRuntime,
      containerMounts: {},
    });

    expect(spec.name).toBe('box-shell');
    expect(spec.containerId).toBe('sen-box-shell');
  });

  it('passes through sysctls for persistent lifecycle (PRI-1790)', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: {
        ...basePersistentRuntime,
        sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' },
      },
      containerMounts: {},
    });

    expect(spec.sysctls).toEqual({ 'net.ipv6.conf.lo.disable_ipv6': '0' });
  });

  it('resolves runtime.mounts against the registry', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: {
        ...basePersistentRuntime,
        mounts: { work: '/work', knowledge: '/knowledge' },
      },
      containerMounts: {
        work: { hostPath: '/host/work', readonly: false },
        knowledge: { hostPath: '/host/knowledge', readonly: true },
      },
    });

    expect(spec.mounts).toEqual(
      expect.arrayContaining([
        { source: '/host/work', target: '/work', readonly: false },
        { source: '/host/knowledge', target: '/knowledge', readonly: true },
      ])
    );
  });

  it('auto-injects persona + lace-data + credentials and sets LACE_DIR', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: basePersistentRuntime,
      containerMounts: {
        persona: { hostPath: '/host/agent-personas', readonly: true },
        'lace-data': { hostPath: '/host/lace-data', readonly: false },
        credentials: { hostPath: '/host/credentials', readonly: true },
      },
    });

    expect(spec.mounts).toContainEqual({
      source: '/host/agent-personas',
      target: SUBAGENT_USER_PERSONAS_TARGET,
      readonly: true,
    });
    expect(spec.mounts).toContainEqual({
      source: '/host/lace-data',
      target: SUBAGENT_LACE_DATA_TARGET,
      readonly: false,
    });
    expect(spec.mounts).toContainEqual({
      source: '/host/credentials',
      target: SUBAGENT_CREDENTIALS_TARGET,
      readonly: true,
    });
    expect(spec.env.LACE_DIR).toBe(SUBAGENT_LACE_DATA_TARGET);
  });

  it('auto-injects the lace registry mount at /lace for persistent runtimes too (PRI-1774)', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: basePersistentRuntime,
      containerMounts: {
        lace: { hostPath: '/host/lace', readonly: true },
      },
    });

    expect(spec.mounts).toContainEqual({
      source: '/host/lace',
      target: SUBAGENT_LACE_TARGET,
      readonly: true,
    });
  });

  it('rejects unknown mount name', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'sen',
        runtime: { ...basePersistentRuntime, mounts: { phantom: '/phantom' } },
        containerMounts: {},
      })
    ).toThrow(/unknown mount 'phantom'/);
  });

  it('rejects reserved mount names', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'sen',
        runtime: { ...basePersistentRuntime, mounts: { persona: '/p' } },
        containerMounts: { persona: { hostPath: '/h', readonly: true } },
      })
    ).toThrow(/reserved/);

    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'sen',
        runtime: { ...basePersistentRuntime, mounts: { 'lace-data': '/p' } },
        containerMounts: { 'lace-data': { hostPath: '/h', readonly: false } },
      })
    ).toThrow(/reserved/);

    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'sen',
        runtime: { ...basePersistentRuntime, mounts: { credentials: '/p' } },
        containerMounts: { credentials: { hostPath: '/h', readonly: true } },
      })
    ).toThrow(/reserved/);
  });

  it('rejects unsafe personaName', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: '../etc/passwd',
        runtime: basePersistentRuntime,
        containerMounts: {},
      })
    ).toThrow(/Invalid personaName/);
  });

  it('passes through runtime.env', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: { ...basePersistentRuntime, env: { FOO: 'bar' } },
      containerMounts: {},
    });

    expect(spec.env).toEqual({ FOO: 'bar' });
  });

  it('throws PersonaContainerSpecError for invalid input', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'sen',
        runtime: { ...basePersistentRuntime, mounts: { phantom: '/p' } },
        containerMounts: {},
      })
    ).toThrow(PersonaContainerSpecError);
  });
});
