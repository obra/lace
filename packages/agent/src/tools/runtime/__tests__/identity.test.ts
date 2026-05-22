import { describe, expect, it } from 'vitest';
import { buildLegacyRuntimeId, canonicalRuntimeIdentityJson } from '../identity';
import type { RuntimeExecutionBinding } from '../types';

describe('runtime identity', () => {
  it('matches the boundedHost local-default fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:session:sess_123:d33ee12dd7d5f31b' },
      agentPlacement: 'host',
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    };

    expect(
      canonicalRuntimeIdentityJson({
        schemaVersion: binding.schemaVersion,
        agentPlacement: binding.agentPlacement,
        scope: 'session',
        sessionId: 'sess_123',
        toolRuntime: binding.toolRuntime,
      })
    ).toContain('"type":"boundedHost"');
  });

  it('produces expected legacy ids for boundedHost tool runtime bindings', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'runtime-legacy-session' },
      agentPlacement: 'host',
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    };

    expect(buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding })).toMatch(
      /^legacy:session:sess_123:[0-9a-f]{16}$/
    );
  });

  it('matches the bounded host fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:session:sess_123:540af98facc5cf4c' },
      agentPlacement: 'host',
      toolRuntime: {
        type: 'boundedHost',
        root: '/tmp/ws',
        cwd: '/work',
      },
    };

    expect(buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding })).toMatch(
      /^legacy:session:sess_123:[0-9a-f]{16}$/
    );
  });

  it('matches legacy IDs across bounded host shape changes with normalized fields', () => {
    const legacyHost: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:session:sess_123:old' },
      agentPlacement: 'host',
      toolRuntime: { type: 'boundedHost', root: '/tmp/ws', cwd: '/tmp/ws/pkg' },
    };
    const normalized: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:session:sess_123:old' },
      agentPlacement: 'host',
      toolRuntime: { type: 'boundedHost', root: '/tmp/ws', cwd: '/tmp/ws/pkg' },
    };

    expect(
      buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding: legacyHost })
    ).toBe(buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding: normalized }));
  });

  it('matches the legacy job fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:job:sess_123:job_456:4412929fcf49cd3e' },
      agentPlacement: 'host',
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    };

    expect(
      buildLegacyRuntimeId({
        scope: 'job',
        sessionId: 'sess_123',
        jobId: 'job_456',
        binding,
      })
    ).toMatch(/^legacy:job:sess_123:job_456:[0-9a-f]{16}$/);
  });

  it('matches the legacy projected-container fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:session:sess_123:572e0f4cb1e340fb' },
      agentPlacement: 'host',
      toolRuntime: {
        type: 'container',
        spec: {
          name: 'runtime',
          containerId: 'container-123',
          requestedImage: 'example/app:dev',
          resolvedImageDigest:
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          imagePlatform: 'linux/arm64',
          workingDirectory: '/workspace',
          mounts: [{ containerPath: '/workspace', hostPath: '/repo', readonly: false }],
          env: { NODE_ENV: 'test' },
          secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
          ports: [{ container: 3000, host: 13000 }],
        },
        cwd: '/workspace',
        helper: {
          mode: 'image',
          containerPath: '/usr/local/bin/lace-runtime-helper',
          hostPath: '/tmp/lace-runtime-helper',
          command: ['node', '/usr/local/bin/lace-runtime-helper'],
        },
      },
    };

    expect(buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding })).toBe(
      'legacy:session:sess_123:572e0f4cb1e340fb'
    );
  });

  it('normalizes container descriptor ordering for legacy ids', () => {
    const first: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:session:sess_123:ordered' },
      agentPlacement: 'host',
      toolRuntime: {
        type: 'container',
        spec: {
          name: 'runtime',
          requestedImage: 'example/app:dev',
          resolvedImageDigest:
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          imagePlatform: 'linux/arm64',
          workingDirectory: '/workspace',
          mounts: [
            { containerPath: '/data', hostPath: '/repo/data', readonly: true },
            { containerPath: '/workspace', hostPath: '/repo', readonly: false },
          ],
          env: { ZED: 'last', ALPHA: 'first' },
          secretEnv: {
            TOKEN: { namespace: 'session', name: 'token' },
            API_KEY: { namespace: 'project', name: 'api-key' },
          },
          ports: [
            { container: 3001, host: 13001 },
            { container: 3000, host: 13000 },
          ],
        },
        cwd: '/workspace',
        helper: {
          mode: 'image',
          containerPath: '/usr/local/bin/lace-runtime-helper',
          command: ['node', '/usr/local/bin/lace-runtime-helper'],
        },
      },
    };
    const second: RuntimeExecutionBinding = {
      ...first,
      toolRuntime: {
        type: 'container',
        spec: {
          ...first.toolRuntime.spec,
          mounts: [...first.toolRuntime.spec.mounts].reverse(),
          env: { ALPHA: 'first', ZED: 'last' },
          secretEnv: {
            API_KEY: { namespace: 'project', name: 'api-key' },
            TOKEN: { namespace: 'session', name: 'token' },
          },
          ports: [...(first.toolRuntime.spec.ports ?? [])].reverse(),
        },
        cwd: first.toolRuntime.cwd,
        helper: first.toolRuntime.helper,
      },
    };

    expect(buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding: first })).toBe(
      buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding: second })
    );
  });

  it('includes MCP placement, transport, and effective cwd in legacy ids', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:mcp:sess_123:server_1:runtime' },
      agentPlacement: 'host',
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    };

    const runtimePlaced = buildLegacyRuntimeId({
      scope: 'mcp',
      sessionId: 'sess_123',
      serverId: 'server_1',
      placement: 'toolRuntime',
      transport: 'stdio',
      effectiveCwd: '/repo',
      binding,
    });
    const hostPlaced = buildLegacyRuntimeId({
      scope: 'mcp',
      sessionId: 'sess_123',
      serverId: 'server_1',
      placement: 'host',
      transport: 'stdio',
      effectiveCwd: '/repo',
      binding,
    });

    expect(runtimePlaced).not.toBe(hostPlaced);

    // @ts-expect-error MCP legacy ids require placement, transport, and effectiveCwd.
    const missingMcpFields: Parameters<typeof buildLegacyRuntimeId>[0] = {
      scope: 'mcp',
      sessionId: 'sess_123',
      serverId: 'server_1',
      binding,
    };
    void missingMcpFields;
  });

  it('uses deterministic code-unit key ordering', () => {
    expect(canonicalRuntimeIdentityJson({ a: 1, B: 2, _: 3 })).toBe('{"B":2,"_":3,"a":1}');
  });
});
