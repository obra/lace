// ABOUTME: Real-docker integration tests for DockerContainerRuntime
// ABOUTME: Skipped unless `docker` is on PATH and the daemon is reachable

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execFile } from 'child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { DockerContainerRuntime } from '../docker-container';

function hasDockerAvailable(): boolean {
  try {
    // `docker version --format` against the daemon — exits non-zero if no daemon.
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
      if (!err) {
        resolve();
        return;
      }
      execFile('docker', ['pull', image], { timeout: 120000 }, (pullErr) => {
        if (pullErr) reject(pullErr);
        else resolve();
      });
    });
  });
}

describe.skipIf(!DOCKER_AVAILABLE)('DockerContainerRuntime Integration', () => {
  let runtime: DockerContainerRuntime;
  let testDir: string;
  let containerId: string;
  const createdContainers: string[] = [];

  beforeAll(async () => {
    await pullImageIfMissing(TEST_IMAGE);
    runtime = new DockerContainerRuntime(TEST_IMAGE);

    testDir = join(tmpdir(), `lace-docker-integration-${uuidv4()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'exec-test'), { recursive: true });

    containerId = await runtime.create({
      name: `it-${uuidv4().slice(0, 8)}`,
      workingDirectory: '/workspace',
      mounts: [{ source: testDir, target: '/workspace', readonly: false }],
      environment: { TEST_VAR: 'from_host' },
    });
    createdContainers.push(containerId);
    await runtime.start(containerId);
  }, 180000);

  afterAll(async () => {
    for (const id of createdContainers) {
      try {
        await runtime.stop(id, 2000);
      } catch {
        // ignore
      }
      try {
        await runtime.remove(id);
      } catch {
        // ignore
      }
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30000);

  it('runs a basic command and captures stdout', async () => {
    const result = await runtime.exec(containerId, { command: ['echo', 'hello'] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('mounts the host directory and sees host-written files', async () => {
    writeFileSync(join(testDir, 'exec-test', 'host.txt'), 'from host');
    const result = await runtime.exec(containerId, {
      command: ['cat', '/workspace/exec-test/host.txt'],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('from host');
  });

  it('writes from container land on the host bind mount', async () => {
    const result = await runtime.exec(containerId, {
      command: ['sh', '-c', 'echo "from container" > /workspace/exec-test/container.txt'],
    });
    expect(result.exitCode).toBe(0);
    const hostPath = join(testDir, 'exec-test', 'container.txt');
    expect(existsSync(hostPath)).toBe(true);
    expect(readFileSync(hostPath, 'utf-8').trim()).toBe('from container');
  });

  it('overrides environment per exec', async () => {
    const result = await runtime.exec(containerId, {
      command: ['sh', '-c', 'echo "$TEST_VAR"'],
      environment: { TEST_VAR: 'overridden' },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('overridden');
  });

  it('refreshState returns running state from the live daemon', async () => {
    const info = await runtime.refreshState(containerId);
    expect(info.id).toBe(containerId);
    expect(info.state).toBe('running');
  });

  it('list includes the container under the lace- prefix', async () => {
    const all = await runtime.list();
    const ids = all.map((c) => c.id);
    expect(ids).toContain(containerId);
  });

  it('execStream pipes stdin to stdout via cat', async () => {
    const handle = await runtime.execStream(containerId, { command: ['cat'] });
    let output = '';
    handle.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    handle.stdin.end('streamed-input\n');
    const { exitCode } = await handle.wait();
    expect(exitCode).toBe(0);
    expect(output.trim()).toBe('streamed-input');
  });

  it('rejects writes to readonly mounts', async () => {
    const roDir = join(testDir, 'ro-mount');
    mkdirSync(roDir, { recursive: true });
    const roId = await runtime.create({
      name: `ro-${uuidv4().slice(0, 8)}`,
      workingDirectory: '/ro',
      mounts: [{ source: roDir, target: '/ro', readonly: true }],
    });
    createdContainers.push(roId);
    await runtime.start(roId);

    const result = await runtime.exec(roId, {
      command: ['sh', '-c', 'echo blocked > /ro/blocked.txt'],
    });
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(join(roDir, 'blocked.txt'))).toBe(false);
  });
});
