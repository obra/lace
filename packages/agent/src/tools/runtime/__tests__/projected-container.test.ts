import { PassThrough, Readable } from 'node:stream';
import { access, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ContainerLifecycleHooks, ContainerSpec } from '../../../containers/spec';
import { ProjectedContainerToolRuntime } from '../projected-container';
import { InMemoryRuntimeSecretResolver } from '../secrets';

const { mockChildProcessSpawn } = vi.hoisted(() => ({
  mockChildProcessSpawn: vi.fn(() => {
    throw new Error('unexpected child_process.spawn');
  }),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: mockChildProcessSpawn,
  };
});

function createFakeExecStreamHandle() {
  return {
    stdin: new PassThrough(),
    stdout: Readable.from(['ok']),
    stderr: Readable.from([]),
    wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
    kill: vi.fn(),
  };
}

function createFakeContainerManager() {
  return {
    materialize: vi.fn().mockResolvedValue({
      spec: descriptor().spec,
      containerId: 'container_123',
      state: 'running' as const,
    }),
    execStream: vi.fn().mockResolvedValue(createFakeExecStreamHandle()),
  };
}

function descriptor() {
  return {
    spec: {
      name: 'projected-runtime',
      containerId: 'container_123',
      image: 'example/app@sha256:' + 'b'.repeat(64),
      workingDirectory: '/workspace',
      mounts: [
        {
          hostPath: '/host/repo',
          containerPath: '/workspace',
          readonly: false,
        },
      ],
    },
    cwd: '/workspace',
  };
}

function descriptorWithMount(input: { hostPath: string; readonly?: boolean }) {
  return {
    spec: {
      name: 'projected-runtime',
      containerId: 'container_123',
      image: 'example/app@sha256:' + 'b'.repeat(64),
      workingDirectory: '/workspace',
      mounts: [
        {
          hostPath: input.hostPath,
          containerPath: '/workspace',
          readonly: input.readonly ?? false,
        },
      ],
    },
    cwd: '/workspace',
  };
}

describe('ProjectedContainerToolRuntime', () => {
  it('maps mounted container paths back to host paths', async () => {
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: createFakeContainerManager(),
      descriptor: descriptor(),
    });

    await expect(runtime.paths.resolve('/workspace/src/app.ts')).resolves.toEqual({
      original: '/workspace/src/app.ts',
      runtimePath: '/workspace/src/app.ts',
      hostPath: '/host/repo/src/app.ts',
      displayPath: '/workspace/src/app.ts',
    });
  });

  it('starts processes through the container manager', async () => {
    const manager = createFakeContainerManager();
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: descriptor(),
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], {
      cwd: runtime.cwd,
      env: { FOO: 'bar' },
    });

    expect(manager.execStream).toHaveBeenCalledWith(
      'projected-runtime',
      expect.objectContaining({
        command: ['/bin/sh', '-lc', 'echo ok'],
        workingDirectory: '/workspace',
        environment: { FOO: 'bar' },
      })
    );
  });

  it('materializes the generic descriptor spec before process start with docker authority fields', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.env = { BASE: 'yes' };
    projectedDescriptor.spec.ports = [{ host: 7777, container: 7777 }];
    projectedDescriptor.spec.restartPolicy = 'unless-stopped';
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    expect(manager.materialize).toHaveBeenCalledWith({
      name: 'projected-runtime',
      containerId: 'container_123',
      image: projectedDescriptor.spec.image,
      workingDirectory: '/workspace',
      mounts: [{ source: '/host/repo', target: '/workspace', readonly: false }],
      env: { BASE: 'yes' },
      ports: [{ host: 7777, container: 7777 }],
      restartPolicy: 'unless-stopped',
    });
    const materializedSpec = manager.materialize.mock.calls[0][0];
    expect(materializedSpec.ports).toEqual([{ host: 7777, container: 7777 }]);
    expect(materializedSpec.restartPolicy).toBe('unless-stopped');
    expect(manager.materialize.mock.invocationCallOrder[0]).toBeLessThan(
      manager.execStream.mock.invocationCallOrder[0]
    );
  });

  it('threads generic descriptor sysctls into the materialized spec', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.sysctls = { 'net.ipv6.conf.lo.disable_ipv6': '0' };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    const materializedSpec = manager.materialize.mock.calls[0][0];
    expect(materializedSpec.sysctls).toEqual({ 'net.ipv6.conf.lo.disable_ipv6': '0' });
    expect(manager.materialize.mock.invocationCallOrder[0]).toBeLessThan(
      manager.execStream.mock.invocationCallOrder[0]
    );
  });

  it('threads generic descriptor capAdd into the materialized spec', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.capAdd = ['NET_ADMIN'];
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    const materializedSpec = manager.materialize.mock.calls[0][0];
    expect(materializedSpec.capAdd).toEqual(['NET_ADMIN']);
  });

  it('threads generic descriptor network into the materialized spec', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.network = 'quarantine';
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    const materializedSpec = manager.materialize.mock.calls[0][0];
    expect(materializedSpec.network).toBe('quarantine');
  });

  it('threads generic descriptor gatewayRoute into the materialized spec', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.gatewayRoute = '172.31.250.1';
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    const materializedSpec = manager.materialize.mock.calls[0][0];
    expect(materializedSpec.gatewayRoute).toBe('172.31.250.1');
  });

  it('rejects mixed selector and docker authority descriptor specs', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.persona = 'browser-driver';
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await expect(
      runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd })
    ).rejects.toThrow(/selector.*authority|authority.*selector/i);
    expect(manager.materialize).not.toHaveBeenCalled();
  });

  it('omits docker authority fields from selector-only persona specs', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    delete projectedDescriptor.spec.containerId;
    projectedDescriptor.spec.persona = 'browser-driver';
    projectedDescriptor.spec.parentSession = 'sess_parent_projected';
    projectedDescriptor.spec.childSession = 'sess_child_projected';
    projectedDescriptor.spec.jobId = 'job_projected';
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    const materializedSpec = manager.materialize.mock.calls[0][0];
    expect(materializedSpec).toMatchObject({
      persona: 'browser-driver',
      parentSession: 'sess_parent_projected',
      childSession: 'sess_child_projected',
      jobId: 'job_projected',
    });
    expect(materializedSpec.containerId).toBeUndefined();
    expect(materializedSpec.ports).toBeUndefined();
    expect(materializedSpec.restartPolicy).toBeUndefined();
    expect(materializedSpec.sysctls).toBeUndefined();
    expect(materializedSpec.capAdd).toBeUndefined();
    expect(materializedSpec.network).toBeUndefined();
    expect(materializedSpec.gatewayRoute).toBeUndefined();
  });

  it('does not shell out to docker inspect after materialization', async () => {
    mockChildProcessSpawn.mockClear();
    const manager = createFakeContainerManager();
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: descriptor(),
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    expect(mockChildProcessSpawn).not.toHaveBeenCalled();
  });

  it('does not import child_process for direct docker inspect shellouts', async () => {
    const source = await readFile(new URL('../projected-container.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('child_process');
  });

  it('mounts host-provided runtime helpers read-only when helper mode is mount', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = {
      ...descriptor(),
      helper: {
        mode: 'mount' as const,
        hostPath: '/host/lace-runtime-helper',
        containerPath: '/usr/local/bin/lace-runtime-helper',
        command: ['/usr/local/bin/lace-runtime-helper'],
      },
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    expect(manager.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        mounts: expect.arrayContaining([
          {
            source: '/host/lace-runtime-helper',
            target: '/usr/local/bin/lace-runtime-helper',
            readonly: true,
          },
        ]),
      })
    );
  });

  it('uses a stable mounted helper when adopting an existing persistent container', async () => {
    const helperPath = '/host/lace-runtime-helper.js';
    const projectedDescriptor = {
      ...descriptor(),
      spec: {
        ...descriptor().spec,
        name: 'box-shell',
        containerId: 'sen-box-shell',
        restartPolicy: 'unless-stopped' as const,
      },
      helper: {
        mode: 'mount' as const,
        hostPath: helperPath,
        containerPath: '/usr/local/bin/lace-runtime-helper.js',
        command: ['node', '/usr/local/bin/lace-runtime-helper.js'],
      },
    };
    const manager = createFakeContainerManager();
    manager.materialize.mockResolvedValueOnce({
      spec: {
        name: 'box-shell',
        containerId: 'sen-box-shell',
        image: projectedDescriptor.spec.image,
        workingDirectory: '/workspace',
        mounts: [
          { source: helperPath, target: '/usr/local/bin/lace-runtime-helper.js', readonly: true },
        ],
        restartPolicy: 'unless-stopped',
      },
      containerId: 'sen-box-shell',
      state: 'running',
    });
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_persistent',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.exec(['true']);

    expect(manager.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'box-shell',
        containerId: 'sen-box-shell',
        mounts: expect.arrayContaining([
          { source: helperPath, target: '/usr/local/bin/lace-runtime-helper.js', readonly: true },
        ]),
      })
    );
    const materializedSpec = manager.materialize.mock.calls[0][0];
    expect(materializedSpec.restartPolicy).toBe('unless-stopped');
  });

  it('copies host-provided runtime helpers before creating copy-mode containers', async () => {
    const helperRoot = await mkdtemp(join(tmpdir(), 'lace-helper-source-'));
    const helperPath = join(helperRoot, 'runtime-helper.js');
    await writeFile(helperPath, 'helper source', 'utf8');
    const projectedDescriptor = {
      ...descriptor(),
      helper: {
        mode: 'copy' as const,
        hostPath: helperPath,
        containerPath: '/usr/local/bin/lace-runtime-helper',
        command: ['/usr/local/bin/lace-runtime-helper'],
      },
    };
    const manager = {
      materialize: vi.fn(async (spec: ContainerSpec, hooks?: ContainerLifecycleHooks) => {
        await hooks?.beforeCreate?.();
        return {
          spec,
          containerId: 'container_123',
          state: 'running' as const,
        };
      }),
      execStream: vi.fn().mockResolvedValue(createFakeExecStreamHandle()),
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    const spec = manager.materialize.mock.calls[0][0];
    const helperMount = spec.mounts.find(
      (mount) => mount.target === '/usr/local/bin/lace-runtime-helper'
    );
    expect(helperMount).toBeDefined();
    expect(helperMount).toMatchObject({
      readonly: true,
      target: '/usr/local/bin/lace-runtime-helper',
    });
    expect(helperMount!.source).not.toBe(helperPath);
    await expect(readFile(helperMount!.source, 'utf8')).resolves.toBe('helper source');
  });

  it('merges resolved secret env into the materialized container spec', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.env = { BASE: 'yes' };
    projectedDescriptor.spec.secretEnv = {
      API_KEY: { namespace: 'project', name: 'api-key' },
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
      sessionId: 'sess_secret',
      secretResolver: new InMemoryRuntimeSecretResolver({
        'project:api-key': 'resolved-secret',
      }),
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    expect(manager.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { BASE: 'yes', API_KEY: 'resolved-secret' },
      })
    );
  });

  it('fails materialization with redacted secret context when no resolver is available', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.secretEnv = {
      API_KEY: { namespace: 'project', name: 'api-key' },
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
      sessionId: 'sess_secret',
    });

    await expect(
      runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd })
    ).rejects.toMatchObject({
      redactedReference: '[secret:project:REDACTED]',
      runtimeId: 'rt_container',
      sessionId: 'sess_secret',
    });
    expect(manager.materialize).not.toHaveBeenCalled();
  });

  it('passes the persona-declared image reference through to docker create verbatim', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.image = 'sen-box:dev';
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    expect(manager.materialize).toHaveBeenCalledWith(
      expect.objectContaining({ image: 'sen-box:dev' })
    );
  });

  it('honors replace-mode process env without descriptor env', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.env = { DESCRIPTOR_ONLY: 'hidden' };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], {
      cwd: runtime.cwd,
      env: { MCP_ONLY: 'visible' },
      envMode: 'replace',
    });

    expect(manager.execStream).toHaveBeenCalledWith(
      'projected-runtime',
      expect.objectContaining({
        environment: { MCP_ONLY: 'visible' },
        environmentMode: 'replace',
      })
    );
  });

  it('does not forward descriptor env as per-exec environment', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.env = {
      NODE_EXTRA_CA_CERTS: '/etc/ssl/proxy-ca.pem',
      HOME: '/home/sen',
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], {
      cwd: runtime.cwd,
      env: { TERM: 'xterm-256color' },
    });

    expect(manager.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        env: {
          NODE_EXTRA_CA_CERTS: '/etc/ssl/proxy-ca.pem',
          HOME: '/home/sen',
        },
      })
    );
    expect(manager.execStream).toHaveBeenCalledWith(
      'projected-runtime',
      expect.objectContaining({
        environment: { TERM: 'xterm-256color' },
        environmentMode: 'inherit',
      })
    );
  });

  it('forwards descriptor env as exec environment for selector-backed specs', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    delete projectedDescriptor.spec.containerId;
    projectedDescriptor.spec.persona = 'browser-driver';
    projectedDescriptor.spec.parentSessionId = 'sess_parent';
    projectedDescriptor.spec.childSessionId = 'sess_child';
    projectedDescriptor.spec.env = {
      SEN_AGENT_TOKEN: 'token',
      NODE_EXTRA_CA_CERTS: '/etc/sen-credential-proxy-ca/root.pem',
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], {
      cwd: runtime.cwd,
      env: { TERM: 'xterm-256color' },
    });

    expect(manager.execStream).toHaveBeenCalledWith(
      'projected-runtime',
      expect.objectContaining({
        environment: {
          SEN_AGENT_TOKEN: 'token',
          NODE_EXTRA_CA_CERTS: '/etc/sen-credential-proxy-ca/root.pem',
          TERM: 'xterm-256color',
        },
        environmentMode: 'inherit',
      })
    );
  });

  it('threads generic descriptor browserCdpSocket into the materialized spec', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.browserCdpSocket = true;
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    const materializedSpec = manager.materialize.mock.calls[0][0];
    expect(materializedSpec.browserCdpSocket).toBe(true);
  });

  it('kills the container process when aborted while execStream is starting', async () => {
    const containerHandle = createFakeExecStreamHandle();
    let resolveExecStream!: (handle: typeof containerHandle) => void;
    const execStreamPromise = new Promise<typeof containerHandle>((resolve) => {
      resolveExecStream = resolve;
    });
    const manager = {
      materialize: vi.fn().mockResolvedValue({
        spec: descriptor().spec,
        containerId: 'container_123',
        state: 'running' as const,
      }),
      execStream: vi.fn().mockReturnValue(execStreamPromise),
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: descriptor(),
    });
    const abortController = new AbortController();

    const startPromise = runtime.process.start(['/bin/sh', '-lc', 'echo ok'], {
      cwd: runtime.cwd,
      signal: abortController.signal,
    });

    await vi.waitFor(() =>
      expect(manager.execStream).toHaveBeenCalledWith(
        'projected-runtime',
        expect.objectContaining({
          command: ['/bin/sh', '-lc', 'echo ok'],
          workingDirectory: '/workspace',
        })
      )
    );

    abortController.abort();
    resolveExecStream(containerHandle);

    await expect(startPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(containerHandle.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects completion when aborted after the container process starts', async () => {
    let resolveWait!: (result: { exitCode: number }) => void;
    const wait = new Promise<{ exitCode: number }>((resolve) => {
      resolveWait = resolve;
    });
    const containerHandle = {
      ...createFakeExecStreamHandle(),
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      wait: vi.fn().mockReturnValue(wait),
      kill: vi.fn(() => resolveWait({ exitCode: 143 })),
    };
    const manager = {
      materialize: vi.fn().mockResolvedValue({
        spec: descriptor().spec,
        containerId: 'container_123',
        state: 'running' as const,
      }),
      execStream: vi.fn().mockResolvedValue(containerHandle),
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: descriptor(),
    });
    const abortController = new AbortController();

    const handle = await runtime.process.start(['/bin/sh', '-lc', 'sleep 60'], {
      cwd: runtime.cwd,
      signal: abortController.signal,
    });
    abortController.abort();

    await expect(handle.completion).rejects.toMatchObject({ name: 'AbortError' });
    expect(containerHandle.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects writes through readonly host mounts without mutating the host file', async () => {
    const hostRoot = await mkdtemp(join(tmpdir(), 'lace-projected-readonly-'));
    const hostFile = join(hostRoot, 'file.txt');
    await writeFile(hostFile, 'original', 'utf8');
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: createFakeContainerManager(),
      descriptor: descriptorWithMount({ hostPath: hostRoot, readonly: true }),
    });

    const path = await runtime.paths.resolve('/workspace/file.txt');

    await expect(runtime.fs.writeTextFile(path, 'updated')).rejects.toThrow(/read.?only/i);
    await expect(readFile(hostFile, 'utf8')).resolves.toBe('original');
  });

  it('rejects host fast-path reads through symlinks that escape the mount root', async () => {
    const hostRoot = await mkdtemp(join(tmpdir(), 'lace-projected-mount-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'lace-projected-outside-'));
    const outsideFile = join(outsideRoot, 'secret.txt');
    await writeFile(outsideFile, 'outside secret', 'utf8');
    await symlink(outsideFile, join(hostRoot, 'secret-link.txt'));
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: createFakeContainerManager(),
      descriptor: descriptorWithMount({ hostPath: hostRoot }),
    });

    const path = await runtime.paths.resolve('/workspace/secret-link.txt');

    await expect(runtime.fs.readTextFile(path)).rejects.toThrow(/outside.*mount/i);
  });

  it('rejects host fast-path writes through symlinked parents that escape the mount root', async () => {
    const hostRoot = await mkdtemp(join(tmpdir(), 'lace-projected-mount-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'lace-projected-outside-'));
    const outsideFile = join(outsideRoot, 'new.txt');
    await symlink(outsideRoot, join(hostRoot, 'outside-link'));
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: createFakeContainerManager(),
      descriptor: descriptorWithMount({ hostPath: hostRoot }),
    });

    const path = await runtime.paths.resolve('/workspace/outside-link/new.txt');

    await expect(runtime.fs.writeTextFile(path, 'leaked')).rejects.toThrow(/outside.*mount/i);
    await expect(access(outsideFile)).rejects.toThrow();
  });
});
