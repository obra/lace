// ABOUTME: PRI-2012 B7.2 — round-trip tests for SpawnBrokerContainerRuntime, the
// ABOUTME: ContainerRuntime client that drives the broker over its unix socket.
// ABOUTME: Real broker server + real sockets; only docker (MockRuntime) is faked.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseContainerRuntime } from '../runtime';
import type {
  ContainerConfig,
  ContainerInfo,
  ExecResult,
  ExecStreamHandle,
  ExecStreamOptions,
} from '../types';
import { SpawnBrokerIdentity } from '../spawn-broker-identity';
import { SpawnBrokerServer } from '../spawn-broker-server';
import type { PersonaCatalog, PersonaName, BuiltPersonaSpawn } from '../spawn-broker-personas';
import { SpawnBrokerContainerRuntime } from '../spawn-broker-runtime';

// ── fake helper socket (records register_runtime, replies {ok:true}) ──────────
async function startFakeHelper(
  dir: string
): Promise<{ socketPath: string; close(): Promise<void> }> {
  const socketPath = join(dir, 'helper.sock');
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        buffer = buffer.slice(nl + 1);
        socket.write(`${JSON.stringify({ ok: true })}\n`);
        nl = buffer.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

// ── mock docker runtime (records calls; no real docker) ───────────────────────
class MockRuntime extends BaseContainerRuntime {
  readonly createdConfigs: ContainerConfig[] = [];
  lastExecOptions?: ExecStreamOptions;
  inspectResults = new Map<string, ContainerInfo | null>();

  create(config: ContainerConfig): string {
    this.createdConfigs.push(config);
    const id = config.id ?? config.name ?? 'mock';
    this.containers.set(config.name ?? id, { id, state: 'created', mounts: config.mounts });
    return config.name ?? id;
  }
  async start(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (info) info.state = 'running';
  }
  async stop(): Promise<void> {}
  async remove(): Promise<void> {}
  async exec(): Promise<ExecResult> {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  async execStream(_containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle> {
    this.lastExecOptions = options;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    queueMicrotask(() => {
      stdout.end('ok');
      stderr.end();
    });
    // Real docker resolves wait() only after stdio reaches EOF, so the exit
    // frame never races ahead of stdout. Model that ordering here.
    const ended = (s: PassThrough): Promise<void> =>
      new Promise((resolve) => s.once('end', () => resolve()));
    return {
      stdin: new PassThrough(),
      stdout,
      stderr,
      wait: async () => {
        await Promise.all([ended(stdout), ended(stderr)]);
        return { exitCode: 0 };
      },
      kill: () => {},
    };
  }
  override async daemonInspect(containerId: string): Promise<ContainerInfo | null> {
    if (this.inspectResults.has(containerId)) return this.inspectResults.get(containerId) ?? null;
    return this.containers.get(containerId) ?? { id: containerId, state: 'running' };
  }
  failInspectNetworkIp = false;
  async inspectNetworkIp(): Promise<string | undefined> {
    return '172.31.250.7';
  }
}

// ── fake catalog (returns a fixed spawn for a known persona) ──────────────────
class FakeCatalog implements PersonaCatalog {
  buildSpawn(persona: PersonaName, ctx: { childSessionId: string }): BuiltPersonaSpawn {
    const name = `parent8-${persona}-${ctx.childSessionId.slice(0, 8)}`;
    return {
      config: {
        id: `lace-${name}`,
        name,
        image: 'sen-x:dev',
        workingDirectory: '/work',
        mounts: [{ source: '/h/scratch', target: '/work', readonly: false }],
        environment: { NODE_EXTRA_CA_CERTS: '/etc/ca.pem' },
        network: 'quarantine',
        gatewayRoute: '172.31.250.2',
      },
      containerSharing: persona === 'persistent-box' ? 'persistent' : 'per_invocation',
      browserCdpSocket: persona === 'browser-driver',
    };
  }
}

function configFor(overrides: Partial<ContainerConfig> = {}): ContainerConfig {
  return {
    image: 'sen-x:dev',
    workingDirectory: '/work',
    mounts: [],
    persona: 'ephemeral-shell',
    parentSessionId: 'sess_parent00112233',
    childSessionId: 'sess_child00112233',
    ...overrides,
  };
}

const EXPECTED_NAME = 'parent8-ephemeral-shell-sess_chi';

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks).toString('utf8');
}

describe('SpawnBrokerContainerRuntime', () => {
  let dir: string;
  let helper: { socketPath: string; close(): Promise<void> };
  let docker: MockRuntime;
  let server: SpawnBrokerServer;
  let runtime: SpawnBrokerContainerRuntime;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'spawn-broker-runtime-'));
    helper = await startFakeHelper(dir);
    docker = new MockRuntime();
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });
    const socketPath = join(dir, 'broker.sock');
    server = new SpawnBrokerServer({
      runtime: docker,
      catalog: new FakeCatalog(),
      identity,
      socketPath,
    });
    await server.listen();
    runtime = new SpawnBrokerContainerRuntime({ socketPath });
  });

  afterEach(async () => {
    await server.close();
    await helper.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('create() spawns via the broker and returns the broker-derived name', async () => {
    const id = await runtime.create(configFor());
    expect(id).toBe(EXPECTED_NAME);
  });

  it('create() caches resolvedMounts so inspect + translate work locally', async () => {
    const id = await runtime.create(configFor());
    expect(runtime.inspect(id).state).toBe('running');
    expect(runtime.translateToContainer('/h/scratch/file.ts', id)).toBe('/work/file.ts');
  });

  it('create() rejects a config without a persona (broker only spawns personas)', async () => {
    await expect(runtime.create(configFor({ persona: undefined }))).rejects.toThrow(/persona/i);
  });

  it('create() rejects a config without a parentSessionId', async () => {
    await expect(runtime.create(configFor({ parentSessionId: undefined }))).rejects.toThrow(
      /parentSessionId/i
    );
  });

  // Persistent personas (e.g. persistent-box) carry NO childSessionId — the spec
  // builder intentionally omits it — but the broker protocol REQUIRES one. The
  // client substitutes parentSessionId (path-safe; ignored for persistent name
  // derivation broker-side). Without the stand-in, persistent-box bricks at spawn.
  it('create() spawns a persistent persona that carries no childSessionId (parentSessionId stand-in)', async () => {
    const id = await runtime.create(
      configFor({ persona: 'persistent-box', childSessionId: undefined })
    );
    // FakeCatalog derives the name from ctx.childSessionId.slice(0,8); the
    // stand-in is parentSessionId='sess_parent00112233' → 'sess_par'.
    expect(id).toBe('parent8-persistent-box-sess_par');
  });

  it('execStream() round-trips stdout + exit code through the broker', async () => {
    const id = await runtime.create(configFor());
    const handle = await runtime.execStream(id, { command: ['/bin/sh', '-c', 'echo hi'] });
    const out = await collect(handle.stdout);
    const { exitCode } = await handle.wait();
    expect(out).toBe('ok');
    expect(exitCode).toBe(0);
  });

  it('execStream() lets the broker strip a caller SEN_AGENT_TOKEN and inject its own', async () => {
    const id = await runtime.create(configFor());
    const brokerToken = docker.createdConfigs[0].environment?.SEN_AGENT_TOKEN;
    const handle = await runtime.execStream(id, {
      command: ['/bin/sh'],
      environment: { SEN_AGENT_TOKEN: 'attacker', FOO: 'bar' },
    });
    await handle.wait();
    expect(docker.lastExecOptions?.environment?.SEN_AGENT_TOKEN).toBe(brokerToken);
    expect(docker.lastExecOptions?.environment?.SEN_AGENT_TOKEN).not.toBe('attacker');
    expect(docker.lastExecOptions?.environment?.FOO).toBe('bar');
  });

  it('exec() drains execStream into a single ExecResult', async () => {
    const id = await runtime.create(configFor());
    const res = await runtime.exec(id, { command: ['/bin/sh', '-c', 'echo hi'] });
    expect(res.stdout).toBe('ok');
    expect(res.exitCode).toBe(0);
  });

  it('daemonInspect() reports the broker container state', async () => {
    const id = await runtime.create(configFor());
    const info = await runtime.daemonInspect(id);
    expect(info?.state).toBe('running');
  });

  it('stop() then remove() succeed; after remove the broker no longer owns it', async () => {
    const id = await runtime.create(configFor());
    await expect(runtime.stop(id)).resolves.toBeUndefined();
    await expect(runtime.remove(id)).resolves.toBeUndefined();
    // destroy dropped ownership → a broker-routed verb now fails.
    await expect(runtime.daemonInspect(id)).rejects.toThrow(/not a broker-owned container/);
  });

  it('list() returns the broker-owned containers', async () => {
    const id = await runtime.create(configFor());
    const list = await runtime.list();
    expect(list.map((c) => c.id)).toContain(id);
  });

  it('adopt() reattaches a label-stamped container via the broker', async () => {
    docker.inspectResults.set('persistent-box', {
      id: 'persistent-box',
      state: 'running',
      mounts: [{ source: '/h/box', target: '/work', readonly: false }],
      labels: {
        'sen.broker.persona': 'persistent-box',
        'sen.broker.parentSessionId': 'sess_parent',
        'sen.broker.childSessionId': 'sess_child',
        'sen.broker.jobId': 'job_1',
        'sen.broker.tokenFingerprint': 'a'.repeat(64),
      },
    });
    await expect(
      runtime.adopt(
        {
          name: 'persistent-box',
          id: 'persistent-box',
          image: '',
          workingDirectory: '/',
          mounts: [],
        },
        'running'
      )
    ).resolves.toBeUndefined();
    // now broker-owned → status works + mounts cached for translation
    expect((await runtime.daemonInspect('persistent-box'))?.state).toBe('running');
    expect(runtime.translateToContainer('/h/box/x', 'persistent-box')).toBe('/work/x');
  });
});
