// ABOUTME: Unit tests for buildPersonaContainerSpec — name composition + mount resolution

import { describe, it, expect } from 'vitest';
import {
  buildPersonaContainerSpec,
  PersonaContainerSpecError,
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
