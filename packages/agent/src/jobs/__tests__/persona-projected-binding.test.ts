import { describe, expect, it } from 'vitest';
import { buildPersonaProjectedRuntimeBinding } from '../persona-projected-binding';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

describe('buildPersonaProjectedRuntimeBinding', () => {
  it('builds a projected binding for session lifecycle containers', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: 'sess1',
      personaName: 'shell',
      runtime: {
        type: 'container',
        agentPlacement: 'host',
        containerLifecycle: 'session',
        image: 'node:24-bookworm',
        workingDirectory: '/work',
        mounts: { scratch: '/work' },
        env: { FOO: 'bar' },
        ports: [{ host: 6080, container: 6080 }],
      },
      containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
    });

    expect(binding.agentPlacement).toBe('host');
    expect(binding.toolRuntime).toMatchObject({
      type: 'container',
      cwd: '/work',
      spec: {
        name: 'sess1-shell',
        image: 'node:24-bookworm',
        workingDirectory: '/work',
        mounts: [{ hostPath: '/host/scratch', containerPath: '/work', readonly: false }],
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
    expect(binding.identity.runtimeId).toMatch(/^runtime:session:sess1:/);
  });

  it('builds a projected binding for persistent lifecycle containers', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: 'sess1',
      personaName: 'box-shell',
      runtime: {
        type: 'container',
        agentPlacement: 'host',
        containerLifecycle: 'persistent',
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
        name: 'box',
        containerId: 'sen-box',
        image: 'sen-box:dev',
        restartPolicy: 'unless-stopped',
      },
    });
  });

  it('threads persona-declared sysctls into the projected descriptor (PRI-1790)', () => {
    const binding = buildPersonaProjectedRuntimeBinding({
      parentSessionId: 'sess1',
      personaName: 'browser-driver',
      runtime: {
        type: 'container',
        agentPlacement: 'host',
        containerLifecycle: 'session',
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

  it('passes the persona-declared image reference through verbatim (tag, digest, anything)', () => {
    const tagOnly = buildPersonaProjectedRuntimeBinding({
      parentSessionId: 'sess1',
      personaName: 'shell',
      runtime: {
        type: 'container',
        agentPlacement: 'host',
        containerLifecycle: 'session',
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
      parentSessionId: 'sess1',
      personaName: 'shell',
      runtime: {
        type: 'container',
        agentPlacement: 'host',
        containerLifecycle: 'session',
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
        parentSessionId: 'sess1',
        personaName: 'shell',
        runtime: {
          type: 'container',
          agentPlacement: 'host',
          containerLifecycle: 'session',
          image: 'node:24-bookworm',
          workingDirectory: '/work',
          mounts: { missing: '/work' },
        },
        containerMounts: {},
      })
    ).toThrow(/unknown mount 'missing'/);
  });
});
