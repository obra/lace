// ABOUTME: Unit tests for DockerContainerRuntime with stubbed child_process
// ABOUTME: Verifies CLI command shaping, error paths, exec streaming wiring, inspect parse, and list filter

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

type Callback = (
  err: (Error & { code?: number | string; stderr?: string; stdout?: string }) | null,
  result?: { stdout: string; stderr: string }
) => void;

// Hoisted mocks so module-level `promisify(execFile)` captures them.
const { mockExecFile, mockSpawn, fakeChildren } = vi.hoisted(() => {
  type SpawnedChild = EventEmitter & {
    stdin: EventEmitter & { end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  const fakeChildren: SpawnedChild[] = [];
  const mockSpawn = vi.fn(() => {
    const child = new EventEmitter() as SpawnedChild;
    const stdin = new EventEmitter() as SpawnedChild['stdin'];
    stdin.end = vi.fn();
    stdin.write = vi.fn();
    child.stdin = stdin;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    fakeChildren.push(child);
    return child;
  });

  // Default implementation: success with empty stdout/stderr.
  const mockExecFile = vi.fn((...allArgs: unknown[]) => {
    const last = allArgs[allArgs.length - 1];
    if (typeof last === 'function') {
      (last as Callback)(null, { stdout: '', stderr: '' });
    }
  });

  return { mockExecFile, mockSpawn, fakeChildren };
});

vi.mock('child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

import { DockerContainerRuntime } from '../docker-container';
import { ContainerError, ContainerNotFoundError } from '../types';

function findCallWithSubcommand(sub: string): string[] | undefined {
  for (const call of mockExecFile.mock.calls) {
    const args = call[1] as string[];
    if (Array.isArray(args) && args[0] === sub) return args;
  }
  return undefined;
}

function setExecFileResponses(
  responses: Array<{
    match?: (args: string[]) => boolean;
    stdout?: string;
    stderr?: string;
    error?: Error & { code?: number | string; stderr?: string; stdout?: string };
  }>
) {
  let idx = 0;
  mockExecFile.mockImplementation((...allArgs: unknown[]) => {
    const args = allArgs[1] as string[];
    const last = allArgs[allArgs.length - 1] as Callback;

    let response = responses[idx];
    // If a matcher is present, prefer the first matching unconsumed response.
    if (response && response.match && !response.match(args)) {
      const matched = responses.find((r) => r.match && r.match(args));
      if (matched) response = matched;
    } else {
      idx = Math.min(idx + 1, responses.length - 1);
    }

    if (response?.error) {
      last(response.error);
      return;
    }
    last(null, { stdout: response?.stdout ?? '', stderr: response?.stderr ?? '' });
  });
}

describe('DockerContainerRuntime', () => {
  let runtime: DockerContainerRuntime;

  beforeEach(() => {
    mockExecFile.mockReset();
    mockSpawn.mockClear();
    fakeChildren.length = 0;
    // Restore default success behavior after reset.
    mockExecFile.mockImplementation((...allArgs: unknown[]) => {
      const last = allArgs[allArgs.length - 1] as Callback;
      last(null, { stdout: '', stderr: '' });
    });
    runtime = new DockerContainerRuntime();
  });

  describe('create', () => {
    it('issues docker create with --name lace- prefix, -v mounts, -e env, image, and sleep infinity', async () => {
      const id = await runtime.create({
        name: 'shell-agent',
        image: 'alpine:latest',
        workingDirectory: '/workspace',
        mounts: [
          { source: '/host/src', target: '/workspace', readonly: false },
          { source: '/host/identity', target: '/etc/identity', readonly: true },
        ],
        environment: { FOO: 'bar', BAZ: 'qux' },
      });

      expect(id).toBe('lace-shell-agent');
      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();
      expect(args![0]).toBe('create');
      expect(args).toContain('--name');
      expect(args).toContain('lace-shell-agent');
      expect(args).toContain('-w');
      expect(args).toContain('/workspace');
      expect(args).toContain('-v');
      expect(args).toContain('/host/src:/workspace');
      expect(args).toContain('/host/identity:/etc/identity:ro');
      expect(args).toContain('-e');
      expect(args).toContain('FOO=bar');
      expect(args).toContain('BAZ=qux');
      expect(args).toContain('alpine:latest');
      // image must come before the entrypoint command
      const imageIdx = args!.indexOf('alpine:latest');
      const sleepIdx = args!.indexOf('sleep');
      expect(sleepIdx).toBeGreaterThan(imageIdx);
      expect(args!.slice(sleepIdx)).toEqual(['sleep', 'infinity']);
    });

    it('preserves an existing lace- prefix without doubling it', async () => {
      const id = await runtime.create({
        name: 'lace-already-prefixed',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      expect(id).toBe('lace-already-prefixed');
    });

    it('uses config.id with uuid suffix when name is absent', async () => {
      const id = await runtime.create({
        id: 'persona-x',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      expect(id).toMatch(/^lace-persona-x-[a-f0-9]{8}$/);
    });

    it('generates an autoname when neither name nor id is provided', async () => {
      const id = await runtime.create({
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      expect(id).toMatch(/^lace-[a-f0-9]{8}$/);
    });

    it('rejects when docker is not on PATH (ENOENT)', async () => {
      setExecFileResponses([
        {
          error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }),
        },
      ]);

      await expect(
        runtime.create({ name: 'x', image: 'alpine:latest', workingDirectory: '/w', mounts: [] })
      ).rejects.toThrow(/docker CLI not found/);
    });

    it('rejects on name collision before shelling out', async () => {
      await runtime.create({
        name: 'dup',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await expect(
        runtime.create({ name: 'dup', image: 'alpine:latest', workingDirectory: '/w', mounts: [] })
      ).rejects.toThrow(/name already in use/);
    });

    it('uses config.image on the docker CLI rather than any runtime default (kata #53)', async () => {
      // Regression: previously DockerContainerRuntime carried a constructor default
      // image and ignored ContainerConfig.image, so persona images never ran.
      await runtime.create({
        name: 'persona',
        image: 'node:24-bookworm',
        workingDirectory: '/w',
        mounts: [],
      });

      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();
      expect(args).toContain('node:24-bookworm');
      // The image must immediately precede the entrypoint command.
      const imageIdx = args!.indexOf('node:24-bookworm');
      expect(args![imageIdx + 1]).toBe('sleep');
    });

    it('emits -p <host>:<container> for each spec.ports entry (kata #60)', async () => {
      await runtime.create({
        name: 'browser',
        image: 'sen-browser:dev',
        workingDirectory: '/w',
        mounts: [],
        ports: [
          { host: 7777, container: 7777 },
          { host: 6080, container: 6080 },
        ],
      });

      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();
      expect(args).toContain('-p');
      expect(args).toContain('7777:7777');
      expect(args).toContain('6080:6080');
      // Both -p flags must appear before the image (docker create arg order).
      const imageIdx = args!.indexOf('sen-browser:dev');
      for (const mapping of ['7777:7777', '6080:6080']) {
        expect(args!.indexOf(mapping)).toBeLessThan(imageIdx);
      }
    });

    it('emits no -p flags when ports is undefined or empty (kata #60)', async () => {
      await runtime.create({
        name: 'no-ports',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      expect(findCallWithSubcommand('create')).not.toContain('-p');

      mockExecFile.mockClear();
      await runtime.create({
        name: 'empty-ports',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
        ports: [],
      });
      expect(findCallWithSubcommand('create')).not.toContain('-p');
    });

    it('surfaces docker errors (e.g. image missing) as ContainerError', async () => {
      setExecFileResponses([
        {
          error: Object.assign(new Error('docker: Error response from daemon: No such image'), {
            code: 125,
            stderr: 'Unable to find image alpine:nope locally',
          }),
        },
      ]);

      await expect(
        runtime.create({
          name: 'bad-image',
          image: 'alpine:latest',
          workingDirectory: '/w',
          mounts: [],
        })
      ).rejects.toBeInstanceOf(ContainerError);
    });
  });

  describe('start / stop / remove', () => {
    it('start runs `docker start <id>` and marks running', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      mockExecFile.mockClear();
      await runtime.start(id);

      const startArgs = findCallWithSubcommand('start');
      expect(startArgs).toEqual(['start', id]);
    });

    it('start is idempotent when already running', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await runtime.start(id);
      mockExecFile.mockClear();
      await runtime.start(id);
      expect(findCallWithSubcommand('start')).toBeUndefined();
    });

    it('stop passes -t <seconds> and updates state to stopped', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await runtime.start(id);
      mockExecFile.mockClear();
      await runtime.stop(id, 5000);

      const stopArgs = findCallWithSubcommand('stop');
      expect(stopArgs).toEqual(['stop', '-t', '5', id]);
    });

    it('remove runs `docker rm -f <id>` and forgets the container locally', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      mockExecFile.mockClear();
      await runtime.remove(id);

      expect(findCallWithSubcommand('rm')).toEqual(['rm', '-f', id]);
      expect(() => runtime.inspect(id)).toThrow(ContainerNotFoundError);
    });

    it('remove cleans local state even if docker reports no-such-container', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });

      setExecFileResponses([
        {
          error: Object.assign(new Error('docker rm failed'), {
            code: 1,
            stderr: 'Error: No such container: ' + id,
          }),
        },
      ]);

      await runtime.remove(id);
      expect(() => runtime.inspect(id)).toThrow(ContainerNotFoundError);
    });

    it('start throws ContainerNotFoundError on unknown container id', async () => {
      await expect(runtime.start('lace-unknown')).rejects.toBeInstanceOf(ContainerNotFoundError);
    });

    it('stop and remove are idempotent when the in-process cache is empty', async () => {
      // After a parent restart, the cache is empty but the daemon still owns
      // the container. Destructive ops must go to the daemon so the startup
      // reaper can reach existing containers.
      await expect(runtime.stop('lace-unknown')).resolves.toBeUndefined();
      await expect(runtime.remove('lace-unknown')).resolves.toBeUndefined();
    });
  });

  describe('exec', () => {
    it('refuses to exec when container is not running', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await expect(runtime.exec(id, { command: ['ls'] })).rejects.toBeInstanceOf(ContainerError);
    });

    it('shapes args with -w, -e, container id, and command, and returns stdout/stderr/exitCode', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await runtime.start(id);

      setExecFileResponses([{ stdout: 'hi\n', stderr: '' }]);
      const result = await runtime.exec(id, {
        command: ['echo', 'hi'],
        workingDirectory: '/work',
        environment: { K: 'V' },
      });

      const execArgs = findCallWithSubcommand('exec');
      expect(execArgs).toBeDefined();
      expect(execArgs!.slice(0, 5)).toEqual(['exec', '-w', '/work', '-e', 'K=V']);
      expect(execArgs).toContain(id);
      expect(execArgs!.slice(-2)).toEqual(['echo', 'hi']);
      expect(result).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 });
    });

    it('wraps replace-mode commands with env -i instead of docker env flags', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await runtime.start(id);

      setExecFileResponses([{ stdout: '', stderr: '' }]);
      await runtime.exec(id, {
        command: ['printenv', 'HOST_SECRET'],
        environment: { MCP_ONLY: 'visible' },
        environmentMode: 'replace',
      });

      const execArgs = findCallWithSubcommand('exec');
      expect(execArgs).toBeDefined();
      expect(execArgs).not.toContain('-e');
      expect(execArgs!.slice(execArgs!.indexOf(id) + 1)).toEqual([
        'env',
        '-i',
        'MCP_ONLY=visible',
        'printenv',
        'HOST_SECRET',
      ]);
    });

    it('returns non-zero exitCode rather than throwing for failing commands', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await runtime.start(id);

      setExecFileResponses([
        {
          error: Object.assign(new Error('cmd failed'), {
            code: 2,
            stdout: 'partial',
            stderr: 'boom',
          }),
        },
      ]);

      const result = await runtime.exec(id, { command: ['false'] });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe('boom');
    });
  });

  describe('execStream', () => {
    it('spawns docker exec -i and wires stdin/stdout/stderr through the handle', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await runtime.start(id);

      const handle = await runtime.execStream(id, {
        command: ['cat'],
        workingDirectory: '/work',
        environment: { K: 'V' },
      });

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [bin, args] = mockSpawn.mock.calls[0] as [string, string[]];
      expect(bin).toBe('docker');
      expect(args[0]).toBe('exec');
      expect(args[1]).toBe('-i');
      expect(args).toContain('-w');
      expect(args).toContain('/work');
      expect(args).toContain('-e');
      expect(args).toContain('K=V');
      expect(args).toContain(id);
      expect(args[args.length - 1]).toBe('cat');

      const child = fakeChildren[0];
      expect(handle.stdin).toBe(child.stdin);
      expect(handle.stdout).toBe(child.stdout);
      expect(handle.stderr).toBe(child.stderr);

      // wait resolves on close
      const waitPromise = handle.wait();
      child.emit('close', 0, null);
      await expect(waitPromise).resolves.toEqual({ exitCode: 0 });

      handle.kill('SIGINT');
      expect(child.kill).toHaveBeenCalledWith('SIGINT');
    });

    it('wraps replace-mode stream commands with env -i instead of docker env flags', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await runtime.start(id);

      await runtime.execStream(id, {
        command: ['cat'],
        environment: { K: 'V' },
        environmentMode: 'replace',
      });

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
      expect(args).not.toContain('-e');
      expect(args.slice(args.indexOf(id) + 1)).toEqual(['env', '-i', 'K=V', 'cat']);
    });

    it('rejects when container is not running', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await expect(runtime.execStream(id, { command: ['ls'] })).rejects.toBeInstanceOf(
        ContainerError
      );
    });

    it('wait() returns the same settled promise across repeated calls (no listener leak)', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      await runtime.start(id);

      const handle = await runtime.execStream(id, { command: ['cat'] });
      const child = fakeChildren[0];

      const first = handle.wait();
      const second = handle.wait();
      expect(first).toBe(second);

      child.emit('close', 0, null);
      await expect(first).resolves.toEqual({ exitCode: 0 });
      await expect(handle.wait()).resolves.toEqual({ exitCode: 0 });
    });
  });

  describe('inspect (sync, cached)', () => {
    it('returns the cached ContainerInfo without shelling out', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      mockExecFile.mockClear();
      const info = runtime.inspect(id);
      expect(info.id).toBe(id);
      expect(info.state).toBe('created');
      expect(findCallWithSubcommand('inspect')).toBeUndefined();
    });
  });

  describe('refreshState', () => {
    it('parses docker inspect JSON into ContainerInfo and refreshes cached state', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });

      const payload = {
        Id: 'sha256:abc',
        Name: `/${id}`,
        State: {
          Status: 'running',
          Running: true,
          Pid: 4321,
          ExitCode: 0,
          StartedAt: '2026-05-18T10:00:00Z',
          FinishedAt: '0001-01-01T00:00:00Z',
        },
      };
      setExecFileResponses([{ stdout: JSON.stringify(payload), stderr: '' }]);

      const info = await runtime.refreshState(id);
      expect(info.id).toBe(id);
      expect(info.state).toBe('running');
      expect(info.pid).toBe(4321);
      expect(info.startedAt instanceof Date).toBe(true);
      expect(info.stoppedAt).toBeUndefined();

      const args = findCallWithSubcommand('inspect');
      expect(args).toEqual(['inspect', id, '--format', '{{json .}}']);

      // Cached state should now reflect the refresh.
      expect(runtime.inspect(id).state).toBe('running');
    });

    it('throws ContainerNotFoundError when docker reports no such container', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      setExecFileResponses([
        {
          error: Object.assign(new Error('inspect failed'), {
            code: 1,
            stderr: 'Error: No such object: ' + id,
          }),
        },
      ]);
      await expect(runtime.refreshState(id)).rejects.toBeInstanceOf(ContainerNotFoundError);
    });
  });

  describe('inspectNetworkIp', () => {
    it('returns the IPAddress for the named network', async () => {
      setExecFileResponses([
        {
          stdout: JSON.stringify({
            'ada-sen_quarantine': { IPAddress: '172.31.250.3' },
            bridge: { IPAddress: '172.17.0.5' },
          }),
        },
      ]);
      const ip = await runtime.inspectNetworkIp('sen-persistent-box', 'ada-sen_quarantine');
      expect(ip).toBe('172.31.250.3');
      const args = findCallWithSubcommand('inspect');
      expect(args).toEqual([
        'inspect',
        'sen-persistent-box',
        '--format',
        '{{json .NetworkSettings.Networks}}',
      ]);
    });

    it('returns undefined when the network is absent', async () => {
      setExecFileResponses([{ stdout: JSON.stringify({ bridge: { IPAddress: '172.17.0.5' } }) }]);
      const ip = await runtime.inspectNetworkIp('sen-persistent-box', 'ada-sen_quarantine');
      expect(ip).toBeUndefined();
    });

    it('returns undefined when docker inspect fails (degrade gracefully)', async () => {
      setExecFileResponses([
        {
          error: Object.assign(new Error('inspect failed'), {
            code: 1,
            stderr: 'Error: No such object',
          }),
        },
      ]);
      const ip = await runtime.inspectNetworkIp('missing', 'ada-sen_quarantine');
      expect(ip).toBeUndefined();
    });
  });

  describe('list', () => {
    it('passes --filter name=lace- to docker ps and parses NDJSON', async () => {
      const lines = [
        JSON.stringify({ ID: 'a', Names: 'lace-a', State: 'running' }),
        JSON.stringify({ ID: 'b', Names: 'lace-b', State: 'exited' }),
        '',
        JSON.stringify({ ID: 'c', Names: 'not-lace', State: 'running' }), // should be skipped
      ].join('\n');
      setExecFileResponses([{ stdout: lines, stderr: '' }]);

      const result = await runtime.list();
      const psArgs = findCallWithSubcommand('ps');
      expect(psArgs).toEqual(['ps', '-a', '--filter', 'name=lace-', '--format', '{{json .}}']);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'lace-a', state: 'running' });
      expect(result[1]).toEqual({ id: 'lace-b', state: 'stopped' });
    });

    it('list() filter excludes non-lace containers such as sen-box-shell (kata #62)', async () => {
      // The persistent container runtime intentionally lives outside the lace- namespace so the
      // startup reaper (which uses list()) never considers it for reaping.
      // The CLI itself returns whatever the daemon gives back; the filter is
      // both at the CLI (`--filter name=lace-`) and the JSON post-parse loop.
      const lines = [
        JSON.stringify({ ID: 'a', Names: 'lace-a', State: 'running' }),
        JSON.stringify({ ID: 'b', Names: 'sen-box-shell', State: 'running' }),
      ].join('\n');
      setExecFileResponses([{ stdout: lines, stderr: '' }]);

      const result = await runtime.list();

      expect(result.map((c) => c.id)).not.toContain('sen-box-shell');
      expect(result.map((c) => c.id)).toContain('lace-a');
    });

    it('falls back to cached containers when docker ps fails', async () => {
      const id = await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      setExecFileResponses([
        { error: Object.assign(new Error('docker daemon offline'), { code: 1 }) },
      ]);

      const result = await runtime.list();
      expect(result.map((c) => c.id)).toEqual([id]);
    });
  });

  describe('persistent container runtime: restart policy + verbatim id (kata #62)', () => {
    it('emits --restart=unless-stopped when config.restartPolicy set', async () => {
      await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
        restartPolicy: 'unless-stopped',
      });

      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();
      expect(args).toContain('--restart=unless-stopped');
    });

    it('emits no --restart flag when restartPolicy is absent', async () => {
      await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });

      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();
      const hasRestart = args!.some((a) => a.startsWith('--restart'));
      expect(hasRestart).toBe(false);
    });
  });

  describe('sysctls', () => {
    it('emits --sysctl key=value for each entry in config.sysctls', async () => {
      await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
        sysctls: {
          'net.ipv6.conf.lo.disable_ipv6': '0',
          'net.ipv4.ip_local_port_range': '9222 12111',
        },
      });

      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();
      // Each sysctl is emitted as a separate --sysctl flag with key=value.
      const sysctlFlags: string[] = [];
      for (let i = 0; i < args!.length; i++) {
        if (args![i] === '--sysctl' && i + 1 < args!.length) {
          sysctlFlags.push(args![i + 1]);
        }
      }
      expect(sysctlFlags).toEqual(
        expect.arrayContaining([
          'net.ipv6.conf.lo.disable_ipv6=0',
          'net.ipv4.ip_local_port_range=9222 12111',
        ])
      );
      expect(sysctlFlags).toHaveLength(2);
    });

    it('emits no --sysctl flag when sysctls is absent or empty', async () => {
      await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });

      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();
      expect(args!.some((a) => a === '--sysctl')).toBe(false);

      mockExecFile.mockClear();

      await runtime.create({
        name: 'svc2',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
        sysctls: {},
      });
      const args2 = findCallWithSubcommand('create');
      expect(args2).toBeDefined();
      expect(args2!.some((a) => a === '--sysctl')).toBe(false);
    });

    it('uses config.id verbatim (no lace- prefix) when id+name both set with distinct id', async () => {
      // This shape is produced by ContainerManager when spec.containerId is
      // present: id is the daemon-side identifier, name is the spec name.
      const id = await runtime.create({
        id: 'sen-box-shell',
        name: 'box-shell',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });

      expect(id).toBe('sen-box-shell');
      const args = findCallWithSubcommand('create');
      expect(args).toContain('--name');
      expect(args).toContain('sen-box-shell');
      // Must NOT have been auto-prefixed.
      expect(args).not.toContain('lace-sen-box-shell');
      expect(args).not.toContain('lace-box-shell');
    });

    it('still prefixes ids that lack the lace- prefix only when set via config.name', async () => {
      // Regression: making sure config.name path remains intact.
      const id = await runtime.create({
        name: 'persona-x',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      expect(id).toBe('lace-persona-x');
    });

    it('legacy: config.id alone (no name) still gets prefix + uuid suffix', async () => {
      // Regression check: the box verbatim path requires BOTH id and name
      // present; setting only id keeps the legacy auto-suffix behavior.
      const id = await runtime.create({
        id: 'persona-x',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });
      expect(id).toMatch(/^lace-persona-x-[a-f0-9]{8}$/);
    });
  });

  describe('capAdd + network', () => {
    it('emits --cap-add NET_ADMIN and --network quarantine when runtime sets them', async () => {
      await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
        capAdd: ['NET_ADMIN'],
        network: 'quarantine',
      });

      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();

      // Each capAdd is emitted as a separate --cap-add flag.
      const capAddFlags: string[] = [];
      for (let i = 0; i < args!.length; i++) {
        if (args![i] === '--cap-add' && i + 1 < args!.length) {
          capAddFlags.push(args![i + 1]);
        }
      }
      expect(capAddFlags).toEqual(['NET_ADMIN']);

      // --network is emitted once.
      const networkIdx = args!.indexOf('--network');
      expect(networkIdx).toBeGreaterThan(-1);
      expect(args![networkIdx + 1]).toBe('quarantine');

      // Both must appear before the image.
      const imageIdx = args!.indexOf('alpine:latest');
      expect(args!.indexOf('--cap-add')).toBeLessThan(imageIdx);
      expect(networkIdx).toBeLessThan(imageIdx);
    });

    it('emits no --cap-add or --network flags when absent', async () => {
      await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
      });

      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();
      expect(args!.some((a) => a === '--cap-add')).toBe(false);
      expect(args!.some((a) => a === '--network')).toBe(false);
      expect(args!.some((a) => a === '--dns')).toBe(false);
    });

    it('emits --dns <gatewayRoute> so a gateway-routed persona resolves via the broker', async () => {
      await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
        network: 'quarantine',
        gatewayRoute: '172.31.250.2',
      });

      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();
      const dnsIdx = args!.indexOf('--dns');
      expect(dnsIdx).toBeGreaterThan(-1);
      expect(args![dnsIdx + 1]).toBe('172.31.250.2');
      // Must appear before the image.
      expect(dnsIdx).toBeLessThan(args!.indexOf('alpine:latest'));
    });

    it('emits multiple --cap-add flags when capAdd has multiple entries', async () => {
      await runtime.create({
        name: 'svc',
        image: 'alpine:latest',
        workingDirectory: '/w',
        mounts: [],
        capAdd: ['NET_ADMIN', 'NET_RAW'],
      });

      const args = findCallWithSubcommand('create');
      expect(args).toBeDefined();
      const capAddFlags: string[] = [];
      for (let i = 0; i < args!.length; i++) {
        if (args![i] === '--cap-add' && i + 1 < args!.length) {
          capAddFlags.push(args![i + 1]);
        }
      }
      expect(capAddFlags).toEqual(expect.arrayContaining(['NET_ADMIN', 'NET_RAW']));
      expect(capAddFlags).toHaveLength(2);
    });
  });

  describe('gatewayRoute start/adopt behavior', () => {
    it('does not run an extra docker command after start when gatewayRoute is set', async () => {
      const id = await runtime.create({
        name: 'persona',
        image: 'sen-box:dev',
        workingDirectory: '/w',
        mounts: [],
        gatewayRoute: '172.31.250.1',
      });
      mockExecFile.mockClear();
      await runtime.start(id);

      expect(mockExecFile.mock.calls).toHaveLength(1);
      expect(mockExecFile.mock.calls[0]?.[1]).toEqual(['start', id]);
    });

    it('runs only docker start when gatewayRoute is absent', async () => {
      const id = await runtime.create({
        name: 'persona',
        image: 'sen-box:dev',
        workingDirectory: '/w',
        mounts: [],
      });
      mockExecFile.mockClear();
      await runtime.start(id);

      expect(mockExecFile.mock.calls).toHaveLength(1);
      expect((mockExecFile.mock.calls[0]?.[1] as string[])[0]).toBe('start');
    });
  });

  describe('daemonInspect (kata #62)', () => {
    it('shells out to docker inspect and returns parsed info without requiring cache', async () => {
      const payload = {
        Id: 'sha256:abc',
        Name: '/sen-box-shell',
        State: {
          Status: 'running',
          Running: true,
          Pid: 99,
          ExitCode: 0,
          StartedAt: '2026-05-19T10:00:00Z',
          FinishedAt: '0001-01-01T00:00:00Z',
        },
        Mounts: [
          {
            Source: '/host/skills',
            Destination: '/var/lace/skills/0',
            RW: false,
          },
        ],
      };
      setExecFileResponses([{ stdout: JSON.stringify(payload), stderr: '' }]);

      const info = await runtime.daemonInspect('sen-box-shell');
      expect(info).not.toBeNull();
      expect(info!.id).toBe('sen-box-shell');
      expect(info!.state).toBe('running');
      expect(info!.mounts).toEqual([
        { source: '/host/skills', target: '/var/lace/skills/0', readonly: true },
      ]);

      const args = findCallWithSubcommand('inspect');
      expect(args).toEqual(['inspect', 'sen-box-shell', '--format', '{{json .}}']);
    });

    it('returns null when docker reports no such container', async () => {
      setExecFileResponses([
        {
          error: Object.assign(new Error('inspect failed'), {
            code: 1,
            stderr: 'Error: No such object: sen-box-shell',
          }),
        },
      ]);

      const info = await runtime.daemonInspect('sen-box-shell');
      expect(info).toBeNull();
    });

    it('returns null when docker CLI is missing (ENOENT)', async () => {
      setExecFileResponses([
        { error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }) },
      ]);

      const info = await runtime.daemonInspect('sen-box-shell');
      expect(info).toBeNull();
    });
  });

  describe('adopt (kata #62)', () => {
    it('registers an existing container in cache so start/execStream see it', async () => {
      await runtime.adopt(
        {
          id: 'sen-box-shell',
          image: 'alpine:latest',
          workingDirectory: '/work',
          mounts: [{ source: '/host/work', target: '/work' }],
        },
        'running'
      );

      // Adopted container is now in the cache.
      const info = runtime.inspect('sen-box-shell');
      expect(info.id).toBe('sen-box-shell');
      expect(info.state).toBe('running');
    });

    it('throws when config.id is missing', async () => {
      await expect(
        runtime.adopt({ image: 'alpine:latest', workingDirectory: '/w', mounts: [] }, 'running')
      ).rejects.toThrow(/config.id/);
    });

    it('does not run an extra docker command when config.gatewayRoute is set', async () => {
      await runtime.adopt(
        {
          id: 'sen-box-shell',
          image: 'sen-box:dev',
          workingDirectory: '/work',
          mounts: [],
          gatewayRoute: '172.31.250.1',
        },
        'running'
      );

      expect(mockExecFile.mock.calls).toHaveLength(0);
    });

    it('does not run a docker command when gatewayRoute is absent on adopt', async () => {
      await runtime.adopt(
        {
          id: 'sen-box-shell',
          image: 'sen-box:dev',
          workingDirectory: '/work',
          mounts: [],
        },
        'running'
      );

      expect(mockExecFile.mock.calls).toHaveLength(0);
    });
  });
});
