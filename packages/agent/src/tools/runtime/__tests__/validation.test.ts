import { describe, expect, it } from 'vitest';
import { buildDefaultBoundedHostRuntimeBinding, parseRuntimeExecutionBinding } from '../validation';

describe('runtime binding validation', () => {
  it('defaults missing host state to boundedHost runtime', () => {
    expect(
      buildDefaultBoundedHostRuntimeBinding({ sessionId: 'sess_123', cwd: '/repo' })
    ).toMatchObject({
      schemaVersion: 1,
      identity: {
        runtimeId: expect.stringMatching(/^runtime:session:sess_123:/),
      },
      agentPlacement: 'host',
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    });
  });

  it('accepts host runtime descriptor', () => {
    expect(
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_host' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'host',
          cwd: '/repo',
        },
      })
    ).toMatchObject({
      toolRuntime: { type: 'host', cwd: '/repo' },
    });
  });

  it('accepts boundedHost runtime descriptor', () => {
    expect(
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_bounded' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'boundedHost',
          root: '/repo',
          cwd: '/repo/pkg',
        },
      })
    ).toMatchObject({
      toolRuntime: {
        type: 'boundedHost',
        root: '/repo',
        cwd: '/repo/pkg',
      },
    });
  });

  it('rejects local runtime descriptors', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'old_local' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'local',
          cwd: '/repo',
        },
      })
    ).toThrow(/invalid runtime binding/i);
  });

  it('rejects workspace runtime descriptors', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'old_workspace' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'workspace',
          projectRoot: '/project',
          workspaceRoot: '/tmp/workspace',
          cwd: '/project/pkg',
        },
      })
    ).toThrow(/invalid runtime binding/i);
  });

  it('rejects unknown schema versions', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 99,
        identity: { runtimeId: 'rt_bad' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'host',
          cwd: '/repo',
        },
      })
    ).toThrow(/unsupported runtime binding version/i);
  });

  it('rejects unknown schema versions before nested descriptor validation', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 99,
        identity: { runtimeId: 'rt_bad_container' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'container',
          cwd: '/workspace',
          spec: {
            name: 'proj',
            requestedImage: 'example/app:dev',
            resolvedImageDigest: 'latest',
            imagePlatform: 'linux/arm64',
            workingDirectory: '/workspace',
            mounts: [],
          },
        },
      })
    ).toThrow(/unsupported runtime binding version/i);
  });

  it('rejects projected container binding without image platform', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_container' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'container',
          cwd: '/workspace',
          spec: {
            name: 'proj',
            requestedImage: 'example/app:dev',
            resolvedImageDigest:
              'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            workingDirectory: '/workspace',
            mounts: [],
          },
        },
      })
    ).toThrow(/imagePlatform/i);
  });
});
