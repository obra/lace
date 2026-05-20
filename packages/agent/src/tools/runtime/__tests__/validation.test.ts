import { describe, expect, it } from 'vitest';
import { buildDefaultLocalRuntimeBinding, parseRuntimeExecutionBinding } from '../validation';

describe('runtime binding validation', () => {
  it('defaults missing legacy state to local runtime with a legacy id', () => {
    expect(buildDefaultLocalRuntimeBinding({ sessionId: 'sess_123', cwd: '/repo' })).toMatchObject({
      schemaVersion: 1,
      identity: {
        runtimeId: expect.stringMatching(/^legacy:session:sess_123:/),
      },
      agentPlacement: 'host',
      toolRuntime: { type: 'local', cwd: '/repo' },
    });
  });

  it('rejects unknown schema versions', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 99,
        identity: { runtimeId: 'rt_bad' },
        agentPlacement: 'host',
        toolRuntime: { type: 'local', cwd: '/repo' },
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
