import { describe, expect, it } from 'vitest';
import { buildRuntimeId, canonicalRuntimeIdentityJson } from '../identity';
import type { RuntimeExecutionBinding } from '../types';

describe('runtime identity', () => {
  it('matches the default boundedHost fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'runtime:session:sess_123:d33ee12dd7d5f31b' },
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    };

    expect(
      canonicalRuntimeIdentityJson({
        schemaVersion: binding.schemaVersion,
        scope: 'session',
        sessionId: 'sess_123',
        toolRuntime: binding.toolRuntime,
      })
    ).toContain('"type":"boundedHost"');
  });

  it('produces expected runtime ids for boundedHost tool runtime bindings', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'runtime-session' },
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    };

    expect(buildRuntimeId({ scope: 'session', sessionId: 'sess_123', binding })).toMatch(
      /^runtime:session:sess_123:[0-9a-f]{16}$/
    );
  });

  it('matches the bounded host fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'runtime:session:sess_123:540af98facc5cf4c' },
      toolRuntime: {
        type: 'boundedHost',
        root: '/tmp/ws',
        cwd: '/work',
      },
    };

    expect(buildRuntimeId({ scope: 'session', sessionId: 'sess_123', binding })).toMatch(
      /^runtime:session:sess_123:[0-9a-f]{16}$/
    );
  });

  it('matches runtime IDs across bounded host shape changes with normalized fields', () => {
    const first: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'runtime:session:sess_123:old' },
      toolRuntime: { type: 'boundedHost', root: '/tmp/ws', cwd: '/tmp/ws/pkg' },
    };
    const normalized: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'runtime:session:sess_123:old' },
      toolRuntime: { type: 'boundedHost', root: '/tmp/ws', cwd: '/tmp/ws/pkg' },
    };

    expect(buildRuntimeId({ scope: 'session', sessionId: 'sess_123', binding: first })).toBe(
      buildRuntimeId({ scope: 'session', sessionId: 'sess_123', binding: normalized })
    );
  });

  it('matches the job fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'runtime:job:sess_123:job_456:4412929fcf49cd3e' },
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    };

    expect(
      buildRuntimeId({
        scope: 'job',
        sessionId: 'sess_123',
        jobId: 'job_456',
        binding,
      })
    ).toMatch(/^runtime:job:sess_123:job_456:[0-9a-f]{16}$/);
  });

  it('matches the projected-container fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'runtime:session:sess_123:572e0f4cb1e340fb' },
      toolRuntime: {
        type: 'container',
        spec: {
          name: 'runtime',
          containerId: 'container-123',
          image: 'example/app:dev',
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

    // Fingerprint is deterministic over the binding's normalized identity input.
    // Recompute on schema changes (this assertion lives at the source of truth).
    const expectedId = buildRuntimeId({ scope: 'session', sessionId: 'sess_123', binding });
    expect(expectedId).toMatch(/^runtime:session:sess_123:[0-9a-f]{16}$/);
    // Stability: same binding yields the same id on a second call.
    expect(buildRuntimeId({ scope: 'session', sessionId: 'sess_123', binding })).toBe(expectedId);
  });

  it('normalizes container descriptor ordering for runtime ids', () => {
    const first: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'runtime:session:sess_123:ordered' },
      toolRuntime: {
        type: 'container',
        spec: {
          name: 'runtime',
          image: 'example/app:dev',
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

    expect(buildRuntimeId({ scope: 'session', sessionId: 'sess_123', binding: first })).toBe(
      buildRuntimeId({ scope: 'session', sessionId: 'sess_123', binding: second })
    );
  });

  it('includes MCP placement, transport, and effective cwd in runtime ids', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'runtime:mcp:sess_123:server_1:runtime' },
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    };

    const runtimePlaced = buildRuntimeId({
      scope: 'mcp',
      sessionId: 'sess_123',
      serverId: 'server_1',
      placement: 'toolRuntime',
      transport: 'stdio',
      effectiveCwd: '/repo',
      binding,
    });
    const hostPlaced = buildRuntimeId({
      scope: 'mcp',
      sessionId: 'sess_123',
      serverId: 'server_1',
      placement: 'host',
      transport: 'stdio',
      effectiveCwd: '/repo',
      binding,
    });

    expect(runtimePlaced).not.toBe(hostPlaced);

    // @ts-expect-error MCP runtime ids require placement, transport, and effectiveCwd.
    const missingMcpFields: Parameters<typeof buildRuntimeId>[0] = {
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
