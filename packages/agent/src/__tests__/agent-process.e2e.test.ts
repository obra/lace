import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EntErrorCodes } from '@lace/ent-protocol';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('lace-agent process (E2E over stdio)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-e2e' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it('rejects initialize without required clientInfo/capabilities', async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    await expect(
      withTimeout(
        ctx.agent.peer.request('initialize', { protocolVersion: '1.0' } as any),
        2_000,
        'initialize'
      )
    ).rejects.toMatchObject({ code: -32602, message: 'InvalidParams' });
  });

  it('returns AlreadyInitialized for repeated initialize', async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await expect(
      withTimeout(
        ctx.agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize again'
      )
    ).rejects.toMatchObject({
      code: EntErrorCodes.AlreadyInitialized,
      message: 'AlreadyInitialized',
    });
  });

  it(
    'initializes, creates a session, streams updates, and persists durable events',
    { timeout: 15_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      const updates: unknown[] = [];
      ctx.agent.peer.onRequest('session/update', async (params) => {
        updates.push(params);
        return undefined;
      });

      await withTimeout(
        ctx.agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize'
      );

      const created = (await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      )) as { sessionId: string };

      writeFileSync(join(ctx.workDir, 'hello.txt'), 'hi from disk\n', 'utf8');

      const promptResult = (await withTimeout(
        ctx.agent.peer.request('session/prompt', {
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
        ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
        2_000,
        'ent/session/events'
      )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

      expect(durable.hasMore).toBe(false);
      // context_injected is added on session creation with the system prompt
      // After the tool result, the LLM returns bare text which triggers a
      // tool_choice=required retry, producing an extra message event
      expect(durable.events.map((e) => e.type)).toEqual([
        'context_injected',
        'prompt',
        'turn_start',
        'message',
        'tool_use',
        'message', // LLM's response after tool result (bare text)
        'message', // bare text retry response
        'turn_end',
      ]);
      expect(durable.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

      const list = (await withTimeout(
        ctx.agent.peer.request('session/list', { cwd: ctx.workDir }),
        2_000,
        'session/list'
      )) as { sessions: Array<{ sessionId: string }> };

      expect(list.sessions.map((s) => s.sessionId)).toContain(created.sessionId);
    }
  );

  it('keeps JSONL session history across agent restarts', { timeout: 15_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    writeFileSync(join(ctx.workDir, 'hello.txt'), 'hi from disk\n', 'utf8');

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file hello.txt' }],
      }),
      10_000,
      'session/prompt'
    );

    await ctx.agent.shutdown();
    ctx.agent = undefined;

    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize (restart)'
    );

    await withTimeout(
      ctx.agent.peer.request('session/load', {
        sessionId: created.sessionId,
        cwd: ctx.workDir,
        mcpServers: [],
      }),
      2_000,
      'session/load (restart)'
    );

    const durable = (await withTimeout(
      ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events (restart)'
    )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

    // context_injected is added on session creation with the system prompt
    // After the tool result, the LLM returns bare text which triggers a
    // tool_choice=required retry, producing an extra message event
    expect(durable.events.map((e) => e.type)).toEqual([
      'context_injected',
      'prompt',
      'turn_start',
      'message',
      'tool_use',
      'message', // LLM's response after tool result (bare text)
      'message', // bare text retry response
      'turn_end',
    ]);
    expect(durable.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('reports currentSession.messageCount in ent/agent/status', { timeout: 15_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );
    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'hi' }],
      }),
      10_000,
      'session/prompt'
    );

    const status = (await withTimeout(
      ctx.agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status'
    )) as { currentSession?: { messageCount: number } };

    expect(status.currentSession?.messageCount ?? 0).toBeGreaterThan(0);
  });

  it(
    'requests permission before running bash and records a tool_use event',
    { timeout: 15_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      const updates: unknown[] = [];
      ctx.agent.peer.onRequest('session/update', async (params) => {
        updates.push(params);
        return undefined;
      });

      let lastPermissionParams: Record<string, unknown> | undefined;
      ctx.agent.peer.onRequest('session/request_permission', async (params) => {
        lastPermissionParams = params as Record<string, unknown>;
        return { decision: 'allow' };
      });

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      const promptResult = (await withTimeout(
        ctx.agent.peer.request('session/prompt', {
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
        ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
        2_000,
        'ent/session/events'
      )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

      // context_injected is added on session creation with the system prompt
      // The LLM (test provider) emits a message before the tool call ("Running echo hi..."),
      // so we expect an extra message event before permission_requested.
      // After the tool result, the LLM returns bare text which triggers a
      // tool_choice=required retry, producing an extra message event.
      expect(durable.events.map((e) => e.type)).toEqual([
        'context_injected',
        'prompt',
        'turn_start',
        'message', // LLM's initial response before tool call
        'permission_requested',
        'permission_decided',
        'tool_use',
        'message', // LLM's response after tool result (bare text)
        'message', // bare text retry response
        'turn_end',
      ]);

      expect(durable.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  );

  it(
    'requests permission before running file_write and exposes pending permissions via ent/agent/status',
    { timeout: 20_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      let permissionParams: Record<string, unknown> | undefined;
      let resolvePermission:
        | ((value: { decision: string; updatedInput?: Record<string, unknown> }) => void)
        | undefined;

      ctx.agent.peer.onRequest('session/request_permission', async (params) => {
        permissionParams = params as Record<string, unknown>;
        return await new Promise((resolve) => {
          resolvePermission = resolve as any;
        });
      });

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      const promptPromise = ctx.agent.peer.request('session/prompt', {
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
        ctx.agent.peer.request('ent/agent/status', {}),
        2_000,
        'ent/agent/status'
      )) as { pendingPermissions: Array<{ tool: string }> };

      expect(status.pendingPermissions.find((p) => p.tool === 'file_write')).toBeTruthy();

      resolvePermission?.({ decision: 'allow' });

      await withTimeout(promptPromise, 10_000, 'session/prompt (write)');

      expect(existsSync(join(ctx.workDir, 'out.txt'))).toBe(true);
      expect(readFileSync(join(ctx.workDir, 'out.txt'), 'utf8')).toContain(
        'written by test provider'
      );
    }
  );

  it(
    'reissues pending permission prompts after agent restart (derived from events.jsonl)',
    { timeout: 25_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      let sawPermissionRequest = false;
      ctx.agent.peer.onRequest('session/request_permission', async () => {
        sawPermissionRequest = true;
        return await new Promise(() => undefined);
      });

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );

      const created = (await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      )) as { sessionId: string };

      const promptPromise = ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'run: echo pending' }],
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
        5_000,
        'permission request received'
      );

      const beforeCrash = (await withTimeout(
        ctx.agent.peer.request('ent/agent/status'),
        2_000,
        'ent/agent/status (before crash)'
      )) as { pendingPermissions: Array<{ requestId: string; toolCallId: string }> };

      expect(beforeCrash.pendingPermissions).toHaveLength(1);
      const [{ requestId: requestIdBefore, toolCallId }] = beforeCrash.pendingPermissions;
      expect(requestIdBefore).toEqual(expect.any(String));
      expect(toolCallId).toEqual(expect.any(String));

      const stateRaw = readFileSync(
        join(ctx.laceDir, 'agent-sessions', created.sessionId, 'state.json'),
        'utf8'
      );
      expect((JSON.parse(stateRaw) as any).pendingPermissions).toBeUndefined();

      const eventsRaw = readFileSync(
        join(ctx.laceDir, 'agent-sessions', created.sessionId, 'events.jsonl'),
        'utf8'
      );
      expect(eventsRaw).toContain('"permission_requested"');
      expect(eventsRaw).not.toContain('"permission_decided"');

      ctx.agent.proc.kill('SIGKILL');
      await withTimeout(
        new Promise<void>((resolve) => ctx.agent!.proc.once('exit', () => resolve())),
        2_000,
        'agent process exit'
      );
      ctx.agent.peer.close();
      ctx.agent = undefined;

      await expect(
        withTimeout(promptPromise as Promise<unknown>, 2_000, 'prompt crashed')
      ).rejects.toBeDefined();

      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      const reissued: Array<Record<string, unknown>> = [];
      let resolveReissue:
        | ((value: { decision: string; updatedInput?: Record<string, unknown> }) => void)
        | undefined;
      ctx.agent.peer.onRequest('session/request_permission', async (params) => {
        reissued.push(params as Record<string, unknown>);
        return await new Promise((resolve) => {
          resolveReissue = resolve as any;
        });
      });

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize (restart)'
      );
      await withTimeout(
        ctx.agent.peer.request('session/load', {
          sessionId: created.sessionId,
          cwd: ctx.workDir,
          mcpServers: [],
        }),
        2_000,
        'session/load (restart)'
      );

      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (reissued.length > 0) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        5_000,
        'permission request reissued'
      );

      expect(reissued[0]).toMatchObject({ toolCallId });

      const afterRestart = (await withTimeout(
        ctx.agent.peer.request('ent/agent/status'),
        2_000,
        'ent/agent/status (after restart)'
      )) as { pendingPermissions: Array<{ requestId: string; toolCallId: string }> };

      expect(afterRestart.pendingPermissions).toHaveLength(1);
      expect(afterRestart.pendingPermissions[0]?.toolCallId).toBe(toolCallId);
      expect(afterRestart.pendingPermissions[0]?.requestId).toEqual(expect.any(String));

      resolveReissue?.({ decision: 'deny' });

      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const interval = setInterval(() => {
            void ctx
              .agent!.peer.request('ent/agent/status')
              .then((status) => {
                const p = status as { pendingPermissions?: unknown[] };
                if ((p.pendingPermissions ?? []).length === 0) {
                  clearInterval(interval);
                  resolve();
                }
              })
              .catch((err) => {
                clearInterval(interval);
                reject(err);
              });
          }, 25);
        }),
        5_000,
        'pending permissions cleared after decision'
      );

      const durable = (await withTimeout(
        ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
        2_000,
        'ent/session/events (after restart)'
      )) as { events: Array<{ type: string }> };

      expect(durable.events.map((e) => e.type)).toEqual(
        expect.arrayContaining(['permission_requested', 'permission_decided'])
      );
    }
  );

  it('supports ent/session/configure and reports config via ent/agent/status', async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    const configured = (await withTimeout(
      ctx.agent.peer.request('ent/session/configure', {
        maxBudgetUsd: 1.25,
        environment: { TEST_KEY: 'test-value' },
      }),
      2_000,
      'ent/session/configure'
    )) as { applied: string[]; config: Record<string, unknown> };

    expect(configured.applied).toEqual(expect.arrayContaining(['maxBudgetUsd', 'environment']));
    expect(configured.config.maxBudgetUsd).toBe(1.25);
    expect((configured.config as any).environment).toMatchObject({ TEST_KEY: 'test-value' });

    const configOptions = (await withTimeout(
      ctx.agent.peer.request('session/set_config_option', {
        sessionId: created.sessionId,
        configId: 'approvalMode',
        value: 'approve',
      }),
      2_000,
      'session/set_config_option'
    )) as { configOptions: Array<{ id: string; currentValue: string }> };
    expect(configOptions.configOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'approvalMode', currentValue: 'approve' }),
      ])
    );

    const status = (await withTimeout(
      ctx.agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status'
    )) as { limits: { maxBudgetUsd?: number } };

    expect(status.limits.maxBudgetUsd).toBe(1.25);
  });

  it('emits a context_injected update and durable event for ent/session/inject', async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: unknown[] = [];
    ctx.agent.peer.onRequest('session/update', async (params) => {
      updates.push(params);
      return undefined;
    });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );
    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    ctx.agent.peer.notify('ent/session/inject', {
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
      ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events'
    )) as { events: Array<{ eventSeq: number; type: string; data: Record<string, unknown> }> };

    expect(durable.events[0]?.type).toBe('context_injected');
    expect(durable.events[0]?.data.priority).toBe('normal');
  });

  it('can cancel a turn that is awaiting permission', { timeout: 15_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: unknown[] = [];
    ctx.agent.peer.onRequest('session/update', async (params) => {
      updates.push(params);
      return undefined;
    });

    let sawPermissionRequest = false;
    ctx.agent.peer.onRequest('session/request_permission', async () => {
      sawPermissionRequest = true;
      return await new Promise(() => undefined);
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    const { result: promptPromise } = ctx.agent.peer.requestWithId('session/prompt', {
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

    ctx.agent.peer.notify('session/cancel', { sessionId: created.sessionId });

    const cancelled = (await withTimeout(promptPromise, 5_000, 'prompt cancelled')) as {
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
      ctx.agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status'
    )) as { pendingPermissions: unknown[]; currentTurn?: unknown };

    expect(status.pendingPermissions).toEqual([]);
    expect(status.currentTurn).toBeUndefined();
  });

  it('creates a checkpoint and can rewind files', { timeout: 15_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );
    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'write file foo.txt' }],
      }),
      10_000,
      'session/prompt write foo.txt'
    );

    const original = readFileSync(join(ctx.workDir, 'foo.txt'), 'utf8');
    expect(original).toBe('written by test provider\n');

    const checkpoint = (await withTimeout(
      ctx.agent.peer.request('ent/session/checkpoint', { label: 'first' }),
      2_000,
      'ent/session/checkpoint'
    )) as { checkpointId: string; eventSeq: number; files: string[] };

    expect(checkpoint.checkpointId).toMatch(/^chk_/);
    expect(checkpoint.eventSeq).toBeGreaterThan(0);
    expect(checkpoint.files).toContain('foo.txt');

    writeFileSync(join(ctx.workDir, 'foo.txt'), 'modified\n', 'utf8');
    expect(readFileSync(join(ctx.workDir, 'foo.txt'), 'utf8')).toBe('modified\n');

    const rewind = (await withTimeout(
      ctx.agent.peer.request('ent/session/rewind', { toEventSeq: checkpoint.eventSeq }),
      5_000,
      'ent/session/rewind'
    )) as { filesRestored: string[]; eventSeq: number };

    expect(rewind.eventSeq).toBe(checkpoint.eventSeq);
    expect(rewind.filesRestored).toContain('foo.txt');
    expect(readFileSync(join(ctx.workDir, 'foo.txt'), 'utf8')).toBe(original);
  });

  it(
    'returns CheckpointNotFound for ent/session/rewind without a checkpoint',
    { timeout: 15_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );
      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'write file foo.txt' }],
        }),
        10_000,
        'session/prompt write foo.txt'
      );

      await expect(
        ctx.agent.peer.request('ent/session/rewind', { toEventSeq: 1 })
      ).rejects.toMatchObject({
        code: EntErrorCodes.CheckpointNotFound,
        message: 'CheckpointNotFound',
      });
    }
  );

  it(
    'supports ent/session/compact truncate and trims tool results in provider context',
    { timeout: 15_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      await withTimeout(
        ctx.agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize'
      );
      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      writeFileSync(
        join(ctx.workDir, 'hello.txt'),
        ['line1', 'line2', 'line3', 'line4', 'line5', ''].join('\n'),
        'utf8'
      );

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'read file hello.txt' }],
        }),
        10_000,
        'session/prompt read hello.txt'
      );

      const compact = (await withTimeout(
        ctx.agent.peer.request('ent/session/compact', { strategy: 'truncate', preserveRecent: 0 }),
        2_000,
        'ent/session/compact'
      )) as { messagesCompacted: number };
      expect(compact.messagesCompacted).toBeGreaterThan(0);

      const after = (await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'hello' }],
        }),
        10_000,
        'session/prompt after compact'
      )) as { content: Array<{ type: string; text?: string }> };

      const assistantText = after.content
        .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
        .join('\n');
      expect(assistantText).toContain('[results truncated to save space.]');
    }
  );

  it(
    'supports ent/session/compact summarize and returns summary text',
    { timeout: 15_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      await withTimeout(
        ctx.agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize'
      );
      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      writeFileSync(join(ctx.workDir, 'hello.txt'), 'hello from disk\n', 'utf8');

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'read file hello.txt' }],
        }),
        10_000,
        'session/prompt read hello.txt'
      );

      const compact = (await withTimeout(
        ctx.agent.peer.request('ent/session/compact', { strategy: 'summarize', preserveRecent: 0 }),
        10_000,
        'ent/session/compact summarize'
      )) as { messagesCompacted: number; summary?: string };

      expect(compact.messagesCompacted).toBeGreaterThan(0);
      expect(compact.summary).toContain('Summary of conversation (test provider).');
    }
  );
});
