import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SupervisorAgentProcess } from '../supervisor-agent-process';
import { Supervisor } from '../supervisor';

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const guard = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
  });

  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

describe('SupervisorAgentProcess (E2E)', () => {
  let laceDir: string;
  let workDir: string;
  let supervisor: SupervisorAgentProcess | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-supervisor-e2e-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-supervisor-e2e-wd-'));
  });

  afterEach(async () => {
    if (supervisor) {
      await supervisor.shutdown();
      supervisor = undefined;
    }

    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('spawns an agent process and handles permission requests', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const permissionRequests: Array<Record<string, unknown>> = [];

    supervisor = new SupervisorAgentProcess({
      laceDir,
      onSessionUpdate: (u) => updates.push(u),
      onPermissionRequest: async (params) => {
        permissionRequests.push(params);
        return { decision: 'allow' };
      },
    });

    await withTimeout(
      supervisor.peer.request('initialize', {
        protocolVersion: '1.0',
        config: { approvalMode: 'ask' },
      }),
      2_000,
      'initialize'
    );
    await withTimeout(supervisor.peer.request('session/new', { workDir }), 2_000, 'session/new');

    await withTimeout(
      supervisor.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'run: echo hi' }],
      }),
      10_000,
      'session/prompt'
    );

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const done = updates.find((u) => u.type === 'tool_use' && u.status === 'completed');
          if (done) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'tool_use completed update'
    );

    expect(permissionRequests[0]).toMatchObject({
      tool: 'shell.exec',
      resource: 'echo hi',
      toolCallId: expect.any(String),
    });
  });
});

describe('Supervisor (E2E)', () => {
  let laceDir: string;
  let workDir: string;
  let supervisor: Supervisor | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-supervisor2-e2e-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-supervisor2-e2e-wd-'));
  });

  afterEach(async () => {
    if (supervisor) {
      await supervisor.shutdown();
      supervisor = undefined;
    }

    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('runs two workspace sessions as two agent processes', async () => {
    const updates: Array<{ workspaceSessionId: string; update: Record<string, unknown> }> = [];
    const permissionRequests: Array<{
      workspaceSessionId: string;
      params: Record<string, unknown>;
    }> = [];

    supervisor = new Supervisor({
      laceDir,
      onSessionUpdate: (workspaceSessionId, update) => updates.push({ workspaceSessionId, update }),
      onPermissionRequest: async (workspaceSessionId, params) => {
        permissionRequests.push({ workspaceSessionId, params });
        return { decision: 'allow' };
      },
    });

    const a = await supervisor.createWorkspaceSession(workDir);
    const b = await supervisor.createWorkspaceSession(workDir);

    expect(a.workspaceSessionId).not.toBe(b.workspaceSessionId);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.pid).not.toBe(b.pid);

    await withTimeout(
      supervisor.prompt(a.workspaceSessionId, [{ type: 'text', text: 'run: echo a' }]),
      10_000,
      'prompt (a)'
    );
    await withTimeout(
      supervisor.prompt(b.workspaceSessionId, [{ type: 'text', text: 'run: echo b' }]),
      10_000,
      'prompt (b)'
    );

    expect(permissionRequests.map((r) => r.workspaceSessionId).sort()).toEqual([
      a.workspaceSessionId,
      b.workspaceSessionId,
    ]);

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const doneA = updates.find(
            (u) =>
              u.workspaceSessionId === a.workspaceSessionId &&
              u.update.type === 'tool_use' &&
              u.update.status === 'completed'
          );
          const doneB = updates.find(
            (u) =>
              u.workspaceSessionId === b.workspaceSessionId &&
              u.update.type === 'tool_use' &&
              u.update.status === 'completed'
          );
          if (doneA && doneB) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'tool_use completed updates'
    );
  });

  it('can attach to an existing sessionId and read durable events', async () => {
    const originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';

    supervisor = new Supervisor({
      laceDir,
      onPermissionRequest: async () => ({ decision: 'allow' }),
    });

    try {
      const created = await supervisor.createWorkspaceSession(workDir);
      await withTimeout(
        supervisor.prompt(created.workspaceSessionId, [{ type: 'text', text: 'hi' }]),
        5_000,
        'prompt (created)'
      );

      await supervisor.shutdown();
      supervisor = undefined;

      supervisor = new Supervisor({
        laceDir,
        onPermissionRequest: async () => ({ decision: 'allow' }),
      });

      const attached = await supervisor.attachWorkspaceSession(created.sessionId);
      const events = (await withTimeout(
        supervisor.getPeer(attached.workspaceSessionId).request('ent/session/events', {
          afterEventSeq: 0,
          limit: 100,
        }),
        2_000,
        'ent/session/events (attached)'
      )) as { events: Array<{ type: string; eventSeq: number }>; hasMore: boolean };

      expect(events.events.map((e) => e.type)).toEqual([
        'prompt',
        'turn_start',
        'message',
        'turn_end',
      ]);
      expect(events.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4]);
    } finally {
      if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
      else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;
    }
  });

  it('surfaces provider config and jobs via Supervisor wrappers', async () => {
    const updates: Array<{ workspaceSessionId: string; update: Record<string, unknown> }> = [];

    supervisor = new Supervisor({
      laceDir,
      onSessionUpdate: (workspaceSessionId, update) => updates.push({ workspaceSessionId, update }),
      onPermissionRequest: async () => ({ decision: 'allow' }),
    });

    const ws = await supervisor.createWorkspaceSession(workDir);

    const providers = await withTimeout(
      supervisor.listProviders(ws.workspaceSessionId),
      2_000,
      'providers/list'
    );
    expect(providers.providers.length).toBeGreaterThan(0);

    const providerId =
      providers.providers.find((p) => p.providerId === 'openai')?.providerId ??
      providers.providers[0].providerId;

    const createdConn = await withTimeout(
      supervisor.upsertConnection(ws.workspaceSessionId, {
        providerId,
        connection: { name: 'E2E Connection', config: {} },
      }),
      2_000,
      'connections/upsert'
    );
    expect(createdConn).toMatchObject({
      providerId,
      created: true,
      connectionId: expect.any(String),
    });

    const connections = await withTimeout(
      supervisor.listConnections(ws.workspaceSessionId),
      2_000,
      'connections/list'
    );
    expect(
      connections.connections.find((c) => c.connectionId === createdConn.connectionId)
    ).toMatchObject({
      credentialState: 'missing',
    });

    const creds = await withTimeout(
      supervisor.connectionCredentialSubmit(ws.workspaceSessionId, {
        connectionId: createdConn.connectionId,
        values: { apiKey: 'sk-supervisor-e2e' },
      }),
      2_000,
      'credentials/submit'
    );
    expect(creds.ok).toBe(true);

    const status = await withTimeout(
      supervisor.connectionCredentialStatus(ws.workspaceSessionId, {
        connectionId: createdConn.connectionId,
      }),
      2_000,
      'credentials/status'
    );
    expect(status.state).toBe('ready');

    const models = await withTimeout(
      supervisor.listModels(ws.workspaceSessionId, { connectionId: createdConn.connectionId }),
      2_000,
      'models/list'
    );
    expect(models.models.length).toBeGreaterThan(0);

    await withTimeout(
      supervisor.prompt(ws.workspaceSessionId, [{ type: 'text', text: 'job: echo hi' }]),
      10_000,
      'prompt job'
    );

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const done = updates.find(
            (u) =>
              u.workspaceSessionId === ws.workspaceSessionId && u.update.type === 'job_finished'
          );
          if (done) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'job_finished update'
    );

    const jobs = await withTimeout(supervisor.listJobs(ws.workspaceSessionId), 2_000, 'job/list');
    expect(jobs.jobs.length).toBeGreaterThan(0);

    const jobId = jobs.jobs[jobs.jobs.length - 1].jobId;
    const output = (await withTimeout(
      supervisor.jobOutput(ws.workspaceSessionId, { jobId }),
      2_000,
      'job/output'
    )) as { output: string };
    expect(output.output).toContain('hi');
  });
});
