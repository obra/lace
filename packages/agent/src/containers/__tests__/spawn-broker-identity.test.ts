// ABOUTME: Tests for SpawnBrokerIdentity — the broker-owned per-container identity
// ABOUTME: lifecycle (mint/register/enrich/refresh/strip) over a REAL helper unix socket.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintContainerExecutionToken } from '../../jobs/container-execution-metadata';
import { SpawnBrokerIdentity } from '../spawn-broker-identity';

// A real newline-delimited-JSON unix-socket server matching the helper's
// register_runtime wire framing (sen-core admin-socket-client.ts): read one
// JSON line, reply with one JSON line ({ ok: true }). Records every request.
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
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const parsed = JSON.parse(line) as Record<string, unknown>;
        requests.push(parsed);
        socket.write(`${JSON.stringify({ ok: true })}\n`);
        newlineIndex = buffer.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

describe('SpawnBrokerIdentity', () => {
  let tempDir: string;
  let helper: FakeHelper;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'spawn-broker-identity-'));
    helper = await startFakeHelper(tempDir);
  });

  afterEach(async () => {
    await helper.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('registerAtSpawn mints a token and sends register_runtime with registry-truth persona', async () => {
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });

    const token = await identity.registerAtSpawn({
      persona: 'sen-coworker',
      parentSessionId: 'sess_parent',
      childSessionId: 'sess_child',
      jobId: 'job_1',
      containerName: 'sen-coworker-abc',
      containerSharing: 'persistent',
      containerId: 'cid_1',
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(helper.requests).toHaveLength(1);
    const req = helper.requests[0];
    expect(req.op).toBe('register_runtime');
    expect(req.persona).toBe('sen-coworker');
    expect(req.session_id).toBe('sess_parent');
    expect(req.job_id).toBe('job_1');
    expect(req.container_name).toBe('sen-coworker-abc');
    expect(req.container_id).toBe('cid_1');
    expect(req.container_sharing).toBe('persistent');
    expect(typeof req.expires_at_ms).toBe('number');
  });

  it('sends a token_fingerprint that equals fingerprintContainerExecutionToken(returnedToken)', async () => {
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });

    const token = await identity.registerAtSpawn({
      persona: 'sen-coworker',
      parentSessionId: 'sess_parent',
      childSessionId: 'sess_child',
      jobId: 'job_1',
      containerName: 'sen-coworker-abc',
      containerSharing: 'persistent',
    });

    expect(helper.requests[0].token_fingerprint).toBe(fingerprintContainerExecutionToken(token));
  });

  it('uses parentSessionId as the wire session_id (never childSessionId)', async () => {
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });
    await identity.registerAtSpawn({
      persona: 'sen-coworker',
      parentSessionId: 'sess_parent',
      childSessionId: 'sess_child',
      jobId: 'job_1',
      containerName: 'sen-coworker-abc',
      containerSharing: 'persistent',
    });
    expect(helper.requests[0].session_id).toBe('sess_parent');
    expect(helper.requests[0].session_id).not.toBe('sess_child');
  });

  it("registerAtSpawn's promise does not resolve until the server has received the request", async () => {
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });

    const registerPromise = identity.registerAtSpawn({
      persona: 'sen-coworker',
      parentSessionId: 'sess_parent',
      childSessionId: 'sess_child',
      jobId: 'job_1',
      containerName: 'sen-coworker-abc',
      containerSharing: 'persistent',
    });

    // The request must already be observed by the helper by the time the
    // returned promise resolves — so it is awaitable BEFORE container egress.
    await registerPromise;
    expect(helper.requests).toHaveLength(1);
  });

  it('enrichOnAttach re-sends the stored identity with source_ip', async () => {
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });
    const token = await identity.registerAtSpawn({
      persona: 'sen-coworker',
      parentSessionId: 'sess_parent',
      childSessionId: 'sess_child',
      jobId: 'job_1',
      containerName: 'sen-coworker-abc',
      containerSharing: 'persistent',
    });

    await identity.enrichOnAttach({ containerName: 'sen-coworker-abc', sourceIp: '10.0.0.5' });

    expect(helper.requests).toHaveLength(2);
    const enrich = helper.requests[1];
    expect(enrich.op).toBe('register_runtime');
    expect(enrich.source_ip).toBe('10.0.0.5');
    expect(enrich.token_fingerprint).toBe(fingerprintContainerExecutionToken(token));
    expect(enrich.persona).toBe('sen-coworker');
    expect(enrich.session_id).toBe('sess_parent');
  });

  it('enrichOnAttach includes browser_cdp_url for a browserCdpSocketPath persona', async () => {
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });
    await identity.registerAtSpawn({
      persona: 'sen-browser',
      parentSessionId: 'sess_parent',
      childSessionId: 'sess_child',
      jobId: 'job_1',
      containerName: 'sen-browser-xyz',
      containerSharing: 'per_invocation',
    });

    await identity.enrichOnAttach({
      containerName: 'sen-browser-xyz',
      sourceIp: '10.0.0.6',
      browserCdpSocketPath: '/run/sen/cdp/sen-browser-xyz.sock',
    });

    const enrich = helper.requests[1];
    expect(enrich.browser_cdp_url).toBe('unix:/run/sen/cdp/sen-browser-xyz.sock');
  });

  it('refreshOnExec re-sends with an updated job_id and a bumped expires_at_ms, reusing the same fingerprint', async () => {
    const baseNow = 1_000_000;
    let clock = baseNow;
    const identity = new SpawnBrokerIdentity({
      helperSocketPath: helper.socketPath,
      nowMs: () => clock,
    });
    const token = await identity.registerAtSpawn({
      persona: 'sen-coworker',
      parentSessionId: 'sess_parent',
      childSessionId: 'sess_child',
      jobId: 'job_1',
      containerName: 'sen-coworker-abc',
      containerSharing: 'persistent',
    });
    const spawnExpiry = helper.requests[0].expires_at_ms as number;

    clock = baseNow + 60_000;
    await identity.refreshOnExec({ containerName: 'sen-coworker-abc', jobId: 'job_2' });

    expect(helper.requests).toHaveLength(2);
    const refresh = helper.requests[1];
    expect(refresh.job_id).toBe('job_2');
    expect(refresh.token_fingerprint).toBe(fingerprintContainerExecutionToken(token));
    expect(refresh.expires_at_ms as number).toBeGreaterThan(spawnExpiry);
  });

  it('stripCallerToken removes SEN_AGENT_TOKEN and leaves other env intact', () => {
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });
    const stripped = identity.stripCallerToken({
      SEN_AGENT_TOKEN: 'attacker-supplied',
      PATH: '/usr/bin',
      HOME: '/root',
    });
    expect(stripped.SEN_AGENT_TOKEN).toBeUndefined();
    expect(stripped.PATH).toBe('/usr/bin');
    expect(stripped.HOME).toBe('/root');
  });

  it('stripCallerToken does not mutate the input env', () => {
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });
    const env = { SEN_AGENT_TOKEN: 'x', FOO: 'bar' };
    identity.stripCallerToken(env);
    expect(env.SEN_AGENT_TOKEN).toBe('x');
  });

  it('enrichOnAttach throws for an unknown container (no stored identity to re-assert)', async () => {
    const identity = new SpawnBrokerIdentity({ helperSocketPath: helper.socketPath });
    await expect(
      identity.enrichOnAttach({ containerName: 'never-registered', sourceIp: '10.0.0.9' })
    ).rejects.toThrow();
  });
});
