// ABOUTME: Security tests for the spawn-broker server — the integration heart.
// ABOUTME: Real unix sockets (no behavior-mocks): proves register-before-egress,
// ABOUTME: token strip/inject, ownership-check on every verb, label-validated adopt.

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
  ContainerState,
  ExecResult,
  ExecStreamHandle,
  ExecStreamOptions,
} from '../types';
import { SpawnBrokerIdentity } from '../spawn-broker-identity';
import { SpawnBrokerServer } from '../spawn-broker-server';
import type { PersonaCatalog, PersonaName, BuiltPersonaSpawn } from '../spawn-broker-personas';
import { fingerprintContainerExecutionToken } from '../../jobs/container-execution-metadata';

// A shared chronological event log so tests can assert ORDERING across the
// helper (register) and the runtime (create/start) — the register-before-egress
// property is "register recorded before create recorded".
let events: string[] = [];

// ── fake helper socket (records register_runtime, replies {ok:true}) ──────────
interface FakeHelper {
  socketPath: string;
  requests: Record<string, unknown>[];
  close(): Promise<void>;
}
async function startFakeHelper(dir: string): Promise<FakeHelper> {
  const socketPath = join(dir, 'helper.sock');
  const requests: Record<string, unknown>[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        requests.push(JSON.parse(line) as Record<string, unknown>);
        events.push('register');
        socket.write(`${JSON.stringify({ ok: true })}\n`);
        nl = buffer.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

// ── mock container runtime (records calls; no real docker) ────────────────────
class MockRuntime extends BaseContainerRuntime {
  readonly createdConfigs: ContainerConfig[] = [];
  lastExecOptions?: ExecStreamOptions;
  // Configurable daemonInspect result, keyed by container name (for adopt tests).
  inspectResults = new Map<string, ContainerInfo | null>();

  create(config: ContainerConfig): string {
    events.push('create');
    this.createdConfigs.push(config);
    const id = config.id ?? config.name ?? 'mock';
    this.containers.set(id, { id, state: 'created', mounts: config.mounts });
    return config.name ?? id;
  }
  async start(containerId: string): Promise<void> {
    events.push('start');
    const info = this.containers.get(containerId);
    if (info) info.state = 'running';
  }
  async stop(containerId: string): Promise<void> {
    events.push(`stop:${containerId}`);
  }
  async remove(containerId: string): Promise<void> {
    events.push(`remove:${containerId}`);
  }
  async exec(): Promise<ExecResult> {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  async execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle> {
    events.push(`execStream:${containerId}`);
    this.lastExecOptions = options;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    queueMicrotask(() => {
      stdout.end('ok');
      stderr.end();
    });
    return {
      stdin,
      stdout,
      stderr,
      wait: () => Promise.resolve({ exitCode: 0 }),
      kill: () => {},
    };
  }
  override async daemonInspect(containerId: string): Promise<ContainerInfo | null> {
    if (this.inspectResults.has(containerId)) return this.inspectResults.get(containerId) ?? null;
    const info = this.containers.get(containerId);
    return info ?? { id: containerId, state: 'running' };
  }
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

// ── test client over the broker socket ────────────────────────────────────────
function sendControl(socketPath: string, obj: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(obj)}\n`));
    socket.on('data', (c: string) => {
      buf += c;
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        socket.end();
        resolve(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>);
      }
    });
    socket.on('error', reject);
  });
}

const VALID_SPAWN = {
  op: 'spawn' as const,
  persona: 'ephemeral-shell' as const,
  parentSessionId: 'sess_parent00112233',
  childSessionId: 'sess_child00112233',
  jobId: 'job_1',
};

describe('SpawnBrokerServer', () => {
  let dir: string;
  let helper: FakeHelper;
  let runtime: MockRuntime;
  let identity: SpawnBrokerIdentity;
  let server: SpawnBrokerServer;
  let socketPath: string;

  beforeEach(async () => {
    events = [];
    dir = mkdtempSync(join(tmpdir(), 'spawn-broker-server-'));
    helper = await startFakeHelper(dir);
    runtime = new MockRuntime();
    identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });
    socketPath = join(dir, 'broker.sock');
    server = new SpawnBrokerServer({ runtime, catalog: new FakeCatalog(), identity, socketPath });
    await server.listen();
  });

  afterEach(async () => {
    await server.close();
    await helper.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('spawn', () => {
    it('registers BEFORE create/start (register-before-egress)', async () => {
      await sendControl(socketPath, VALID_SPAWN);
      const registerIdx = events.indexOf('register');
      const createIdx = events.indexOf('create');
      const startIdx = events.indexOf('start');
      expect(registerIdx).toBeGreaterThanOrEqual(0);
      expect(registerIdx).toBeLessThan(createIdx);
      expect(createIdx).toBeLessThan(startIdx);
    });

    it('stamps the broker token + sen.broker.* labels into the created config', async () => {
      await sendControl(socketPath, VALID_SPAWN);
      const config = runtime.createdConfigs[0];
      expect(config.environment?.SEN_AGENT_TOKEN).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(config.labels?.['sen.broker.persona']).toBe('ephemeral-shell');
      expect(config.labels?.['sen.broker.parentSessionId']).toBe(VALID_SPAWN.parentSessionId);
      expect(config.labels?.['sen.broker.childSessionId']).toBe(VALID_SPAWN.childSessionId);
      expect(config.labels?.['sen.broker.jobId']).toBe('job_1');
      // fingerprint label == sha256 of the injected token (cross-side identity)
      expect(config.labels?.['sen.broker.tokenFingerprint']).toBe(
        fingerprintContainerExecutionToken(config.environment!.SEN_AGENT_TOKEN!)
      );
    });

    it('registers the registry-truth persona (never a caller field)', async () => {
      await sendControl(socketPath, VALID_SPAWN);
      expect(helper.requests[0].persona).toBe('ephemeral-shell');
      expect(helper.requests[0].op).toBe('register_runtime');
    });

    it('responds with the derived containerName + resolvedMounts', async () => {
      const res = await sendControl(socketPath, VALID_SPAWN);
      expect(res.ok).toBe(true);
      expect(res.containerName).toBe('parent8-ephemeral-shell-sess_chi');
      expect(res.resolvedMounts).toEqual([
        { source: '/h/scratch', target: '/work', readonly: false },
      ]);
    });
  });

  describe('ownership enforcement (every non-spawn verb)', () => {
    it('rejects execStream into an unowned container', async () => {
      const res = await sendControl(socketPath, {
        op: 'execStream',
        containerName: 'sen-credential-helper',
        command: ['/bin/sh'],
      });
      expect(res.ok).toBe(false);
      expect(String(res.error)).toMatch(/not a broker-owned container/);
    });

    it.each(['stop', 'destroy', 'status'])('rejects %s into an unowned container', async (op) => {
      const res = await sendControl(socketPath, { op, containerName: 'sen-credential-helper' });
      expect(res.ok).toBe(false);
      expect(String(res.error)).toMatch(/not a broker-owned container/);
    });

    it('allows stop/destroy on an owned container after spawn', async () => {
      const spawn = await sendControl(socketPath, VALID_SPAWN);
      const name = spawn.containerName as string;
      expect((await sendControl(socketPath, { op: 'stop', containerName: name })).ok).toBe(true);
      expect((await sendControl(socketPath, { op: 'destroy', containerName: name })).ok).toBe(true);
      // destroy drops ownership → a second stop is now rejected.
      expect((await sendControl(socketPath, { op: 'stop', containerName: name })).ok).toBe(false);
    });
  });

  describe('execStream identity', () => {
    it('strips a caller-supplied SEN_AGENT_TOKEN and injects the broker token', async () => {
      const spawn = await sendControl(socketPath, VALID_SPAWN);
      const name = spawn.containerName as string;
      const brokerToken = runtime.createdConfigs[0].environment!.SEN_AGENT_TOKEN;

      // execStream is a streaming verb; drive it directly so we can inspect the
      // options the runtime received.
      await new Promise<void>((resolve) => {
        const socket = net.createConnection(socketPath);
        socket.on('connect', () => {
          socket.write(
            `${JSON.stringify({
              op: 'execStream',
              containerName: name,
              command: ['/bin/sh', '-c', 'echo hi'],
              environment: { SEN_AGENT_TOKEN: 'attacker', FOO: 'bar' },
              jobId: 'job_2',
            })}\n`
          );
        });
        socket.on('data', () => {});
        socket.on('close', () => resolve());
        setTimeout(() => {
          socket.end();
          resolve();
        }, 100);
      });

      expect(runtime.lastExecOptions?.environment?.SEN_AGENT_TOKEN).toBe(brokerToken);
      expect(runtime.lastExecOptions?.environment?.SEN_AGENT_TOKEN).not.toBe('attacker');
      expect(runtime.lastExecOptions?.environment?.FOO).toBe('bar');
      // refresh re-registered with the threaded jobId
      const refresh = helper.requests[helper.requests.length - 1];
      expect(refresh.job_id).toBe('job_2');
    });
  });

  describe('adopt (label-validated)', () => {
    function inspectWithLabels(name: string, labels: Record<string, string>): void {
      runtime.inspectResults.set(name, { id: name, state: 'running', mounts: [], labels });
    }
    const goodFp = 'a'.repeat(64);
    const goodLabels = {
      'sen.broker.persona': 'persistent-box',
      'sen.broker.parentSessionId': 'sess_parent',
      'sen.broker.childSessionId': 'sess_child',
      'sen.broker.jobId': 'job_1',
      'sen.broker.tokenFingerprint': goodFp,
    };

    it('adopts a container with valid sen.broker.* labels + re-registers from them', async () => {
      inspectWithLabels('persistent-box', goodLabels);
      const res = await sendControl(socketPath, { op: 'adopt', containerName: 'persistent-box' });
      expect(res.ok).toBe(true);
      // re-registered with the fingerprint recovered from the label
      const reg = helper.requests[helper.requests.length - 1];
      expect(reg.op).toBe('register_runtime');
      expect(reg.token_fingerprint).toBe(goodFp);
      expect(reg.persona).toBe('persistent-box');
      // now owned → ownership-gated verbs work
      expect(
        (await sendControl(socketPath, { op: 'stop', containerName: 'persistent-box' })).ok
      ).toBe(true);
    });

    it('rejects a container whose persona label is not a known persona (e.g. the helper)', async () => {
      inspectWithLabels('sen-credential-helper', {
        ...goodLabels,
        'sen.broker.persona': 'sen-credential-helper',
      });
      const res = await sendControl(socketPath, {
        op: 'adopt',
        containerName: 'sen-credential-helper',
      });
      expect(res.ok).toBe(false);
      expect(String(res.error)).toMatch(/not a known persona/);
    });

    it('rejects a container missing the sen.broker.* labels (foreign container)', async () => {
      inspectWithLabels('random', { 'com.docker.something': 'x' });
      const res = await sendControl(socketPath, { op: 'adopt', containerName: 'random' });
      expect(res.ok).toBe(false);
      expect(String(res.error)).toMatch(/missing sen\.broker/);
    });

    it('rejects a path-unsafe session-id label', async () => {
      inspectWithLabels('evil', { ...goodLabels, 'sen.broker.childSessionId': '../../etc' });
      const res = await sendControl(socketPath, { op: 'adopt', containerName: 'evil' });
      expect(res.ok).toBe(false);
      expect(String(res.error)).toMatch(/unsafe session id/);
    });

    it('rejects a malformed tokenFingerprint label', async () => {
      inspectWithLabels('evil2', { ...goodLabels, 'sen.broker.tokenFingerprint': 'nothex' });
      const res = await sendControl(socketPath, { op: 'adopt', containerName: 'evil2' });
      expect(res.ok).toBe(false);
      expect(String(res.error)).toMatch(/tokenFingerprint/);
    });
  });

  describe('protocol errors', () => {
    it('rejects a spawn carrying a spec field (closed surface)', async () => {
      const res = await sendControl(socketPath, { ...VALID_SPAWN, image: 'evil:latest' });
      expect(res.ok).toBe(false);
    });
  });
});
