import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';

type ProviderInfo = { providerId: string; displayName?: string };
type ConnectionInfo = { connectionId: string; providerId: string; credentialState?: string };

/**
 * Contract-style coverage for key Ent protocol methods.
 * These tests exercise stdio JSON-RPC end-to-end against the built agent.
 */
describe('Ent protocol contract (selected coverage)', () => {
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-ent-protocol-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-ent-workdir-'));
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
      agent = undefined;
    }
    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it(
    'supports provider catalog, connections, models (enable/disable) and session configure',
    { timeout: 25_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir });

      await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

      const catalog = (await withTimeout(
        agent.peer.request('ent/providers/catalog'),
        2_000,
        'providers/catalog'
      )) as { providers: Array<{ id: string; models: unknown[] }> };
      expect(catalog.providers.length).toBeGreaterThan(0);
      expect(Array.isArray(catalog.providers[0]?.models)).toBe(true);

      // providers list
      const { providers } = (await withTimeout(
        agent.peer.request('ent/providers/list'),
        2_000,
        'providers/list'
      )) as { providers: Array<{ providerId: string; displayName?: string }> };
      expect(providers.length).toBeGreaterThan(0);

      const providerId =
        providers.find((p) => p.providerId === 'openai')?.providerId ?? providers[0].providerId;

      // connections upsert
      const { connectionId } = (await withTimeout(
        agent.peer.request('ent/connections/upsert', {
          providerId,
          connection: { name: 'ent-spec', config: {} },
        }),
        2_000,
        'connections/upsert'
      )) as { connectionId: string };
      expect(connectionId).toBeTruthy();

      // models list
      const modelsResp = (await withTimeout(
        agent.peer.request('ent/models/list', { connectionId }),
        2_000,
        'models/list'
      )) as {
        providerId: string;
        models: Array<{
          modelId: string;
          disabled?: boolean;
          disabledState?: 'enabled' | 'disabled';
        }>;
      };
      expect(modelsResp.providerId).toBe(providerId);
      expect(modelsResp.models.length).toBeGreaterThan(0);
      expect(modelsResp.models[0]?.disabledState).toBeDefined();

      const targetModel = modelsResp.models[0].modelId;

      // disable + verify disabled flag appears
      await withTimeout(
        agent.peer.request('ent/models/disable', { providerId, modelIds: [targetModel] }),
        2_000,
        'models/disable'
      );
      const afterDisable = (await withTimeout(
        agent.peer.request('ent/models/list', { connectionId }),
        2_000,
        'models/list after disable'
      )) as {
        models: Array<{
          modelId: string;
          disabled?: boolean;
          disabledState?: 'enabled' | 'disabled';
        }>;
      };
      const disabledEntry = afterDisable.models.find((m) => m.modelId === targetModel);
      expect(disabledEntry?.disabled).toBe(true);
      expect(disabledEntry?.disabledState).toBe('disabled');

      // configure session with env + approvalMode
      const { sessionId } = (await withTimeout(
        agent.peer.request('session/new', { workDir }),
        2_000,
        'session/new'
      )) as { sessionId: string };
      expect(sessionId).toBeTruthy();

      const configureResult = (await withTimeout(
        agent.peer.request('ent/session/configure', {
          connectionId,
          modelId: targetModel,
          environment: { HELLO: 'WORLD' },
          approvalMode: 'approveReads',
        }),
        2_000,
        'session/configure'
      )) as { applied: string[]; config: Record<string, unknown> };

      expect(configureResult.applied).toEqual(
        expect.arrayContaining(['connectionId', 'modelId', 'environment', 'approvalMode'])
      );
      expect(configureResult.config).toMatchObject({
        connectionId,
        modelId: targetModel,
        environment: { HELLO: 'WORLD' },
        approvalMode: 'approveReads',
      });
    }
  );

  it('handles concurrent ent/providers/refresh and ent/models/list without transient Unknown providerId', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

    const { providers } = (await withTimeout(
      agent.peer.request('ent/providers/list'),
      2_000,
      'providers/list'
    )) as { providers: ProviderInfo[] };
    const providerId =
      providers.find((p) => p.providerId === 'openai')?.providerId ?? providers[0].providerId;

    const { connectionId } = (await withTimeout(
      agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'race', config: {} },
      }),
      2_000,
      'connections/upsert'
    )) as { connectionId: string };

    // Race refresh against list. This used to intermittently return Unknown providerId.
    const [models] = (await Promise.all([
      withTimeout(agent.peer.request('ent/models/list', { connectionId }), 2_000, 'models/list'),
      withTimeout(agent.peer.request('ent/providers/refresh', {}), 2_000, 'providers/refresh'),
    ])) as [{ providerId: string; models: Array<{ modelId: string }> }, any];

    expect(models.providerId).toBeTruthy();
    expect(models.models.length).toBeGreaterThan(0);
  });

  it('returns structured error for unknown provider refresh and models list invalid conn', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

    const providers = (await withTimeout(
      agent.peer.request('ent/providers/list'),
      2_000,
      'providers/list'
    )) as { providers: ProviderInfo[] };
    const knownProvider = providers.providers[0].providerId;

    const refreshOk = (await withTimeout(
      agent.peer.request('ent/providers/refresh', { providerId: knownProvider }),
      2_000,
      'providers/refresh known'
    )) as { ok: boolean; refreshedAt: string };
    expect(refreshOk.ok).toBe(true);
    expect(new Date(refreshOk.refreshedAt).toString()).not.toBe('Invalid Date');

    const refresh = (await withTimeout(
      agent.peer.request('ent/providers/refresh', { providerId: 'does-not-exist' }),
      2_000,
      'providers/refresh'
    )) as { ok: boolean; error?: string };
    expect(refresh.ok).toBe(false);
    expect(refresh.error).toContain('Unknown providerId');

    await expect(
      agent.peer.request('ent/models/list', { connectionId: 'nope' })
    ).rejects.toMatchObject({
      code: 14,
      message: 'ConnectionNotFound',
    });
  });

  it('ent/session/configure accepts arbitrary connectionId/modelId values', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

    const { sessionId } = (await withTimeout(
      agent.peer.request('session/new', { workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };
    expect(sessionId).toBeTruthy();

    const configuredMissing = (await withTimeout(
      agent.peer.request('ent/session/configure', { connectionId: 'missing', modelId: 'foo' }),
      2_000,
      'session/configure missing'
    )) as { applied: string[] };
    expect(configuredMissing.applied).toEqual(expect.arrayContaining(['connectionId', 'modelId']));

    const { providers } = (await withTimeout(
      agent.peer.request('ent/providers/list'),
      2_000,
      'providers/list'
    )) as { providers: ProviderInfo[] };
    const providerId =
      providers.find((p) => p.providerId === 'openai')?.providerId ?? providers[0].providerId;

    const { connectionId } = (await withTimeout(
      agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'cfg-validate', config: {} },
      }),
      2_000,
      'connections/upsert'
    )) as { connectionId: string };

    const { models } = (await withTimeout(
      agent.peer.request('ent/models/list', { connectionId }),
      2_000,
      'models/list'
    )) as { models: Array<{ modelId: string }> };

    const validModel = models[0].modelId;

    const ok = (await withTimeout(
      agent.peer.request('ent/session/configure', { connectionId, modelId: validModel }),
      2_000,
      'session/configure valid'
    )) as { applied: string[] };
    expect(ok.applied).toEqual(expect.arrayContaining(['connectionId', 'modelId']));
  });

  it('supports connection listing, credential start/submit, and provider filter', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

    const providers = (await withTimeout(
      agent.peer.request('ent/providers/list'),
      2_000,
      'providers/list'
    )) as { providers: ProviderInfo[] };
    const providerId = providers.providers[0].providerId;

    const { connectionId } = (await withTimeout(
      agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'conn-for-cred', config: {} },
      }),
      2_000,
      'connections/upsert'
    )) as { connectionId: string };

    const credStart = (await withTimeout(
      agent.peer.request('ent/connections/credentials/start', { connectionId }),
      2_000,
      'credentials/start'
    )) as { kind?: string; fields?: Array<{ name: string; secret?: boolean }> };
    expect(credStart.kind === undefined || credStart.kind === 'needs_input').toBe(true);

    const credSubmit = (await withTimeout(
      agent.peer.request('ent/connections/credentials/submit', {
        connectionId,
        values: { apiKey: 'sk-test' },
      }),
      2_000,
      'credentials/submit'
    )) as { ok: boolean };
    expect(credSubmit.ok).toBe(true);

    const listAll = (await withTimeout(
      agent.peer.request('ent/connections/list', {}),
      2_000,
      'connections/list'
    )) as { connections: ConnectionInfo[] };
    expect(listAll.connections.find((c) => c.connectionId === connectionId)).toBeDefined();

    const listFiltered = (await withTimeout(
      agent.peer.request('ent/connections/list', { providerId }),
      2_000,
      'connections/list filter'
    )) as { connections: ConnectionInfo[] };
    expect(listFiltered.connections.every((c) => c.providerId === providerId)).toBe(true);

    // clear credentials, then delete connection
    const clear = (await withTimeout(
      agent.peer.request('ent/connections/credentials/clear', { connectionId }),
      2_000,
      'credentials/clear'
    )) as { ok: boolean };
    expect(clear.ok).toBe(true);

    const deleted = (await withTimeout(
      agent.peer.request('ent/connections/delete', { connectionId }),
      2_000,
      'connections/delete'
    )) as { ok: boolean };
    expect(deleted.ok).toBe(true);

    await expect(agent.peer.request('ent/models/list', { connectionId })).rejects.toMatchObject({
      code: 14,
      message: 'ConnectionNotFound',
    });
  });

  it('persists model gating across restart and supports tools/personas listing', async () => {
    const providerContext = await (async () => {
      agent = spawnAgentProcess({ laceDir });
      await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');
      const { providers } = (await withTimeout(
        agent.peer.request('ent/providers/list'),
        2_000,
        'providers/list'
      )) as { providers: ProviderInfo[] };
      expect(providers.length).toBeGreaterThan(0);
      const providerId = providers[0].providerId;
      const { connectionId } = (await withTimeout(
        agent.peer.request('ent/connections/upsert', {
          providerId,
          connection: { name: 'gating-test', config: {} },
        }),
        2_000,
        'connections/upsert'
      )) as { connectionId: string };
      const { models } = (await withTimeout(
        agent.peer.request('ent/models/list', { connectionId }),
        2_000,
        'models/list'
      )) as { models: Array<{ modelId: string }> };
      const target = models[0].modelId;
      await withTimeout(
        agent.peer.request('ent/models/disable', { providerId, modelIds: [target] }),
        2_000,
        'models/disable'
      );

      // invalid modelId should error
      await expect(
        agent.peer.request('ent/models/enable', { providerId, modelIds: ['nope'] })
      ).rejects.toMatchObject({ code: -32602, message: 'InvalidParams' });

      await agent.shutdown();
      agent = undefined;
      return { providerId, connectionId, targetModel: target };
    })();

    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');
    const afterDisable = (await withTimeout(
      agent.peer.request('ent/models/list', { connectionId: providerContext.connectionId }),
      2_000,
      'models/list after restart'
    )) as {
      models: Array<{
        modelId: string;
        disabled?: boolean;
        disabledState?: 'enabled' | 'disabled';
      }>;
    };
    const entry = afterDisable.models.find((m) => m.modelId === providerContext.targetModel);
    expect(entry?.disabled).toBe(true);
    expect(entry?.disabledState).toBe('disabled');

    const tools = (await withTimeout(
      agent.peer.request('ent/tools/list', {}),
      2_000,
      'tools/list'
    )) as { tools: Array<{ name: string }> };
    expect(new Set(tools.tools.map((t) => t.name)).size).toBe(tools.tools.length);

    const personas = (await withTimeout(
      agent.peer.request('ent/personas/list', {}),
      2_000,
      'personas/list'
    )) as { personas: Array<{ id: string; name: string }> };
    expect(personas.personas).toBeDefined();
  });

  it('validates session/configure params for env and mcpServers', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');
    const { sessionId } = (await withTimeout(
      agent.peer.request('session/new', { workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };
    expect(sessionId).toBeTruthy();

    await expect(
      agent.peer.request('ent/session/configure', { environment: { KEY: 123 } })
    ).rejects.toMatchObject({ code: -32602 });

    await expect(
      agent.peer.request('ent/session/configure', {
        mcpServers: [{ name: 'bad', command: 'echo', transport: 'http' }],
      })
    ).rejects.toMatchObject({ code: -32602 });

    await expect(
      agent.peer.request('ent/session/configure', { approvalMode: 'invalid' })
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('returns error when prompting without connection/model', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');
    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    await expect(
      agent.peer.request('session/prompt', { content: [{ type: 'text', text: 'hi' }] })
    ).rejects.toMatchObject({
      code: -32602,
      message: 'InvalidParams',
      data: { category: 'protocol', reason: expect.stringContaining('connectionId') },
    });
  });

  it('covers agent ping/status, models refresh, jobs list empty', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

    const ping = (await withTimeout(agent.peer.request('ent/agent/ping'), 2_000, 'agent/ping')) as {
      ok: boolean;
      timestamp: string;
    };
    expect(ping.ok).toBe(true);
    expect(new Date(ping.timestamp).toString()).not.toBe('Invalid Date');

    const { providers } = (await withTimeout(
      agent.peer.request('ent/providers/list'),
      2_000,
      'providers/list'
    )) as { providers: ProviderInfo[] };
    const providerId = providers[0].providerId;
    const { connectionId } = (await withTimeout(
      agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'status-test', config: {} },
      }),
      2_000,
      'connections/upsert'
    )) as { connectionId: string };
    const { models } = (await withTimeout(
      agent.peer.request('ent/models/list', { connectionId }),
      2_000,
      'models/list'
    )) as { models: Array<{ modelId: string }> };
    const modelId = models[0].modelId;

    const refresh = (await withTimeout(
      agent.peer.request('ent/models/refresh', { connectionId }),
      2_000,
      'models/refresh'
    )) as { ok: boolean; refreshedAt: string };
    expect(refresh.ok).toBe(true);

    const { sessionId } = (await withTimeout(
      agent.peer.request('session/new', { workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };
    expect(sessionId).toBeTruthy();

    await withTimeout(
      agent.peer.request('ent/session/configure', {
        connectionId,
        modelId,
        environment: { FOO: 'BAR' },
      }),
      2_000,
      'session/configure'
    );

    const status = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'agent/status'
    )) as {
      currentSession?: { connectionId?: string; modelId?: string };
      limits?: { maxBudgetUsd?: number };
    };
    expect(status.currentSession?.connectionId).toBe(connectionId);
    expect(status.currentSession?.modelId).toBe(modelId);

    const jobs = (await withTimeout(agent.peer.request('ent/job/list'), 2_000, 'job/list')) as {
      jobs: unknown[];
    };
    expect(Array.isArray(jobs.jobs)).toBe(true);

    const jobsAgain = (await withTimeout(
      agent.peer.request('ent/job/list'),
      2_000,
      'job/list again'
    )) as { jobs: unknown[] };
    expect(Array.isArray(jobsAgain.jobs)).toBe(true);
  });

  it('covers job output/kill errors and checkpoint/rewind/compact validation', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');
    const { sessionId } = (await withTimeout(
      agent.peer.request('session/new', { workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };
    expect(sessionId).toBeTruthy();

    // Job output/kill on unknown job
    await expect(
      agent.peer.request('ent/job/output', { jobId: 'missing-job' })
    ).rejects.toMatchObject({ code: 8, message: 'JobNotFound' });
    const kill = (await withTimeout(
      agent.peer.request('ent/job/kill', { jobId: 'missing-job' }),
      2_000,
      'job/kill missing'
    )) as { success: boolean };
    expect(kill.success).toBe(false);

    // checkpoint and rewind invalid id
    const checkpoint = (await withTimeout(
      agent.peer.request('ent/session/checkpoint', { label: 'test' }),
      2_000,
      'session/checkpoint'
    )) as { checkpointId: string; eventSeq: number };
    expect(checkpoint.checkpointId).toBeTruthy();
    expect(typeof checkpoint.eventSeq).toBe('number');

    // add a non-checkpoint event to advance eventSeq without a checkpoint
    await withTimeout(
      agent.peer.request('ent/session/inject', { content: [{ type: 'text', text: 'ctx' }] }),
      2_000,
      'session/inject'
    );

    await expect(
      agent.peer.request('ent/session/rewind', {
        toEventSeq: Number.isFinite(checkpoint.eventSeq) ? checkpoint.eventSeq + 1 : 999,
      })
    ).rejects.toMatchObject({ code: 12, message: 'CheckpointNotFound' });

    // compact invalid mode
    await expect(
      agent.peer.request('ent/session/compact', { strategy: 'invalid' })
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('rejects invalid structured output schema', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');
    const { providers } = (await withTimeout(
      agent.peer.request('ent/providers/list'),
      2_000,
      'providers/list'
    )) as { providers: ProviderInfo[] };
    const providerId = providers[0].providerId;
    const { connectionId } = (await withTimeout(
      agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'struct-out', config: {} },
      }),
      2_000,
      'connections/upsert'
    )) as { connectionId: string };
    const { models } = (await withTimeout(
      agent.peer.request('ent/models/list', { connectionId }),
      2_000,
      'models/list'
    )) as { models: Array<{ modelId: string }> };
    const modelId = models[0].modelId;

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');
    await withTimeout(
      agent.peer.request('ent/session/configure', { connectionId, modelId }),
      2_000,
      'session/configure'
    );

    await expect(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'hi' }],
        outputFormat: { type: 'json_schema', schema: 'not-an-object' },
      })
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('covers ent/session/events filtering and pagination', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    const checkpoint = (await withTimeout(
      agent.peer.request('ent/session/checkpoint', { label: 'evt' }),
      2_000,
      'session/checkpoint'
    )) as { checkpointId: string; eventSeq: number };
    expect(checkpoint.checkpointId).toBeTruthy();
    expect(typeof checkpoint.eventSeq).toBe('number');

    const all = (await withTimeout(
      agent.peer.request('ent/session/events', { limit: 50 }),
      2_000,
      'session/events'
    )) as { events: Array<{ eventSeq: number; type: string }>; nextCursor?: number };
    expect(Array.isArray(all.events)).toBe(true);
    expect(all.events.length).toBeGreaterThan(0);

    const after = (await withTimeout(
      agent.peer.request('ent/session/events', {
        afterEventSeq: all.events[0].eventSeq,
        limit: 50,
      }),
      2_000,
      'session/events after'
    )) as { events: Array<{ eventSeq: number }> };
    expect(after.events.every((e) => e.eventSeq > all.events[0].eventSeq)).toBe(true);

    const checkpointEventType = (all as any).events?.find(
      (e: any) => e?.data?.checkpointId === checkpoint.checkpointId
    )?.type as string | undefined;
    expect(typeof checkpointEventType).toBe('string');

    const filtered = (await withTimeout(
      agent.peer.request('ent/session/events', { types: [checkpointEventType!], limit: 50 }),
      2_000,
      'session/events filtered'
    )) as { events: Array<{ type: string }> };
    expect(filtered.events.length).toBeGreaterThan(0);
    expect(new Set(filtered.events.map((e) => e.type))).toEqual(new Set([checkpointEventType]));
  });

  it('covers MCP server method error paths without active session', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

    const list = (await withTimeout(
      agent.peer.request('ent/mcp/servers/list', {}),
      2_000,
      'mcp/servers/list'
    )) as { servers: unknown[] };
    expect(Array.isArray(list.servers)).toBe(true);

    await expect(
      agent.peer.request('ent/mcp/servers/upsert', { name: 'x', command: 'y' })
    ).rejects.toMatchObject({ message: 'SessionNotFound' });

    await expect(
      agent.peer.request('ent/mcp/servers/delete', { serverId: 'x' })
    ).rejects.toMatchObject({ message: 'SessionNotFound' });

    await expect(
      agent.peer.request('ent/mcp/servers/test', { serverId: 'missing' })
    ).rejects.toMatchObject({ message: 'McpServerNotFound' });

    await expect(
      agent.peer.request('ent/mcp/tools/list', { serverId: 'missing' })
    ).rejects.toMatchObject({ message: expect.stringContaining('McpServerNot') });
  });

  it('covers workspace method param validation and notfound', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

    await expect(agent.peer.request('ent/workspace/info', {})).rejects.toMatchObject({
      code: -32602,
    });
    await expect(agent.peer.request('ent/workspace/create', {})).rejects.toMatchObject({
      code: -32602,
    });

    await expect(
      agent.peer.request('ent/workspace/info', { sessionId: 'missing-workspace' })
    ).rejects.toMatchObject({ message: 'WorkspaceNotFound', data: { category: 'workspace' } });
  });

  it('covers ent/connections/test shape and ent/job/inject noop', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

    const { providers } = (await withTimeout(
      agent.peer.request('ent/providers/list'),
      2_000,
      'providers/list'
    )) as { providers: ProviderInfo[] };
    const providerId = providers[0].providerId;
    const { connectionId } = (await withTimeout(
      agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'conn-test', config: {} },
      }),
      2_000,
      'connections/upsert'
    )) as { connectionId: string };

    const testResult = (await withTimeout(
      agent.peer.request('ent/connections/test', { connectionId }),
      2_000,
      'connections/test'
    )) as { ok: boolean; error?: string; latencyMs?: number };
    expect(typeof testResult.ok).toBe('boolean');
    if (testResult.latencyMs !== undefined) expect(testResult.latencyMs).toBeGreaterThanOrEqual(0);
    if (testResult.ok === false) expect(typeof testResult.error).toBe('string');

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    // No-op without a running subagent job (notification; should not throw).
    agent.peer.notify('ent/job/inject', {
      jobId: 'missing-job',
      content: [{ type: 'text', text: 'hi' }],
      priority: 'normal',
    });
  });
});
