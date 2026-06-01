// ABOUTME: Real-docker integration test for the spawn-broker path — drives a REAL
// ABOUTME: container end-to-end through SpawnBrokerContainerRuntime → SpawnBrokerServer
// ABOUTME: → real DockerContainerRuntime over real unix sockets. Skipped without docker.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { DockerContainerRuntime } from '../docker-container';
import { SpawnBrokerIdentity } from '../spawn-broker-identity';
import { SpawnBrokerServer } from '../spawn-broker-server';
import { SpawnBrokerContainerRuntime } from '../spawn-broker-runtime';
import type { PersonaCatalog, PersonaName, BuiltPersonaSpawn } from '../spawn-broker-personas';
import type { ContainerConfig } from '../types';

function hasDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

const DOCKER_AVAILABLE = hasDockerAvailable();
const TEST_IMAGE = process.env.LACE_DOCKER_TEST_IMAGE || 'alpine:3.19';

async function pullImageIfMissing(image: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile('docker', ['image', 'inspect', image], (err) => {
      if (!err) return resolve();
      execFile('docker', ['pull', image], { timeout: 120000 }, (pullErr) =>
        pullErr ? reject(pullErr) : resolve()
      );
    });
  });
}

function forceRemove(name: string): void {
  try {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 10000 });
  } catch {
    // already gone
  }
}

// Fake helper socket: records register_runtime requests, replies {ok:true}.
async function startFakeHelper(
  dir: string
): Promise<{ socketPath: string; requests: Record<string, unknown>[]; close(): Promise<void> }> {
  const socketPath = join(dir, 'helper.sock');
  const requests: Record<string, unknown>[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        requests.push(JSON.parse(buffer.slice(0, nl)) as Record<string, unknown>);
        buffer = buffer.slice(nl + 1);
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

// Catalog that builds a minimal real-docker spec (alpine + sleep so it stays up
// for exec). No network/gatewayRoute → the broker skips netns-init, so this needs
// no quarantine network. Stands in for BrokerPersonaCatalog (whose own real-spec
// drift is covered by the Component C on-box parity smoke, not unit tests).
class AlpineCatalog implements PersonaCatalog {
  constructor(
    private readonly scratchDir: string,
    private readonly names: string[]
  ) {}
  buildSpawn(persona: PersonaName, ctx: { childSessionId: string }): BuiltPersonaSpawn {
    const name = `bk-it-${persona}-${ctx.childSessionId}`.slice(0, 60);
    this.names.push(name);
    const config: ContainerConfig = {
      id: name,
      name,
      image: TEST_IMAGE,
      workingDirectory: '/work',
      mounts: [{ source: this.scratchDir, target: '/work', readonly: false }],
      command: ['sleep', '3600'],
    };
    return { config, containerSharing: 'per_invocation', browserCdpSocket: false };
  }
}

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks).toString('utf8');
}

describe.skipIf(!DOCKER_AVAILABLE)('SpawnBrokerContainerRuntime (real docker)', () => {
  let dir: string;
  let scratch: string;
  let helper: Awaited<ReturnType<typeof startFakeHelper>>;
  let docker: DockerContainerRuntime;
  let server: SpawnBrokerServer;
  let runtime: SpawnBrokerContainerRuntime;
  const createdNames: string[] = [];

  beforeAll(async () => {
    await pullImageIfMissing(TEST_IMAGE);
  }, 180000);

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'spawn-broker-it-'));
    scratch = join(dir, 'scratch');
    mkdirSync(scratch, { recursive: true });
    helper = await startFakeHelper(dir);
    docker = new DockerContainerRuntime();
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });
    const socketPath = join(dir, 'broker.sock');
    server = new SpawnBrokerServer({
      runtime: docker,
      catalog: new AlpineCatalog(scratch, createdNames),
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

  afterAll(() => {
    for (const name of createdNames) forceRemove(name);
  });

  function configFor(): ContainerConfig {
    const child = `c${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    return {
      image: 'ignored-by-broker',
      workingDirectory: '/x',
      mounts: [],
      persona: 'ephemeral-shell',
      parentSessionId: 'sess_parent',
      childSessionId: child,
    };
  }

  it('spawns a real container through the broker and reports it running', async () => {
    const name = await runtime.create(configFor());
    const info = await runtime.daemonInspect(name);
    expect(info?.state).toBe('running');
  });

  it('execs a real command end-to-end (stdout + exit code over real sockets)', async () => {
    const name = await runtime.create(configFor());
    const handle = await runtime.execStream(name, { command: ['echo', 'hello-broker'] });
    const out = await collect(handle.stdout);
    const { exitCode } = await handle.wait();
    expect(out.trim()).toBe('hello-broker');
    expect(exitCode).toBe(0);
  });

  it('round-trips stderr + a non-zero exit code through exec()', async () => {
    const name = await runtime.create(configFor());
    const res = await runtime.exec(name, {
      command: ['sh', '-c', 'echo out; echo err 1>&2; exit 3'],
    });
    expect(res.stdout.trim()).toBe('out');
    expect(res.stderr.trim()).toBe('err');
    expect(res.exitCode).toBe(3);
  });

  it('the broker injects its own SEN_AGENT_TOKEN and strips the caller-supplied one', async () => {
    const name = await runtime.create(configFor());
    const res = await runtime.exec(name, {
      command: ['sh', '-c', 'printf %s "$SEN_AGENT_TOKEN"'],
      environment: { SEN_AGENT_TOKEN: 'attacker-token' },
    });
    expect(res.stdout.length).toBeGreaterThan(0);
    expect(res.stdout).not.toBe('attacker-token');
    // The real container carries a broker-minted token (base64url) in its env.
    expect(res.stdout).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('stop() + remove() tear the real container down (broker drops ownership)', async () => {
    const name = await runtime.create(configFor());
    await runtime.stop(name);
    await runtime.remove(name);
    await expect(runtime.daemonInspect(name)).rejects.toThrow(/not a broker-owned container/);
    // and it is gone from docker
    let exists = true;
    try {
      execFileSync('docker', ['inspect', name], { stdio: 'ignore' });
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
