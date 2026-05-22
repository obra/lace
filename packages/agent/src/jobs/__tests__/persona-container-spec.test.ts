// ABOUTME: Unit tests for buildPersonaContainerSpec — name composition + mount resolution

import { describe, it, expect } from 'vitest';
import {
  buildPersonaContainerSpec,
  buildPersonaBoxSpec,
  PERSONA_BOX_CONTAINER_ID,
  PersonaContainerSpecError,
  SUBAGENT_USER_PERSONAS_TARGET,
  SUBAGENT_LACE_DATA_TARGET,
  SUBAGENT_CREDENTIALS_TARGET,
  SUBAGENT_LACE_TARGET,
} from '@lace/agent/jobs/persona-container-spec';

const baseRuntime = {
  type: 'container' as const,
  image: 'devcontainer:latest',
  workingDirectory: '/workspace',
  mounts: {},
};

describe('buildPersonaContainerSpec', () => {
  it('composes spec.name as parentSessionId-personaName', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'session-abc',
      personaName: 'shell',
      runtime: baseRuntime,
      containerMounts: {},
    });

    expect(spec.name).toBe('session-abc-shell');
    expect(spec.image).toBe('devcontainer:latest');
    expect(spec.workingDirectory).toBe('/workspace');
    expect(spec.mounts).toEqual([]);
    expect(spec.env).toEqual({});
  });

  it('resolves runtime.mounts against the registry into ContainerMount entries', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'browser',
      runtime: {
        ...baseRuntime,
        mounts: { scratch: '/scratch', identity: '/etc/identity' },
      },
      containerMounts: {
        scratch: { hostPath: '/host/scratch', readonly: false },
        identity: { hostPath: '/host/identity', readonly: true },
        unused: { hostPath: '/host/unused', readonly: false },
      },
    });

    expect(spec.mounts).toEqual(
      expect.arrayContaining([
        { source: '/host/scratch', target: '/scratch', readonly: false },
        { source: '/host/identity', target: '/etc/identity', readonly: true },
      ])
    );
    expect(spec.mounts).toHaveLength(2);
  });

  it('throws PersonaContainerSpecError on unknown mount name', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'shell',
        runtime: {
          ...baseRuntime,
          mounts: { scratch: '/scratch' },
        },
        containerMounts: {},
      })
    ).toThrow(PersonaContainerSpecError);
  });

  it('rejects parentSessionId containing unsafe characters', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'evil; rm -rf /',
        personaName: 'shell',
        runtime: baseRuntime,
        containerMounts: {},
      })
    ).toThrow(/Invalid parentSessionId/);
  });

  it('rejects personaName containing unsafe characters', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: '../etc/passwd',
        runtime: baseRuntime,
        containerMounts: {},
      })
    ).toThrow(/Invalid personaName/);
  });

  it('auto-injects the persona registry mount at the well-known target', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'shell',
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

  it('does not inject the persona mount when the registry omits it', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'shell',
      runtime: baseRuntime,
      containerMounts: {},
    });

    expect(spec.mounts).toEqual([]);
  });

  it('rejects a persona file declaring runtime.mounts.persona — reserved name', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'shell',
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
      parentSessionId: 'sess1',
      personaName: 'shell',
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

  it('does not inject the lace-data mount or LACE_DIR when the registry omits it', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'shell',
      runtime: baseRuntime,
      containerMounts: {},
    });

    expect(spec.mounts).toEqual([]);
    expect(spec.env).toEqual({});
    expect(spec.env).not.toHaveProperty('LACE_DIR');
  });

  it('rejects a persona file declaring runtime.mounts["lace-data"] — reserved name', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'shell',
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
      parentSessionId: 'sess1',
      personaName: 'shell',
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
      parentSessionId: 'sess1',
      personaName: 'shell',
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

  it('does not inject the credentials mount when the registry omits it', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'shell',
      runtime: baseRuntime,
      containerMounts: {},
    });

    expect(spec.mounts).toEqual([]);
  });

  it('rejects a persona file declaring runtime.mounts.credentials — reserved name', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'shell',
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
      parentSessionId: 'sess1',
      personaName: 'shell',
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

  it('does not inject the lace mount when the registry omits it (PRI-1774)', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'shell',
      runtime: baseRuntime,
      containerMounts: {},
    });

    expect(spec.mounts).toEqual([]);
  });

  it('rejects a persona file declaring runtime.mounts.lace — reserved name (PRI-1774)', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'sess1',
        personaName: 'shell',
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
      parentSessionId: 'sess1',
      personaName: 'shell',
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
      parentSessionId: 'sess1',
      personaName: 'shell',
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
});

describe('buildPersonaBoxSpec (kata #62)', () => {
  const baseBoxRuntime = {
    type: 'box' as const,
    image: 'sen-box:dev',
    workingDirectory: '/home/agent',
    mounts: {},
  };

  it('produces a single-tenant spec with fixed name, containerId, and restartPolicy', () => {
    const spec = buildPersonaBoxSpec({
      personaName: 'sen',
      runtime: baseBoxRuntime,
      containerMounts: {},
    });

    expect(spec.name).toBe('box');
    expect(spec.containerId).toBe(PERSONA_BOX_CONTAINER_ID);
    expect(spec.containerId).toBe('sen-box');
    expect(spec.restartPolicy).toBe('unless-stopped');
    expect(spec.image).toBe('sen-box:dev');
    expect(spec.workingDirectory).toBe('/home/agent');
    expect(spec.mounts).toEqual([]);
    expect(spec.env).toEqual({});
    // Box has no ports in v1.
    expect(spec.ports).toBeUndefined();
  });

  it('resolves runtime.mounts against the registry', () => {
    const spec = buildPersonaBoxSpec({
      personaName: 'sen',
      runtime: {
        ...baseBoxRuntime,
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
    const spec = buildPersonaBoxSpec({
      personaName: 'sen',
      runtime: baseBoxRuntime,
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

  it('auto-injects the lace registry mount at /lace for box runtimes too (PRI-1774)', () => {
    const spec = buildPersonaBoxSpec({
      personaName: 'sen',
      runtime: baseBoxRuntime,
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
      buildPersonaBoxSpec({
        personaName: 'sen',
        runtime: { ...baseBoxRuntime, mounts: { phantom: '/phantom' } },
        containerMounts: {},
      })
    ).toThrow(/unknown mount 'phantom'/);
  });

  it('rejects reserved mount names', () => {
    expect(() =>
      buildPersonaBoxSpec({
        personaName: 'sen',
        runtime: { ...baseBoxRuntime, mounts: { persona: '/p' } },
        containerMounts: { persona: { hostPath: '/h', readonly: true } },
      })
    ).toThrow(/reserved/);

    expect(() =>
      buildPersonaBoxSpec({
        personaName: 'sen',
        runtime: { ...baseBoxRuntime, mounts: { 'lace-data': '/p' } },
        containerMounts: { 'lace-data': { hostPath: '/h', readonly: false } },
      })
    ).toThrow(/reserved/);

    expect(() =>
      buildPersonaBoxSpec({
        personaName: 'sen',
        runtime: { ...baseBoxRuntime, mounts: { credentials: '/p' } },
        containerMounts: { credentials: { hostPath: '/h', readonly: true } },
      })
    ).toThrow(/reserved/);
  });

  it('rejects unsafe personaName', () => {
    expect(() =>
      buildPersonaBoxSpec({
        personaName: '../etc/passwd',
        runtime: baseBoxRuntime,
        containerMounts: {},
      })
    ).toThrow(/Invalid personaName/);
  });

  it('passes through runtime.env', () => {
    const spec = buildPersonaBoxSpec({
      personaName: 'sen',
      runtime: { ...baseBoxRuntime, env: { FOO: 'bar' } },
      containerMounts: {},
    });

    expect(spec.env).toEqual({ FOO: 'bar' });
  });

  it('throws PersonaContainerSpecError for invalid input', () => {
    expect(() =>
      buildPersonaBoxSpec({
        personaName: 'sen',
        runtime: { ...baseBoxRuntime, mounts: { phantom: '/p' } },
        containerMounts: {},
      })
    ).toThrow(PersonaContainerSpecError);
  });
});
