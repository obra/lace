import { describe, expect, it } from 'vitest';
import { buildPersonaProjectedRuntimeBinding } from '../persona-projected-binding';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

// Stable ids for per_invocation tests.
// sess_pppppppp00000000 → short 'pppppppp'
// sess_cccccccc00000000 → short 'cccccccc'
const PARENT_SESSION_ID = 'sess_pppppppp00000000';
const CHILD_SESSION_ID = 'sess_cccccccc00000000';
const SCRATCH_PATH = '/tmp/test-scratch';

describe('buildPersonaProjectedRuntimeBinding', () => {
  it('builds a projected binding for session lifecycle containers', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        type: 'container',
        containerSharing: 'per_invocation',
        image: 'node:24-bookworm',
        workingDirectory: '/work',
        mounts: {},
        env: { FOO: 'bar' },
        ports: [{ host: 6080, container: 6080 }],
      },
      containerMounts: {},
    });

    expect(binding.toolRuntime).toMatchObject({
      type: 'container',
      cwd: '/work',
      spec: {
        name: 'pppppppp-shell-cccccccc',
        image: 'node:24-bookworm',
        workingDirectory: '/work',
        env: { FOO: 'bar' },
        ports: [{ host: 6080, container: 6080 }],
      },
      helper: {
        mode: 'mount',
        containerPath: '/usr/local/bin/lace-runtime-helper.js',
        command: ['node', '/usr/local/bin/lace-runtime-helper.js'],
      },
    });

    // Helper descriptor must be present on every projected binding.
    expect(
      (
        binding.toolRuntime as Extract<
          RuntimeExecutionBinding['toolRuntime'],
          { type: 'container' }
        >
      ).helper
    ).toMatchObject({
      mode: 'mount',
      containerPath: '/usr/local/bin/lace-runtime-helper.js',
      command: ['node', '/usr/local/bin/lace-runtime-helper.js'],
    });

    // Runtime id should be deterministic and start with the session prefix.
    expect(binding.identity.runtimeId).toMatch(/^runtime:session:/);
  });

  it('applies execution env after persona runtime env', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        type: 'container',
        containerSharing: 'per_invocation',
        image: 'node:24-bookworm',
        workingDirectory: '/work',
        mounts: {},
        env: { FOO: 'persona', KEEP: 'runtime' },
      },
      containerMounts: {},
      executionEnv: { FOO: 'execution', SEN_AGENT_TOKEN: 'token' },
    });

    expect(
      (
        binding.toolRuntime as Extract<
          RuntimeExecutionBinding['toolRuntime'],
          { type: 'container' }
        >
      ).spec.env
    ).toEqual({ FOO: 'execution', KEEP: 'runtime', SEN_AGENT_TOKEN: 'token' });
  });

  it('builds a projected binding for persistent lifecycle containers', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: 'sess1',
      personaName: 'box-shell',
      runtime: {
        type: 'container',
        containerSharing: 'persistent',
        image: 'sen-box:dev',
        workingDirectory: '/home/agent',
        mounts: { home: '/home/agent' },
        env: { HOME: '/home/agent' },
      },
      containerMounts: { home: { hostPath: '/host/home', readonly: false } },
    });

    expect(binding.toolRuntime).toMatchObject({
      type: 'container',
      cwd: '/home/agent',
      spec: {
        name: 'box-shell',
        containerId: 'box-box-shell',
        image: 'sen-box:dev',
        restartPolicy: 'unless-stopped',
      },
    });
  });

  it('threads persona-declared sysctls into the projected descriptor', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'browser-driver',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        type: 'container',
        containerSharing: 'per_invocation',
        image: 'sen-browser:dev',
        workingDirectory: '/work',
        mounts: {},
        sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' },
      },
      containerMounts: {},
    });

    expect(binding.toolRuntime).toMatchObject({
      type: 'container',
      spec: { sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' } },
    });
  });

  it('threads persona-declared capAdd into the projected descriptor', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'box',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        type: 'container',
        containerSharing: 'per_invocation',
        image: 'sen-box:dev',
        workingDirectory: '/work',
        mounts: {},
        capAdd: ['NET_ADMIN'],
      },
      containerMounts: {},
    });

    expect(binding.toolRuntime).toMatchObject({
      type: 'container',
      spec: { capAdd: ['NET_ADMIN'] },
    });
  });

  it('threads persona-declared network into the projected descriptor', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'box',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        type: 'container',
        containerSharing: 'per_invocation',
        image: 'sen-box:dev',
        workingDirectory: '/work',
        mounts: {},
        network: 'quarantine',
      },
      containerMounts: {},
    });

    expect(binding.toolRuntime).toMatchObject({
      type: 'container',
      spec: { network: 'quarantine' },
    });
  });

  it('passes the persona-declared image reference through verbatim (tag, digest, anything)', () => {
    const tagOnly = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        type: 'container',
        containerSharing: 'per_invocation',
        image: 'sen-box:dev',
        workingDirectory: '/work',
        mounts: {},
      },
      containerMounts: {},
    });
    expect(
      (
        tagOnly.toolRuntime as Extract<
          RuntimeExecutionBinding['toolRuntime'],
          { type: 'container' }
        >
      ).spec.image
    ).toBe('sen-box:dev');

    const digestPinned = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: {
        type: 'container',
        containerSharing: 'per_invocation',
        image: 'example/app@sha256:' + 'a'.repeat(64),
        workingDirectory: '/work',
        mounts: {},
      },
      containerMounts: {},
    });
    expect(
      (
        digestPinned.toolRuntime as Extract<
          RuntimeExecutionBinding['toolRuntime'],
          { type: 'container' }
        >
      ).spec.image
    ).toBe('example/app@sha256:' + 'a'.repeat(64));
  });

  it('fails before binding construction when a mount is unknown', () => {
    expect(() =>
      buildPersonaProjectedRuntimeBinding({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        runtime: {
          type: 'container',
          containerSharing: 'per_invocation',
          image: 'node:24-bookworm',
          workingDirectory: '/work',
          mounts: { missing: '/work' },
        },
        containerMounts: {},
      })
    ).toThrow(/unknown mount 'missing'/);
  });
});

describe('buildPersonaProjectedRuntimeBinding with containerSharing discriminator', () => {
  const perInvocationRuntime = {
    type: 'container' as const,
    containerSharing: 'per_invocation' as const,
    image: 'devcontainer:latest',
    workingDirectory: '/workspace',
    mounts: {},
  };

  const persistentRuntime = {
    type: 'container' as const,
    containerSharing: 'persistent' as const,
    image: 'sen-box:dev',
    workingDirectory: '/home/agent',
    mounts: {},
  };

  it('passes childSessionId and scratchDirHostPath through to buildPersonaContainerSpec', () => {
    // sess_aaaaaaaa11111111 → parent short 'aaaaaaaa'
    // sess_bbbbbbbb22222222 → child  short 'bbbbbbbb'
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: 'sess_aaaaaaaa11111111',
      personaName: 'shell',
      childSessionId: 'sess_bbbbbbbb22222222',
      scratchDirHostPath: '/tmp/my-scratch',
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    const containerRuntime = binding.toolRuntime as Extract<
      RuntimeExecutionBinding['toolRuntime'],
      { type: 'container' }
    >;
    // Spec name uses the per_invocation naming scheme.
    expect(containerRuntime.spec.name).toBe('aaaaaaaa-shell-bbbbbbbb');
    // Scratch mount is auto-injected.
    expect(containerRuntime.spec.mounts).toContainEqual({
      hostPath: '/tmp/my-scratch',
      containerPath: '/work',
      readonly: false,
    });
  });

  it('tags binding metadata with containerSharing: per_invocation', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    expect(binding.containerSharing).toBe('per_invocation');
  });

  it('tags binding metadata with containerSharing: persistent', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: 'sess1',
      personaName: 'sen',
      runtime: persistentRuntime,
      containerMounts: {},
    });

    expect(binding.containerSharing).toBe('persistent');
  });

  it('concurrent per_invocation invocations produce distinct spec names', () => {
    const bindingA = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: 'sess_aaaaaaaa11111111',
      scratchDirHostPath: SCRATCH_PATH,
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    const bindingB = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: 'sess_bbbbbbbb22222222',
      scratchDirHostPath: SCRATCH_PATH,
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    const specA = (
      bindingA.toolRuntime as Extract<RuntimeExecutionBinding['toolRuntime'], { type: 'container' }>
    ).spec;
    const specB = (
      bindingB.toolRuntime as Extract<RuntimeExecutionBinding['toolRuntime'], { type: 'container' }>
    ).spec;
    expect(specA.name).not.toBe(specB.name);
  });

  it('same childSessionId produces same spec name (resume reuses container)', () => {
    const binding1 = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    const binding2 = buildPersonaProjectedRuntimeBinding({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      runtime: perInvocationRuntime,
      containerMounts: {},
    });

    const spec1 = (
      binding1.toolRuntime as Extract<RuntimeExecutionBinding['toolRuntime'], { type: 'container' }>
    ).spec;
    const spec2 = (
      binding2.toolRuntime as Extract<RuntimeExecutionBinding['toolRuntime'], { type: 'container' }>
    ).spec;
    expect(spec1.name).toBe(spec2.name);
  });
});
