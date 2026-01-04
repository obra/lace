import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';

describe('lace-agent process (E2E over stdio)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-e2e-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-e2e-wd-'));
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
      agent = undefined;
    }

    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('rejects initialize without required clientInfo/capabilities', async () => {
    agent = spawnAgentProcess({ laceDir });

    await expect(
      withTimeout(
        agent.peer.request('initialize', { protocolVersion: '1.0' } as any),
        2_000,
        'initialize'
      )
    ).rejects.toMatchObject({ code: -32602, message: 'InvalidParams' });
  });

  it('returns AlreadyInitialized for repeated initialize', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await expect(
      withTimeout(
        agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize again'
      )
    ).rejects.toMatchObject({ code: 10, message: 'AlreadyInitialized' });
  });

  it(
    'initializes, creates a session, streams updates, and persists durable events',
    { timeout: 15_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

      const updates: unknown[] = [];
      agent.peer.onRequest('session/update', async (params) => {
        updates.push(params);
        return undefined;
      });

      await withTimeout(
        agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize'
      );

      const created = (await withTimeout(
        agent.peer.request('session/new', { workDir }),
        2_000,
        'session/new'
      )) as { sessionId: string };

      writeFileSync(join(workDir, 'hello.txt'), 'hi from disk\n', 'utf8');

      const promptResult = (await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'read file hello.txt' }],
        }),
        10_000,
        'session/prompt'
      )) as { turnId: string };

      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            const match = updates.find((u) => {
              const p = u as Record<string, unknown>;
              return (
                p?.type === 'tool_use' &&
                p?.name === 'file_read' &&
                p?.status === 'completed' &&
                p?.turnId === promptResult.turnId
              );
            });
            if (match) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        5_000,
        'session/update tool_use stream'
      );

      const durable = (await withTimeout(
        agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
        2_000,
        'ent/session/events'
      )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

      expect(durable.hasMore).toBe(false);
      expect(durable.events.map((e) => e.type)).toEqual([
        'prompt',
        'turn_start',
        'message',
        'tool_use',
        'message',
        'turn_end',
      ]);
      expect(durable.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5, 6]);

      const list = (await withTimeout(
        agent.peer.request('session/list', { workDir }),
        2_000,
        'session/list'
      )) as { sessions: Array<{ sessionId: string }> };

      expect(list.sessions.map((s) => s.sessionId)).toContain(created.sessionId);
    }
  );

  it('keeps JSONL session history across agent restarts', { timeout: 15_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });
    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      agent.peer.request('session/new', { workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    writeFileSync(join(workDir, 'hello.txt'), 'hi from disk\n', 'utf8');

    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file hello.txt' }],
      }),
      10_000,
      'session/prompt'
    );

    await agent.shutdown();
    agent = undefined;

    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });
    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize (restart)'
    );

    await withTimeout(
      agent.peer.request('session/load', { sessionId: created.sessionId }),
      2_000,
      'session/load (restart)'
    );

    const durable = (await withTimeout(
      agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events (restart)'
    )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

    expect(durable.events.map((e) => e.type)).toEqual([
      'prompt',
      'turn_start',
      'message',
      'tool_use',
      'message',
      'turn_end',
    ]);
    expect(durable.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reports currentSession.messageCount in ent/agent/status', { timeout: 15_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );
    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'hi' }],
      }),
      10_000,
      'session/prompt'
    );

    const status = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status'
    )) as { currentSession?: { messageCount: number } };

    expect(status.currentSession?.messageCount ?? 0).toBeGreaterThan(0);
  });

  it(
    'requests permission before running bash and records a tool_use event',
    { timeout: 15_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir });

      const updates: unknown[] = [];
      agent.peer.onRequest('session/update', async (params) => {
        updates.push(params);
        return undefined;
      });

      let lastPermissionParams: Record<string, unknown> | undefined;
      agent.peer.onRequest('session/request_permission', async (params) => {
        lastPermissionParams = params as Record<string, unknown>;
        return { decision: 'allow' };
      });

      await withTimeout(
        agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      const promptResult = (await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'run: echo hi' }],
        }),
        10_000,
        'session/prompt'
      )) as { turnId: string };

      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            const toolFinished = updates.find((u) => {
              const p = u as Record<string, unknown>;
              const result = p?.result as Record<string, unknown> | undefined;
              return (
                p?.type === 'tool_use' &&
                p?.status === 'completed' &&
                result?.outcome === 'completed'
              );
            });
            if (toolFinished) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        5_000,
        'tool_use completed update'
      );

      expect(lastPermissionParams).toMatchObject({
        tool: 'bash',
        resource: 'echo hi',
        sessionId: expect.any(String),
        turnId: promptResult.turnId,
        toolCallId: expect.any(String),
      });

      const durable = (await withTimeout(
        agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
        2_000,
        'ent/session/events'
      )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

      expect(durable.events.map((e) => e.type)).toEqual([
        'prompt',
        'turn_start',
        'tool_use',
        'message',
        'turn_end',
      ]);

      expect(durable.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5]);
    }
  );

  it(
    'requests permission before running file_write and exposes pending permissions via ent/agent/status',
    { timeout: 20_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

      let permissionParams: Record<string, unknown> | undefined;
      let resolvePermission:
        | ((value: { decision: string; updatedInput?: Record<string, unknown> }) => void)
        | undefined;

      agent.peer.onRequest('session/request_permission', async (params) => {
        permissionParams = params as Record<string, unknown>;
        return await new Promise((resolve) => {
          resolvePermission = resolve as any;
        });
      });

      await withTimeout(
        agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      const promptPromise = agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'write file out.txt' }],
      });

      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (permissionParams) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        5_000,
        'permission request'
      );

      expect(permissionParams).toMatchObject({
        tool: 'file_write',
        sessionId: expect.any(String),
        turnId: expect.any(String),
        toolCallId: expect.any(String),
      });

      const status = (await withTimeout(
        agent.peer.request('ent/agent/status', {}),
        2_000,
        'ent/agent/status'
      )) as { pendingPermissions: Array<{ tool: string }> };

      expect(status.pendingPermissions.find((p) => p.tool === 'file_write')).toBeTruthy();

      resolvePermission?.({ decision: 'allow' });

      await withTimeout(promptPromise, 10_000, 'session/prompt (write)');

      expect(existsSync(join(workDir, 'out.txt'))).toBe(true);
      expect(readFileSync(join(workDir, 'out.txt'), 'utf8')).toContain('written by test provider');
    }
  );

  it('supports ent/session/configure and reports config via ent/agent/status', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    const configured = (await withTimeout(
      agent.peer.request('ent/session/configure', { approvalMode: 'approve', maxBudgetUsd: 1.25 }),
      2_000,
      'ent/session/configure'
    )) as { applied: string[]; config: Record<string, unknown> };

    expect(configured.applied).toEqual(expect.arrayContaining(['approvalMode', 'maxBudgetUsd']));
    expect(configured.config.approvalMode).toBe('approve');
    expect(configured.config.maxBudgetUsd).toBe(1.25);

    const status = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status'
    )) as { limits: { maxBudgetUsd?: number } };

    expect(status.limits.maxBudgetUsd).toBe(1.25);
  });

  it('emits a context_injected update and durable event for ent/session/inject', async () => {
    agent = spawnAgentProcess({ laceDir });

    const updates: unknown[] = [];
    agent.peer.onRequest('session/update', async (params) => {
      updates.push(params);
      return undefined;
    });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );
    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    agent.peer.notify('ent/session/inject', {
      content: [{ type: 'text', text: 'Injected' }],
      priority: 'normal',
    });

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const injected = updates.find((u) => (u as any)?.type === 'context_injected');
          if (injected) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      2_000,
      'session/update context_injected'
    );

    const durable = (await withTimeout(
      agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events'
    )) as { events: Array<{ eventSeq: number; type: string; data: Record<string, unknown> }> };

    expect(durable.events[0]?.type).toBe('context_injected');
    expect(durable.events[0]?.data.priority).toBe('normal');
  });

  it('can cancel a turn that is awaiting permission', { timeout: 15_000 }, async () => {
    agent = spawnAgentProcess({ laceDir });

    const updates: unknown[] = [];
    agent.peer.onRequest('session/update', async (params) => {
      updates.push(params);
      return undefined;
    });

    let sawPermissionRequest = false;
    agent.peer.onRequest('session/request_permission', async () => {
      sawPermissionRequest = true;
      return await new Promise(() => undefined);
    });

    await withTimeout(
      agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    const promptPromise = agent.peer.request('session/prompt', {
      content: [{ type: 'text', text: 'run: echo will-not-run' }],
    });

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (sawPermissionRequest) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      2_000,
      'permission request received'
    );

    agent.peer.notify('session/cancel');

    const cancelled = (await withTimeout(
      promptPromise as Promise<unknown>,
      5_000,
      'prompt cancelled'
    )) as {
      stopReason: string;
    };
    expect(cancelled.stopReason).toBe('cancelled');

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const match = updates.find((u) => {
            const p = u as Record<string, unknown>;
            return p?.type === 'tool_use' && p?.status === 'cancelled';
          });
          if (match) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'tool_use cancelled update'
    );

    const status = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status'
    )) as { pendingPermissions: unknown[]; currentTurn?: unknown };

    expect(status.pendingPermissions).toEqual([]);
    expect(status.currentTurn).toBeUndefined();
  });

  it('creates a checkpoint and can rewind files', { timeout: 15_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );
    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'write file foo.txt' }],
      }),
      10_000,
      'session/prompt write foo.txt'
    );

    const original = readFileSync(join(workDir, 'foo.txt'), 'utf8');
    expect(original).toBe('written by test provider\n');

    const checkpoint = (await withTimeout(
      agent.peer.request('ent/session/checkpoint', { label: 'first' }),
      2_000,
      'ent/session/checkpoint'
    )) as { checkpointId: string; eventSeq: number; files: string[] };

    expect(checkpoint.checkpointId).toMatch(/^chk_/);
    expect(checkpoint.eventSeq).toBeGreaterThan(0);
    expect(checkpoint.files).toContain('foo.txt');

    writeFileSync(join(workDir, 'foo.txt'), 'modified\n', 'utf8');
    expect(readFileSync(join(workDir, 'foo.txt'), 'utf8')).toBe('modified\n');

    const rewind = (await withTimeout(
      agent.peer.request('ent/session/rewind', { toEventSeq: checkpoint.eventSeq }),
      5_000,
      'ent/session/rewind'
    )) as { filesRestored: string[]; eventSeq: number };

    expect(rewind.eventSeq).toBe(checkpoint.eventSeq);
    expect(rewind.filesRestored).toContain('foo.txt');
    expect(readFileSync(join(workDir, 'foo.txt'), 'utf8')).toBe(original);
  });

  it(
    'returns CheckpointNotFound for ent/session/rewind without a checkpoint',
    { timeout: 15_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

      agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

      await withTimeout(
        agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );
      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'write file foo.txt' }],
        }),
        10_000,
        'session/prompt write foo.txt'
      );

      await expect(
        agent.peer.request('ent/session/rewind', { toEventSeq: 1 })
      ).rejects.toMatchObject({
        code: 12,
        message: 'CheckpointNotFound',
      });
    }
  );

  it(
    'supports ent/session/compact and drops prior tool results from provider context',
    { timeout: 15_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

      await withTimeout(
        agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize'
      );
      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      writeFileSync(join(workDir, 'hello.txt'), 'hello from disk\n', 'utf8');

      await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'read file hello.txt' }],
        }),
        10_000,
        'session/prompt read hello.txt'
      );

      const compact = (await withTimeout(
        agent.peer.request('ent/session/compact', { strategy: 'truncate', preserveRecent: 0 }),
        2_000,
        'ent/session/compact'
      )) as { messagesCompacted: number };
      expect(compact.messagesCompacted).toBeGreaterThan(0);

      const after = (await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'hello' }],
        }),
        10_000,
        'session/prompt after compact'
      )) as { content: Array<{ type: string; text?: string }> };

      const assistantText = after.content
        .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
        .join('\n');
      expect(assistantText).toContain('No tool result found.');
    }
  );

  it(
    'supports ent/session/compact summarize and returns summary text',
    { timeout: 15_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

      await withTimeout(
        agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize'
      );
      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      writeFileSync(join(workDir, 'hello.txt'), 'hello from disk\n', 'utf8');

      await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'read file hello.txt' }],
        }),
        10_000,
        'session/prompt read hello.txt'
      );

      const compact = (await withTimeout(
        agent.peer.request('ent/session/compact', { strategy: 'summarize', preserveRecent: 0 }),
        10_000,
        'ent/session/compact summarize'
      )) as { messagesCompacted: number; summary?: string };

      expect(compact.messagesCompacted).toBeGreaterThan(0);
      expect(compact.summary).toContain('Summary of conversation (test provider).');
    }
  );
});
