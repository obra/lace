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
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    });
  });

  it('accepts host runtime descriptor', () => {
    expect(
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_host' },
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
        toolRuntime: {
          type: 'container',
          cwd: '/workspace',
          spec: {
            name: 'proj',
            image: 'example/app:dev',
            workingDirectory: '/workspace',
            mounts: [],
          },
        },
      })
    ).toThrow(/unsupported runtime binding version/i);
  });

  it('rejects projected container binding without an image reference', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_container' },
        toolRuntime: {
          type: 'container',
          cwd: '/workspace',
          spec: {
            name: 'proj',
            workingDirectory: '/workspace',
            mounts: [],
          },
        },
      })
    ).toThrow(/image/i);
  });

  it('accepts projected container binding with a tag-only image reference', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_container_tag' },
        toolRuntime: {
          type: 'container',
          cwd: '/workspace',
          spec: {
            name: 'proj',
            image: 'sen-box:dev',
            workingDirectory: '/workspace',
            mounts: [],
          },
        },
      })
    ).not.toThrow();
  });

  it('accepts projected container binding with sysctls (PRI-1790)', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_container_sysctls' },
        toolRuntime: {
          type: 'container',
          cwd: '/work',
          spec: {
            name: 'sess1-browser-driver',
            image: 'sen-browser:dev',
            workingDirectory: '/work',
            mounts: [],
            sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' },
          },
        },
      })
    ).not.toThrow();
  });

  it('accepts projected container binding with capAdd (PRI-1919)', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_container_capadd' },
        toolRuntime: {
          type: 'container',
          cwd: '/work',
          spec: {
            name: 'sess1-box',
            image: 'sen-box:dev',
            workingDirectory: '/work',
            mounts: [],
            capAdd: ['NET_ADMIN'],
          },
        },
      })
    ).not.toThrow();
  });

  it('accepts projected container binding with network (PRI-1919)', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_container_network' },
        toolRuntime: {
          type: 'container',
          cwd: '/work',
          spec: {
            name: 'sess1-box',
            image: 'sen-box:dev',
            workingDirectory: '/work',
            mounts: [],
            network: 'quarantine',
          },
        },
      })
    ).not.toThrow();
  });

  it('accepts projected container binding with gatewayRoute (PRI-1919)', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_container_gateway' },
        toolRuntime: {
          type: 'container',
          cwd: '/work',
          spec: {
            name: 'sess1-box',
            image: 'sen-box:dev',
            workingDirectory: '/work',
            mounts: [],
            gatewayRoute: '172.31.250.1',
          },
        },
      })
    ).not.toThrow();
  });

  it('rejects legacy agentPlacement on runtime bindings', () => {
    expect(() =>
      parseRuntimeExecutionBinding({
        schemaVersion: 1,
        identity: { runtimeId: 'rt_legacy' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'host',
          cwd: '/repo',
        },
      })
    ).toThrow(/agentPlacement/i);
  });
});
