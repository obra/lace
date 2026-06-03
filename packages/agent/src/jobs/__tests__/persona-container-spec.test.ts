// ABOUTME: Unit tests for persona container spec construction

import { describe, expect, it } from 'vitest';
import {
  buildPersonaContainerSpec,
  containerSpecToRuntimeSpec,
  PersonaContainerSpecError,
  type PersonaContainerRuntime,
} from '@lace/agent/jobs/persona-container-spec';

const PARENT_SESSION_ID = 'sess_pppppppp00000000';
const CHILD_SESSION_ID = 'sess_cccccccc00000000';
const SCRATCH_PATH = '/tmp/test-scratch';

const perInvocationRuntime: PersonaContainerRuntime = {
  type: 'container',
  containerSharing: 'per_invocation',
  image: 'devcontainer:latest',
  workingDirectory: '/workspace',
  mounts: {},
};

const persistentRuntime: PersonaContainerRuntime = {
  type: 'container',
  containerSharing: 'persistent',
  image: 'sen-box:dev',
  workingDirectory: '/home/agent',
  mounts: {},
};

describe('buildPersonaContainerSpec per_invocation', () => {
  it('composes a per-child spec name and injects scratch at /work', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    expect(spec).toMatchObject({
      name: 'pppppppp-shell-cccccccc',
      image: 'devcontainer:latest',
      workingDirectory: '/workspace',
      env: {},
    });
    expect(spec.mounts).toEqual([{ source: SCRATCH_PATH, target: '/work', readonly: false }]);
    expect(spec.restartPolicy).toBeUndefined();
    expect(spec.containerId).toBeUndefined();
  });

  it('resolves declared mounts and passes env, ports, and sysctls through', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'browser',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        ...perInvocationRuntime,
        mounts: { identity: '/etc/identity' },
        env: { FOO: 'bar' },
        ports: [{ host: 9222, container: 9222 }],
        sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' },
      },
      containerMounts: {
        identity: { hostPath: '/host/identity', readonly: true },
        unused: { hostPath: '/host/unused', readonly: false },
      },
    });

    expect(spec.mounts).toEqual([
      { source: '/host/identity', target: '/etc/identity', readonly: true },
      { source: SCRATCH_PATH, target: '/work', readonly: false },
    ]);
    expect(spec.env).toEqual({ FOO: 'bar' });
    expect(spec.ports).toEqual([{ host: 9222, container: 9222 }]);
    expect(spec.sysctls).toEqual({ 'net.ipv6.conf.lo.disable_ipv6': '0' });
  });

  it('rejects missing per-invocation naming inputs', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        scratchDirHostPath: SCRATCH_PATH,
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(/childSessionId/);

    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(/scratchDirHostPath/);
  });

  it('rejects unsafe name components and unknown mounts', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: 'evil; rm -rf /',
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(/Invalid parentSessionId/);

    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: '../etc/passwd',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(/Invalid personaName/);

    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: '!!!',
        scratchDirHostPath: SCRATCH_PATH,
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(PersonaContainerSpecError);

    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        runtime: { ...perInvocationRuntime, mounts: { missing: '/missing' } },
        containerMounts: {},
      })
    ).toThrow(/unknown mount 'missing'/);
  });

  it('reserves the scratch mount name only for per_invocation personas', () => {
    expect(() =>
      buildPersonaContainerSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        runtime: { ...perInvocationRuntime, mounts: { scratch: '/work' } },
        containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
      })
    ).toThrow(/scratch/);
  });
});

describe('buildPersonaContainerSpec persistent', () => {
  it('produces a stable per-persona daemon spec', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'box-shell',
      runtime: persistentRuntime,
      containerMounts: {},
    });

    expect(spec).toMatchObject({
      name: 'box-shell',
      containerId: 'box-box-shell',
      image: 'sen-box:dev',
      workingDirectory: '/home/agent',
      env: {},
      restartPolicy: 'unless-stopped',
    });
    expect(spec.mounts).toEqual([]);
    expect(spec.ports).toBeUndefined();
  });

  it('resolves declared mounts, including names that used to be legacy auto-injected', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: {
        ...persistentRuntime,
        mounts: {
          persona: '/personas',
          'lace-data': '/data',
          credentials: '/credentials',
          lace: '/lace',
          scratch: '/work',
        },
      },
      containerMounts: {
        persona: { hostPath: '/host/personas', readonly: true },
        'lace-data': { hostPath: '/host/data', readonly: false },
        credentials: { hostPath: '/host/credentials', readonly: true },
        lace: { hostPath: '/host/lace', readonly: true },
        scratch: { hostPath: '/host/scratch', readonly: false },
      },
    });

    expect(spec.mounts).toEqual([
      { source: '/host/personas', target: '/personas', readonly: true },
      { source: '/host/data', target: '/data', readonly: false },
      { source: '/host/credentials', target: '/credentials', readonly: true },
      { source: '/host/lace', target: '/lace', readonly: true },
      { source: '/host/scratch', target: '/work', readonly: false },
    ]);
  });

  it('does not mount registry entries that the persona did not declare', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: persistentRuntime,
      containerMounts: {
        persona: { hostPath: '/host/personas', readonly: true },
        'lace-data': { hostPath: '/host/data', readonly: false },
        credentials: { hostPath: '/host/credentials', readonly: true },
        lace: { hostPath: '/host/lace', readonly: true },
      },
    });

    expect(spec.mounts).toEqual([]);
    expect(spec.env).toEqual({});
  });

  it('passes runtime env and sysctls through without LACE_DIR override', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: {
        ...persistentRuntime,
        env: { LACE_DIR: '/persona/lace', OTHER: 'keep' },
        sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' },
      },
      containerMounts: {
        'lace-data': { hostPath: '/host/data', readonly: false },
      },
    });

    expect(spec.env).toEqual({ LACE_DIR: '/persona/lace', OTHER: 'keep' });
    expect(spec.sysctls).toEqual({ 'net.ipv6.conf.lo.disable_ipv6': '0' });
  });

  it('passes runtime capAdd and network through to spec', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'browser',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        ...perInvocationRuntime,
        capAdd: ['NET_ADMIN'],
        network: 'quarantine',
      },
      containerMounts: {},
    });

    expect(spec.capAdd).toEqual(['NET_ADMIN']);
    expect(spec.network).toBe('quarantine');
  });

  it('passes runtime gatewayRoute through to spec', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        ...perInvocationRuntime,
        gatewayRoute: '172.31.250.1',
      },
      containerMounts: {},
    });

    expect(spec.gatewayRoute).toBe('172.31.250.1');
  });

  it('passes gatewayRoute through containerSpecToRuntimeSpec', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        ...perInvocationRuntime,
        gatewayRoute: '172.31.250.1',
      },
      containerMounts: {},
    });

    expect(containerSpecToRuntimeSpec({ spec })).toMatchObject({
      gatewayRoute: '172.31.250.1',
    });
  });

  it('injects SEN_BROWSER_CDP_SOCKET env when browserCdpSocket is set', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'browser',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        ...perInvocationRuntime,
        browserCdpSocket: true,
      },
      containerMounts: {},
    });

    expect(spec.browserCdpSocket).toBe(true);
    expect(spec.env).toEqual({
      SEN_BROWSER_CDP_SOCKET: '/sen-browser-cdp/pppppppp-browser-cccccccc.sock',
    });
  });

  it('does not inject SEN_BROWSER_CDP_SOCKET env when browserCdpSocket is absent', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'browser',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    expect(spec.browserCdpSocket).toBeUndefined();
    expect(spec.env.SEN_BROWSER_CDP_SOCKET).toBeUndefined();
  });

  it('injects SEN_BROWSER_CDP_SOCKET env for persistent personas', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'browser',
      runtime: {
        ...persistentRuntime,
        browserCdpSocket: true,
      },
      containerMounts: {},
    });

    expect(spec.browserCdpSocket).toBe(true);
    expect(spec.env).toEqual({
      SEN_BROWSER_CDP_SOCKET: '/sen-browser-cdp/browser.sock',
    });
  });

  it('passes browserCdpSocket through containerSpecToRuntimeSpec', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'browser',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        ...perInvocationRuntime,
        browserCdpSocket: true,
      },
      containerMounts: {},
    });

    expect(containerSpecToRuntimeSpec({ spec })).toMatchObject({
      browserCdpSocket: true,
    });
  });
});

describe('containerSpecToRuntimeSpec', () => {
  it('converts daemon mounts to projected runtime mounts', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: { ...perInvocationRuntime, env: { FOO: 'bar' } },
      containerMounts: {},
    });

    expect(containerSpecToRuntimeSpec({ spec })).toMatchObject({
      name: 'pppppppp-shell-cccccccc',
      image: 'devcontainer:latest',
      workingDirectory: '/workspace',
      mounts: [{ hostPath: SCRATCH_PATH, containerPath: '/work', readonly: false }],
      env: { FOO: 'bar' },
    });
  });
});
