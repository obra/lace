// ABOUTME: Round-trip tests for the broker client transport against the REAL B5 server.
// ABOUTME: Real unix sockets end-to-end (no behavior-mocks): JSON verbs + the execStream
// ABOUTME: binary frame-bridge (stdin -> broker -> exec -> stdout) both directions.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseContainerRuntime } from '../runtime';
import type { ContainerConfig, ExecResult, ExecStreamHandle, ExecStreamOptions } from '../types';
import { SpawnBrokerIdentity } from '../spawn-broker-identity';
import { SpawnBrokerServer } from '../spawn-broker-server';
import type { PersonaCatalog, PersonaName, BuiltPersonaSpawn } from '../spawn-broker-personas';
import { brokerRequestJson, brokerExecStream } from '../spawn-broker-client';

async function startFakeHelper(socketPath: string): Promise<net.Server> {
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
  return server;
}

// MockRuntime whose execStream ECHOES stdin to stdout — so a client→server→exec→
// server→client round-trip is observable end-to-end through the frame protocol.
class EchoRuntime extends BaseContainerRuntime {
  create(config: ContainerConfig): string {
    const id = config.id ?? config.name ?? 'mock';
    this.containers.set(id, { id, state: 'created', mounts: config.mounts });
    return config.name ?? id;
  }
  async start(id: string): Promise<void> {
    const info = this.containers.get(id);
    if (info) info.state = 'running';
  }
  async stop(): Promise<void> {}
  async remove(): Promise<void> {}
  async exec(): Promise<ExecResult> {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  async execStream(_id: string, _options: ExecStreamOptions): Promise<ExecStreamHandle> {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdin.pipe(stdout); // echo
    return {
      stdin,
      stdout,
      stderr,
      wait: () =>
        new Promise<{ exitCode: number }>((resolve) =>
          stdin.once('finish', () => {
            stdout.end();
            resolve({ exitCode: 0 });
          })
        ),
      kill: () => {
        stdout.end();
        stderr.end();
      },
    };
  }
}

class FakeCatalog implements PersonaCatalog {
  buildSpawn(persona: PersonaName, ctx: { childSessionId: string }): BuiltPersonaSpawn {
    const name = `p8-${persona}-${ctx.childSessionId.slice(0, 8)}`;
    return {
      config: {
        id: `lace-${name}`,
        name,
        image: 'sen-x:dev',
        workingDirectory: '/work',
        mounts: [{ source: '/h/scratch', target: '/work', readonly: false }],
        environment: {},
        network: 'quarantine',
      },
      containerSharing: 'per_invocation',
      browserCdpSocket: false,
    };
  }
}

function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    stream.on('data', (c: Buffer) => (out += c.toString('utf8')));
    stream.on('end', () => resolve(out));
  });
}

describe('spawn-broker client transport (round-trip vs real server)', () => {
  let dir: string;
  let helper: net.Server;
  let server: SpawnBrokerServer;
  let socketPath: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'spawn-broker-client-'));
    const helperSocket = join(dir, 'helper.sock');
    helper = await startFakeHelper(helperSocket);
    socketPath = join(dir, 'broker.sock');
    server = new SpawnBrokerServer({
      runtime: new EchoRuntime(),
      catalog: new FakeCatalog(),
      identity: new SpawnBrokerIdentity({ helperSocketPath: helperSocket }),
      socketPath,
    });
    await server.listen();
  });

  afterEach(async () => {
    await server.close();
    await new Promise<void>((resolve) => helper.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  const SPAWN = {
    op: 'spawn',
    persona: 'ephemeral-shell',
    parentSessionId: 'sess_parent',
    childSessionId: 'sess_child0',
    jobId: 'job_1',
  };

  it('brokerRequestJson round-trips a spawn', async () => {
    const res = await brokerRequestJson(socketPath, SPAWN);
    expect(res.ok).toBe(true);
    expect(res.containerName).toBe('p8-ephemeral-shell-sess_chi');
  });

  it('brokerRequestJson surfaces a broker rejection (ownership)', async () => {
    const res = await brokerRequestJson(socketPath, { op: 'stop', containerName: 'not-owned' });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/not a broker-owned/);
  });

  it('brokerExecStream bridges stdin -> exec -> stdout end-to-end + resolves exit', async () => {
    const spawn = await brokerRequestJson(socketPath, SPAWN);
    const name = spawn.containerName as string;

    const handle = brokerExecStream(socketPath, {
      op: 'execStream',
      containerName: name,
      command: ['/bin/cat'],
      jobId: 'job_2',
    });

    const stdoutPromise = readAll(handle.stdout);
    handle.stdin.write('round-trip payload');
    handle.stdin.end();

    const { exitCode } = await handle.wait();
    expect(exitCode).toBe(0);
    expect(await stdoutPromise).toBe('round-trip payload');
  });

  it('brokerRequestJson stop then destroy on the spawned container', async () => {
    const spawn = await brokerRequestJson(socketPath, SPAWN);
    const name = spawn.containerName as string;
    expect((await brokerRequestJson(socketPath, { op: 'stop', containerName: name })).ok).toBe(
      true
    );
    expect((await brokerRequestJson(socketPath, { op: 'destroy', containerName: name })).ok).toBe(
      true
    );
  });
});
