import { describe, expect, it } from 'vitest';
import { buildPersonaProjectedRuntimeBinding } from '../persona-projected-binding';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

const digest = 'sha256:' + 'a'.repeat(64);

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
      imageIdentity: {
        requestedImage: 'node:24-bookworm',
        resolvedImageDigest: digest,
        imagePlatform: 'linux/arm64',
      },
    });

    expect(binding.agentPlacement).toBe('host');
    expect(binding.toolRuntime).toMatchObject({
      type: 'container',
      cwd: '/work',
      spec: {
        name: 'sess1-shell',
        requestedImage: 'node:24-bookworm',
        resolvedImageDigest: digest,
        imagePlatform: 'linux/arm64',
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
      imageIdentity: {
        requestedImage: 'sen-box:dev',
        resolvedImageDigest: digest,
        imagePlatform: 'linux/arm64',
      },
    });

    expect(binding.toolRuntime).toMatchObject({
      type: 'container',
      cwd: '/home/agent',
      spec: {
        name: 'box',
        containerId: 'sen-box',
        restartPolicy: 'unless-stopped',
      },
    });
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
        imageIdentity: {
          requestedImage: 'node:24-bookworm',
          resolvedImageDigest: digest,
          imagePlatform: 'linux/arm64',
        },
      })
    ).toThrow(/unknown mount 'missing'/);
  });
});
