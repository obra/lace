// ABOUTME: Unit tests for persona container spec construction

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  buildProjectedRuntimeSpec,
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
  mounts: [],
};

const persistentRuntime: PersonaContainerRuntime = {
  type: 'container',
  containerSharing: 'persistent',
  image: 'sen-box:dev',
  workingDirectory: '/home/agent',
  mounts: [],
};

type ProjectedSpecKeys = keyof ReturnType<typeof buildProjectedRuntimeSpec>;
type ForbiddenProjectedPersonaKeys = Extract<
  ProjectedSpecKeys,
  | 'containerId'
  | 'ports'
  | 'restartPolicy'
  | 'sysctls'
  | 'capAdd'
  | 'network'
  | 'gatewayRoute'
  | 'browserCdpSocket'
>;

describe('buildProjectedRuntimeSpec types', () => {
  // eslint-disable-next-line vitest/expect-expect -- expectTypeOf performs compile-time assertions.
  it('does not expose docker authority fields in the projected persona spec type', () => {
    expectTypeOf<ForbiddenProjectedPersonaKeys>().toEqualTypeOf<never>();
  });

  it('rejects forbidden docker authority field access at compile time', () => {
    const spec = buildProjectedRuntimeSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    // @ts-expect-error projected persona specs do not expose docker authority fields.
    expect(spec.capAdd).toBeUndefined();
    // @ts-expect-error projected persona specs do not expose docker authority fields.
    expect(spec.network).toBeUndefined();
  });
});

describe('buildProjectedRuntimeSpec per_invocation', () => {
  it('composes a per-child spec name and injects scratch at /work', () => {
    const spec = buildProjectedRuntimeSpec({
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
    expect(spec.mounts).toEqual([
      { hostPath: SCRATCH_PATH, containerPath: '/work', readonly: false },
    ]);
    expect(spec.restartPolicy).toBeUndefined();
    expect(spec.containerId).toBeUndefined();
  });

  it('resolves declared mounts and env without docker authority fields', () => {
    const spec = buildProjectedRuntimeSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'browser',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        ...perInvocationRuntime,
        mounts: ['identity'],
        env: { FOO: 'bar' },
        ports: [{ host: 9222, container: 9222 }],
        sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' },
      },
      containerMounts: {
        identity: { hostPath: '/host/identity', containerPath: '/etc/identity', readonly: true },
        unused: { hostPath: '/host/unused', containerPath: '/unused', readonly: false },
      },
    });

    expect(spec.mounts).toEqual([
      { hostPath: '/host/identity', containerPath: '/etc/identity', readonly: true },
      { hostPath: SCRATCH_PATH, containerPath: '/work', readonly: false },
    ]);
    expect(spec.env).toEqual({ FOO: 'bar' });
    expect(spec.ports).toBeUndefined();
    expect(spec.sysctls).toBeUndefined();
  });

  it('rejects missing per-invocation naming inputs', () => {
    expect(() =>
      buildProjectedRuntimeSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        scratchDirHostPath: SCRATCH_PATH,
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(/childSessionId/);

    expect(() =>
      buildProjectedRuntimeSpec({
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
      buildProjectedRuntimeSpec({
        parentSessionId: 'evil; rm -rf /',
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(/Invalid parentSessionId/);

    expect(() =>
      buildProjectedRuntimeSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: '../etc/passwd',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(/Invalid personaName/);

    expect(() =>
      buildProjectedRuntimeSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: '!!!',
        scratchDirHostPath: SCRATCH_PATH,
        runtime: perInvocationRuntime,
        containerMounts: {},
      })
    ).toThrow(PersonaContainerSpecError);

    expect(() =>
      buildProjectedRuntimeSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        runtime: { ...perInvocationRuntime, mounts: ['missing'] },
        containerMounts: {},
      })
    ).toThrow(/unknown mount 'missing'/);
  });

  it('reserves the scratch mount name only for per_invocation personas', () => {
    expect(() =>
      buildProjectedRuntimeSpec({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        runtime: { ...perInvocationRuntime, mounts: ['scratch'] },
        containerMounts: {
          scratch: { hostPath: '/host/scratch', containerPath: '/work', readonly: false },
        },
      })
    ).toThrow(/scratch/);
  });
});

describe('buildProjectedRuntimeSpec persistent', () => {
  it('produces a stable per-persona projected spec without docker authority fields', () => {
    const spec = buildProjectedRuntimeSpec({
      parentSessionId: 'sess1',
      personaName: 'box-shell',
      runtime: persistentRuntime,
      containerMounts: {},
    });

    expect(spec).toMatchObject({
      name: 'box-shell',
      image: 'sen-box:dev',
      workingDirectory: '/home/agent',
      env: {},
    });
    expect(spec.mounts).toEqual([]);
    expect(spec.containerId).toBeUndefined();
    expect(spec.restartPolicy).toBeUndefined();
    expect(spec.ports).toBeUndefined();
  });

  it('resolves declared mounts, including names that used to be legacy auto-injected', () => {
    const spec = buildProjectedRuntimeSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: {
        ...persistentRuntime,
        mounts: ['persona', 'lace-data', 'credentials', 'lace', 'scratch'],
      },
      containerMounts: {
        persona: { hostPath: '/host/personas', containerPath: '/personas', readonly: true },
        'lace-data': { hostPath: '/host/data', containerPath: '/data', readonly: false },
        credentials: {
          hostPath: '/host/credentials',
          containerPath: '/credentials',
          readonly: true,
        },
        lace: { hostPath: '/host/lace', containerPath: '/lace', readonly: true },
        scratch: { hostPath: '/host/scratch', containerPath: '/work', readonly: false },
      },
    });

    expect(spec.mounts).toEqual([
      { hostPath: '/host/personas', containerPath: '/personas', readonly: true },
      { hostPath: '/host/data', containerPath: '/data', readonly: false },
      { hostPath: '/host/credentials', containerPath: '/credentials', readonly: true },
      { hostPath: '/host/lace', containerPath: '/lace', readonly: true },
      { hostPath: '/host/scratch', containerPath: '/work', readonly: false },
    ]);
  });

  it('does not mount registry entries that the persona did not declare', () => {
    const spec = buildProjectedRuntimeSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: persistentRuntime,
      containerMounts: {
        persona: { hostPath: '/host/personas', containerPath: '/personas', readonly: true },
        'lace-data': { hostPath: '/host/data', containerPath: '/data', readonly: false },
        credentials: {
          hostPath: '/host/credentials',
          containerPath: '/credentials',
          readonly: true,
        },
        lace: { hostPath: '/host/lace', containerPath: '/lace', readonly: true },
      },
    });

    expect(spec.mounts).toEqual([]);
    expect(spec.env).toEqual({});
  });

  it('passes runtime env without LACE_DIR override and drops sysctls', () => {
    const spec = buildProjectedRuntimeSpec({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: {
        ...persistentRuntime,
        env: { LACE_DIR: '/persona/lace', OTHER: 'keep' },
        sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' },
      },
      containerMounts: {
        'lace-data': { hostPath: '/host/data', containerPath: '/data', readonly: false },
      },
    });

    expect(spec.env).toEqual({ LACE_DIR: '/persona/lace', OTHER: 'keep' });
    expect(spec.sysctls).toBeUndefined();
  });

  it('drops runtime capAdd, network, and gatewayRoute from the projected spec', () => {
    const spec = buildProjectedRuntimeSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'browser',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        ...perInvocationRuntime,
        capAdd: ['NET_ADMIN'],
        network: 'quarantine',
        gatewayRoute: '172.31.250.1',
      },
      containerMounts: {},
    });

    expect(spec.capAdd).toBeUndefined();
    expect(spec.network).toBeUndefined();
    expect(spec.gatewayRoute).toBeUndefined();
  });
});

describe('buildProjectedRuntimeSpec selector fields', () => {
  it('carries selector fields needed by the plane', () => {
    const spec = buildProjectedRuntimeSpec({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: { ...perInvocationRuntime, env: { FOO: 'bar' } },
      containerMounts: {},
    });

    expect(spec).toMatchObject({
      name: 'pppppppp-shell-cccccccc',
      image: 'devcontainer:latest',
      workingDirectory: '/workspace',
      mounts: [{ hostPath: SCRATCH_PATH, containerPath: '/work', readonly: false }],
      env: { FOO: 'bar' },
      persona: 'shell',
      parentSession: PARENT_SESSION_ID,
      childSession: CHILD_SESSION_ID,
    });
  });
});
