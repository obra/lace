import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { appendDurableEvent } from '../storage/event-log';
import { ensureSessionFiles, writeSessionMeta, writeSessionState } from '../storage/session-store';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';
import * as MethodSchemas from '@lace/ent-protocol';

type ProviderInfo = { providerId: string; displayName?: string };
type ConnectionInfo = { connectionId: string; providerId: string; credentialState?: string };

function parseParams(schema: unknown, params: unknown): unknown {
  const paramsSchema = (schema as any)?.shape?.params;
  if (!paramsSchema) return params;

  // Some request schemas have optional params. Prefer `undefined` when the schema allows it.
  if (params === undefined) {
    try {
      return paramsSchema.parse(undefined);
    } catch {
      return paramsSchema.parse({});
    }
  }

  return paramsSchema.parse(params);
}

function parseResult(schema: unknown, result: unknown): unknown {
  const resultSchema = (schema as any)?.shape?.result;
  if (!resultSchema) return result;
  return resultSchema.parse(result);
}

async function requestOk<T>(options: {
  agent: SpawnedAgent;
  method: string;
  requestSchema: unknown;
  responseSchema: unknown;
  params?: unknown;
  timeoutMs?: number;
  label?: string;
}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const label = options.label ?? options.method;
  const parsedParams = parseParams(options.requestSchema, options.params);
  const result = await withTimeout(
    options.agent.peer.request(options.method, parsedParams as any),
    timeoutMs,
    label
  );
  return parseResult(options.responseSchema, result) as T;
}

async function requestNotificationOk(options: {
  agent: SpawnedAgent;
  method: string;
  notificationSchema: unknown;
  params: unknown;
  timeoutMs?: number;
  label?: string;
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const label = options.label ?? options.method;
  const parsedParams = parseParams(options.notificationSchema, options.params);
  await withTimeout(
    options.agent.peer.request(options.method, parsedParams as any),
    timeoutMs,
    label
  );
}

function notifyOk(options: {
  agent: SpawnedAgent;
  method: string;
  notificationSchema: unknown;
  params: unknown;
}): void {
  const parsedParams = parseParams(options.notificationSchema, options.params);
  options.agent.peer.notify(options.method, parsedParams as any);
}

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

      await requestOk({
        agent,
        method: 'initialize',
        requestSchema: MethodSchemas.InitializeRequestSchema,
        responseSchema: MethodSchemas.InitializeResponseSchema,
        params: defaultInitializeParams(),
        label: 'init',
      });

      const catalog = await requestOk<{ providers: Array<{ id: string; models: unknown[] }> }>({
        agent,
        method: 'ent/providers/catalog',
        requestSchema: MethodSchemas.EntProvidersCatalogRequestSchema,
        responseSchema: MethodSchemas.EntProvidersCatalogResponseSchema,
        label: 'providers/catalog',
      });
      expect(catalog.providers.length).toBeGreaterThan(0);
      expect(Array.isArray(catalog.providers[0]?.models)).toBe(true);

      // providers list
      const { providers } = await requestOk<{
        providers: Array<{ providerId: string; displayName?: string }>;
      }>({
        agent,
        method: 'ent/providers/list',
        requestSchema: MethodSchemas.EntProvidersListRequestSchema,
        responseSchema: MethodSchemas.EntProvidersListResponseSchema,
        label: 'providers/list',
      });
      expect(providers.length).toBeGreaterThan(0);

      const providerId =
        providers.find((p) => p.providerId === 'openai')?.providerId ?? providers[0].providerId;

      // connections upsert
      const { connectionId } = await requestOk<{ connectionId: string }>({
        agent,
        method: 'ent/connections/upsert',
        requestSchema: MethodSchemas.EntConnectionsUpsertRequestSchema,
        responseSchema: MethodSchemas.EntConnectionsUpsertResponseSchema,
        params: { providerId, connection: { name: 'ent-spec', config: {} } },
        label: 'connections/upsert',
      });
      expect(connectionId).toBeTruthy();

      // models list
      const modelsResp = await requestOk<{
        providerId: string;
        models: Array<{
          modelId: string;
          disabled?: boolean;
          disabledState?: 'enabled' | 'disabled';
        }>;
      }>({
        agent,
        method: 'ent/models/list',
        requestSchema: MethodSchemas.EntModelsListRequestSchema,
        responseSchema: MethodSchemas.EntModelsListResponseSchema,
        params: { connectionId },
        label: 'models/list',
      });
      expect(modelsResp.providerId).toBe(providerId);
      expect(modelsResp.models.length).toBeGreaterThan(0);
      expect(modelsResp.models[0]?.disabledState).toBeDefined();

      const targetModel = modelsResp.models[0].modelId;

      // disable + verify disabled flag appears
      await requestOk({
        agent,
        method: 'ent/models/disable',
        requestSchema: MethodSchemas.EntModelsDisableRequestSchema,
        responseSchema: MethodSchemas.EntModelsDisableResponseSchema,
        params: { providerId, modelIds: [targetModel] },
        label: 'models/disable',
      });
      const afterDisable = await requestOk<{
        models: Array<{
          modelId: string;
          disabled?: boolean;
          disabledState?: 'enabled' | 'disabled';
        }>;
      }>({
        agent,
        method: 'ent/models/list',
        requestSchema: MethodSchemas.EntModelsListRequestSchema,
        responseSchema: MethodSchemas.EntModelsListResponseSchema,
        params: { connectionId },
        label: 'models/list after disable',
      });
      const disabledEntry = afterDisable.models.find((m) => m.modelId === targetModel);
      expect(disabledEntry?.disabled).toBe(true);
      expect(disabledEntry?.disabledState).toBe('disabled');

      // configure session with env + approvalMode
      const { sessionId } = await requestOk<{ sessionId: string }>({
        agent,
        method: 'session/new',
        requestSchema: MethodSchemas.SessionNewRequestSchema,
        responseSchema: MethodSchemas.SessionNewResponseSchema,
        params: { workDir },
        label: 'session/new',
      });
      expect(sessionId).toBeTruthy();

      const configureResult = await requestOk<{
        applied: string[];
        config: Record<string, unknown>;
      }>({
        agent,
        method: 'ent/session/configure',
        requestSchema: MethodSchemas.EntSessionConfigureRequestSchema,
        responseSchema: MethodSchemas.EntSessionConfigureResponseSchema,
        params: {
          connectionId,
          modelId: targetModel,
          environment: { HELLO: 'WORLD' },
          approvalMode: 'approveReads',
        },
        label: 'session/configure',
      });

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
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    const { providers } = await requestOk<{ providers: ProviderInfo[] }>({
      agent,
      method: 'ent/providers/list',
      requestSchema: MethodSchemas.EntProvidersListRequestSchema,
      responseSchema: MethodSchemas.EntProvidersListResponseSchema,
      label: 'providers/list',
    });
    const providerId =
      providers.find((p) => p.providerId === 'openai')?.providerId ?? providers[0].providerId;

    const { connectionId } = await requestOk<{ connectionId: string }>({
      agent,
      method: 'ent/connections/upsert',
      requestSchema: MethodSchemas.EntConnectionsUpsertRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsUpsertResponseSchema,
      params: { providerId, connection: { name: 'race', config: {} } },
      label: 'connections/upsert',
    });

    // Race refresh against list. This used to intermittently return Unknown providerId.
    const [models] = await Promise.all([
      requestOk<{ providerId: string; models: Array<{ modelId: string }> }>({
        agent,
        method: 'ent/models/list',
        requestSchema: MethodSchemas.EntModelsListRequestSchema,
        responseSchema: MethodSchemas.EntModelsListResponseSchema,
        params: { connectionId },
        label: 'models/list',
      }),
      requestOk({
        agent,
        method: 'ent/providers/refresh',
        requestSchema: MethodSchemas.EntProvidersRefreshRequestSchema,
        responseSchema: MethodSchemas.EntProvidersRefreshResponseSchema,
        params: {},
        label: 'providers/refresh',
      }),
    ]);

    expect(models.providerId).toBeTruthy();
    expect(models.models.length).toBeGreaterThan(0);
  });

  it('returns structured error for unknown provider refresh and models list invalid conn', async () => {
    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    const providers = await requestOk<{ providers: ProviderInfo[] }>({
      agent,
      method: 'ent/providers/list',
      requestSchema: MethodSchemas.EntProvidersListRequestSchema,
      responseSchema: MethodSchemas.EntProvidersListResponseSchema,
      label: 'providers/list',
    });
    const knownProvider = providers.providers[0]!.providerId;

    const refreshOk = await requestOk<{ ok: boolean; refreshedAt: string }>({
      agent,
      method: 'ent/providers/refresh',
      requestSchema: MethodSchemas.EntProvidersRefreshRequestSchema,
      responseSchema: MethodSchemas.EntProvidersRefreshResponseSchema,
      params: { providerId: knownProvider },
      label: 'providers/refresh known',
    });
    expect(refreshOk.ok).toBe(true);
    expect(new Date(refreshOk.refreshedAt).toString()).not.toBe('Invalid Date');

    const refresh = await requestOk<{ ok: boolean; error?: string }>({
      agent,
      method: 'ent/providers/refresh',
      requestSchema: MethodSchemas.EntProvidersRefreshRequestSchema,
      responseSchema: MethodSchemas.EntProvidersRefreshResponseSchema,
      params: { providerId: 'does-not-exist' },
      label: 'providers/refresh',
    });
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
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    const { sessionId } = await requestOk<{ sessionId: string }>({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });
    expect(sessionId).toBeTruthy();

    const configuredMissing = await requestOk<{ applied: string[] }>({
      agent,
      method: 'ent/session/configure',
      requestSchema: MethodSchemas.EntSessionConfigureRequestSchema,
      responseSchema: MethodSchemas.EntSessionConfigureResponseSchema,
      params: { connectionId: 'missing', modelId: 'foo' },
      label: 'session/configure missing',
    });
    expect(configuredMissing.applied).toEqual(expect.arrayContaining(['connectionId', 'modelId']));

    const { providers } = await requestOk<{ providers: ProviderInfo[] }>({
      agent,
      method: 'ent/providers/list',
      requestSchema: MethodSchemas.EntProvidersListRequestSchema,
      responseSchema: MethodSchemas.EntProvidersListResponseSchema,
      label: 'providers/list',
    });
    const providerId =
      providers.find((p) => p.providerId === 'openai')?.providerId ?? providers[0].providerId;

    const { connectionId } = await requestOk<{ connectionId: string }>({
      agent,
      method: 'ent/connections/upsert',
      requestSchema: MethodSchemas.EntConnectionsUpsertRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsUpsertResponseSchema,
      params: { providerId, connection: { name: 'cfg-validate', config: {} } },
      label: 'connections/upsert',
    });

    const { models } = await requestOk<{ models: Array<{ modelId: string }> }>({
      agent,
      method: 'ent/models/list',
      requestSchema: MethodSchemas.EntModelsListRequestSchema,
      responseSchema: MethodSchemas.EntModelsListResponseSchema,
      params: { connectionId },
      label: 'models/list',
    });

    const validModel = models[0].modelId;

    const ok = await requestOk<{ applied: string[] }>({
      agent,
      method: 'ent/session/configure',
      requestSchema: MethodSchemas.EntSessionConfigureRequestSchema,
      responseSchema: MethodSchemas.EntSessionConfigureResponseSchema,
      params: { connectionId, modelId: validModel },
      label: 'session/configure valid',
    });
    expect(ok.applied).toEqual(expect.arrayContaining(['connectionId', 'modelId']));
  });

  it('ent/session/token_usage and ent/session/context_breakdown return context metrics', async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams({ approvalMode: 'approve' }),
      label: 'initialize',
    });
    await requestOk({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir: laceDir },
      label: 'session/new',
    });

    const { providers } = await requestOk<{ providers: ProviderInfo[] }>({
      agent,
      method: 'ent/providers/list',
      requestSchema: MethodSchemas.EntProvidersListRequestSchema,
      responseSchema: MethodSchemas.EntProvidersListResponseSchema,
      label: 'providers/list',
    });
    const providerId =
      providers.find((p) => p.providerId === 'openai')?.providerId ?? providers[0].providerId;

    const { connectionId } = await requestOk<{ connectionId: string }>({
      agent,
      method: 'ent/connections/upsert',
      requestSchema: MethodSchemas.EntConnectionsUpsertRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsUpsertResponseSchema,
      params: { providerId, connection: { name: 'token-usage', config: {} } },
      label: 'connections/upsert',
    });

    const credential = await requestOk<{ ok: boolean }>({
      agent,
      method: 'ent/connections/credentials/submit',
      requestSchema: MethodSchemas.EntConnectionsCredentialsSubmitRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsCredentialsSubmitResponseSchema,
      params: { connectionId, values: { apiKey: 'sk-test' } },
      label: 'credentials/submit',
    });
    expect(credential.ok).toBe(true);

    const { models } = await requestOk<{ models: Array<{ modelId: string }> }>({
      agent,
      method: 'ent/models/list',
      requestSchema: MethodSchemas.EntModelsListRequestSchema,
      responseSchema: MethodSchemas.EntModelsListResponseSchema,
      params: { connectionId },
      label: 'models/list',
    });
    const modelId = models[0].modelId;

    await requestOk({
      agent,
      method: 'ent/session/configure',
      requestSchema: MethodSchemas.EntSessionConfigureRequestSchema,
      responseSchema: MethodSchemas.EntSessionConfigureResponseSchema,
      params: { connectionId, modelId, approvalMode: 'approve' },
      label: 'session/configure',
    });

    const initialUsage = await requestOk<Record<string, unknown>>({
      agent,
      method: 'ent/session/token_usage',
      requestSchema: MethodSchemas.EntSessionTokenUsageRequestSchema,
      responseSchema: MethodSchemas.EntSessionTokenUsageResponseSchema,
      params: {},
      label: 'session/token_usage (initial)',
    });

    const initialBreakdown = await requestOk<Record<string, unknown>>({
      agent,
      method: 'ent/session/context_breakdown',
      requestSchema: MethodSchemas.EntSessionContextBreakdownRequestSchema,
      responseSchema: MethodSchemas.EntSessionContextBreakdownResponseSchema,
      params: {},
      label: 'session/context_breakdown (initial)',
    });

    const prompt = await requestOk<{ usage: { inputTokens: number; outputTokens: number } }>({
      agent,
      method: 'session/prompt',
      requestSchema: MethodSchemas.SessionPromptRequestSchema,
      responseSchema: MethodSchemas.SessionPromptResponseSchema,
      params: { content: [{ type: 'text', text: 'hello' }] },
      timeoutMs: 10_000,
      label: 'session/prompt',
    });
    expect(prompt.usage.inputTokens + prompt.usage.outputTokens).toBeGreaterThan(0);

    const laterUsage = await requestOk<Record<string, unknown>>({
      agent,
      method: 'ent/session/token_usage',
      requestSchema: MethodSchemas.EntSessionTokenUsageRequestSchema,
      responseSchema: MethodSchemas.EntSessionTokenUsageResponseSchema,
      params: {},
      label: 'session/token_usage (later)',
    });
    expect((laterUsage as any).totalTokens).toBeGreaterThanOrEqual(
      (initialUsage as any).totalTokens
    );

    const laterBreakdown = await requestOk<Record<string, unknown>>({
      agent,
      method: 'ent/session/context_breakdown',
      requestSchema: MethodSchemas.EntSessionContextBreakdownRequestSchema,
      responseSchema: MethodSchemas.EntSessionContextBreakdownResponseSchema,
      params: {},
      label: 'session/context_breakdown (later)',
    });
    expect((laterBreakdown as any).totalUsedTokens).toBeGreaterThanOrEqual(
      (initialBreakdown as any).totalUsedTokens
    );
  });

  it('supports connection listing, credential start/submit, and provider filter', async () => {
    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    const providers = await requestOk<{ providers: ProviderInfo[] }>({
      agent,
      method: 'ent/providers/list',
      requestSchema: MethodSchemas.EntProvidersListRequestSchema,
      responseSchema: MethodSchemas.EntProvidersListResponseSchema,
      label: 'providers/list',
    });
    const providerId = providers.providers[0]!.providerId;

    const { connectionId } = await requestOk<{ connectionId: string }>({
      agent,
      method: 'ent/connections/upsert',
      requestSchema: MethodSchemas.EntConnectionsUpsertRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsUpsertResponseSchema,
      params: { providerId, connection: { name: 'conn-for-cred', config: {} } },
      label: 'connections/upsert',
    });

    const credStart = await requestOk<{
      kind?: string;
      fields?: Array<{ name: string; secret?: boolean }>;
    }>({
      agent,
      method: 'ent/connections/credentials/start',
      requestSchema: MethodSchemas.EntConnectionsCredentialsStartRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsCredentialsStartResponseSchema,
      params: { connectionId },
      label: 'credentials/start',
    });
    expect(credStart.kind === undefined || credStart.kind === 'needs_input').toBe(true);

    const credSubmit = await requestOk<{ ok: boolean }>({
      agent,
      method: 'ent/connections/credentials/submit',
      requestSchema: MethodSchemas.EntConnectionsCredentialsSubmitRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsCredentialsSubmitResponseSchema,
      params: { connectionId, values: { apiKey: 'sk-test' } },
      label: 'credentials/submit',
    });
    expect(credSubmit.ok).toBe(true);

    const listAll = await requestOk<{ connections: ConnectionInfo[] }>({
      agent,
      method: 'ent/connections/list',
      requestSchema: MethodSchemas.EntConnectionsListRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsListResponseSchema,
      params: {},
      label: 'connections/list',
    });
    expect(listAll.connections.find((c) => c.connectionId === connectionId)).toBeDefined();

    const listFiltered = await requestOk<{ connections: ConnectionInfo[] }>({
      agent,
      method: 'ent/connections/list',
      requestSchema: MethodSchemas.EntConnectionsListRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsListResponseSchema,
      params: { providerId },
      label: 'connections/list filter',
    });
    expect(listFiltered.connections.every((c) => c.providerId === providerId)).toBe(true);

    // clear credentials, then delete connection
    const clear = await requestOk<{ ok: boolean }>({
      agent,
      method: 'ent/connections/credentials/clear',
      requestSchema: MethodSchemas.EntConnectionsCredentialsClearRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsCredentialsClearResponseSchema,
      params: { connectionId },
      label: 'credentials/clear',
    });
    expect(clear.ok).toBe(true);

    const deleted = await requestOk<{ ok: boolean }>({
      agent,
      method: 'ent/connections/delete',
      requestSchema: MethodSchemas.EntConnectionsDeleteRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsDeleteResponseSchema,
      params: { connectionId },
      label: 'connections/delete',
    });
    expect(deleted.ok).toBe(true);

    await expect(agent.peer.request('ent/models/list', { connectionId })).rejects.toMatchObject({
      code: 14,
      message: 'ConnectionNotFound',
    });
  });

  it('persists model gating across restart and supports tools/personas listing', async () => {
    const providerContext = await (async () => {
      agent = spawnAgentProcess({ laceDir });
      await requestOk({
        agent,
        method: 'initialize',
        requestSchema: MethodSchemas.InitializeRequestSchema,
        responseSchema: MethodSchemas.InitializeResponseSchema,
        params: defaultInitializeParams(),
        label: 'init',
      });
      const { providers } = await requestOk<{ providers: ProviderInfo[] }>({
        agent,
        method: 'ent/providers/list',
        requestSchema: MethodSchemas.EntProvidersListRequestSchema,
        responseSchema: MethodSchemas.EntProvidersListResponseSchema,
        label: 'providers/list',
      });
      expect(providers.length).toBeGreaterThan(0);
      const providerId = providers[0].providerId;
      const { connectionId } = await requestOk<{ connectionId: string }>({
        agent,
        method: 'ent/connections/upsert',
        requestSchema: MethodSchemas.EntConnectionsUpsertRequestSchema,
        responseSchema: MethodSchemas.EntConnectionsUpsertResponseSchema,
        params: { providerId, connection: { name: 'gating-test', config: {} } },
        label: 'connections/upsert',
      });
      const { models } = await requestOk<{ models: Array<{ modelId: string }> }>({
        agent,
        method: 'ent/models/list',
        requestSchema: MethodSchemas.EntModelsListRequestSchema,
        responseSchema: MethodSchemas.EntModelsListResponseSchema,
        params: { connectionId },
        label: 'models/list',
      });
      const target = models[0].modelId;
      await requestOk({
        agent,
        method: 'ent/models/disable',
        requestSchema: MethodSchemas.EntModelsDisableRequestSchema,
        responseSchema: MethodSchemas.EntModelsDisableResponseSchema,
        params: { providerId, modelIds: [target] },
        label: 'models/disable',
      });

      // invalid modelId should error with InvalidParams code
      await expect(
        agent.peer.request('ent/models/enable', { providerId, modelIds: ['nope'] })
      ).rejects.toMatchObject({ code: -32602 });

      await agent.shutdown();
      agent = undefined;
      return { providerId, connectionId, targetModel: target };
    })();

    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });
    const afterDisable = await requestOk<{
      models: Array<{
        modelId: string;
        disabled?: boolean;
        disabledState?: 'enabled' | 'disabled';
      }>;
    }>({
      agent,
      method: 'ent/models/list',
      requestSchema: MethodSchemas.EntModelsListRequestSchema,
      responseSchema: MethodSchemas.EntModelsListResponseSchema,
      params: { connectionId: providerContext.connectionId },
      label: 'models/list after restart',
    });
    const entry = afterDisable.models.find((m) => m.modelId === providerContext.targetModel);
    expect(entry?.disabled).toBe(true);
    expect(entry?.disabledState).toBe('disabled');

    const tools = await requestOk<{ tools: Array<{ name: string }> }>({
      agent,
      method: 'ent/tools/list',
      requestSchema: MethodSchemas.EntToolsListRequestSchema,
      responseSchema: MethodSchemas.EntToolsListResponseSchema,
      params: {},
      label: 'tools/list',
    });
    expect(new Set(tools.tools.map((t) => t.name)).size).toBe(tools.tools.length);

    const personas = await requestOk<{ personas: Array<{ id: string; name: string }> }>({
      agent,
      method: 'ent/personas/list',
      requestSchema: MethodSchemas.EntPersonasListRequestSchema,
      responseSchema: MethodSchemas.EntPersonasListResponseSchema,
      params: {},
      label: 'personas/list',
    });
    expect(personas.personas).toBeDefined();
  });

  it('validates session/configure params for env and mcpServers', async () => {
    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });
    const { sessionId } = await requestOk<{ sessionId: string }>({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });
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
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });
    await requestOk({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });

    await expect(
      agent.peer.request('session/prompt', { content: [{ type: 'text', text: 'hi' }] })
    ).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining('connectionId'),
      data: { category: 'protocol' },
    });
  });

  it('covers agent ping/status, models refresh, jobs list empty', async () => {
    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    const ping = await requestOk<{ ok: boolean; timestamp: string }>({
      agent,
      method: 'ent/agent/ping',
      requestSchema: MethodSchemas.EntAgentPingRequestSchema,
      responseSchema: MethodSchemas.EntAgentPingResponseSchema,
      label: 'agent/ping',
    });
    expect(ping.ok).toBe(true);
    expect(new Date(ping.timestamp).toString()).not.toBe('Invalid Date');

    const { providers } = await requestOk<{ providers: ProviderInfo[] }>({
      agent,
      method: 'ent/providers/list',
      requestSchema: MethodSchemas.EntProvidersListRequestSchema,
      responseSchema: MethodSchemas.EntProvidersListResponseSchema,
      label: 'providers/list',
    });
    const providerId = providers[0].providerId;
    const { connectionId } = await requestOk<{ connectionId: string }>({
      agent,
      method: 'ent/connections/upsert',
      requestSchema: MethodSchemas.EntConnectionsUpsertRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsUpsertResponseSchema,
      params: { providerId, connection: { name: 'status-test', config: {} } },
      label: 'connections/upsert',
    });
    const { models } = await requestOk<{ models: Array<{ modelId: string }> }>({
      agent,
      method: 'ent/models/list',
      requestSchema: MethodSchemas.EntModelsListRequestSchema,
      responseSchema: MethodSchemas.EntModelsListResponseSchema,
      params: { connectionId },
      label: 'models/list',
    });
    const modelId = models[0].modelId;

    const refresh = await requestOk<{ ok: boolean; refreshedAt: string }>({
      agent,
      method: 'ent/models/refresh',
      requestSchema: MethodSchemas.EntModelsRefreshRequestSchema,
      responseSchema: MethodSchemas.EntModelsRefreshResponseSchema,
      params: { connectionId },
      label: 'models/refresh',
    });
    expect(refresh.ok).toBe(true);

    const { sessionId } = await requestOk<{ sessionId: string }>({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });
    expect(sessionId).toBeTruthy();

    await requestOk({
      agent,
      method: 'ent/session/configure',
      requestSchema: MethodSchemas.EntSessionConfigureRequestSchema,
      responseSchema: MethodSchemas.EntSessionConfigureResponseSchema,
      params: { connectionId, modelId, environment: { FOO: 'BAR' } },
      label: 'session/configure',
    });

    const status = await requestOk<{
      currentSession?: { connectionId?: string; modelId?: string };
      limits?: { maxBudgetUsd?: number };
    }>({
      agent,
      method: 'ent/agent/status',
      requestSchema: MethodSchemas.EntAgentStatusRequestSchema,
      responseSchema: MethodSchemas.EntAgentStatusResponseSchema,
      label: 'agent/status',
    });
    expect(status.currentSession?.connectionId).toBe(connectionId);
    expect(status.currentSession?.modelId).toBe(modelId);

    const jobs = await requestOk<{ jobs: unknown[] }>({
      agent,
      method: 'ent/job/list',
      requestSchema: MethodSchemas.EntJobListRequestSchema,
      responseSchema: MethodSchemas.EntJobListResponseSchema,
      label: 'job/list',
    });
    expect(Array.isArray(jobs.jobs)).toBe(true);

    const jobsAgain = await requestOk<{ jobs: unknown[] }>({
      agent,
      method: 'ent/job/list',
      requestSchema: MethodSchemas.EntJobListRequestSchema,
      responseSchema: MethodSchemas.EntJobListResponseSchema,
      label: 'job/list again',
    });
    expect(Array.isArray(jobsAgain.jobs)).toBe(true);
  });

  it('covers job output pagination, blocking, and kill success for shell jobs', async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    await requestOk({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });

    await requestOk({
      agent,
      method: 'ent/session/configure',
      requestSchema: MethodSchemas.EntSessionConfigureRequestSchema,
      responseSchema: MethodSchemas.EntSessionConfigureResponseSchema,
      params: { approvalMode: 'approve' },
      label: 'session/configure approve',
    });

    // Create a short job with a predictable, multi-line output.
    await requestOk({
      agent,
      method: 'session/prompt',
      requestSchema: MethodSchemas.SessionPromptRequestSchema,
      responseSchema: MethodSchemas.SessionPromptResponseSchema,
      params: {
        content: [
          {
            type: 'text',
            text: 'job: i=0; while [ $i -lt 200 ]; do echo "line-$i"; i=$((i+1)); done',
          },
        ],
      },
      label: 'prompt job lines',
    });

    const listAfterStart = await requestOk<{
      jobs: Array<{ jobId: string; type: string; status: string; command?: string }>;
    }>({
      agent,
      method: 'ent/job/list',
      requestSchema: MethodSchemas.EntJobListRequestSchema,
      responseSchema: MethodSchemas.EntJobListResponseSchema,
      label: 'job/list after start',
    });
    const jobId = listAfterStart.jobs.find((j) => j.type === 'bash')?.jobId;
    expect(jobId).toBeTruthy();

    const full = await requestOk<{
      status: string;
      output: string;
      outputMeta?: {
        totalBytes: number;
        returnedOffset: number;
        returnedBytes: number;
        truncated: boolean;
      };
    }>({
      agent,
      method: 'ent/job/output',
      requestSchema: MethodSchemas.EntJobOutputRequestSchema,
      responseSchema: MethodSchemas.EntJobOutputResponseSchema,
      params: { jobId: jobId!, block: true, timeout: 5_000 },
      label: 'job/output full',
      timeoutMs: 6_000,
    });
    expect(full.status).toBe('completed');
    expect(full.output).toContain('line-0');
    expect(full.output).toContain('line-199');
    expect(full.outputMeta?.totalBytes).toBeGreaterThan(0);

    const tail = await requestOk<{
      status: string;
      output: string;
      outputMeta?: { returnedOffset: number; truncated: boolean };
    }>({
      agent,
      method: 'ent/job/output',
      requestSchema: MethodSchemas.EntJobOutputRequestSchema,
      responseSchema: MethodSchemas.EntJobOutputResponseSchema,
      params: { jobId: jobId!, tailBytes: 80 },
      label: 'job/output tail',
    });
    expect(tail.status).toBe('completed');
    expect(tail.output).toContain('line-199');
    expect(tail.output).not.toContain('line-0');
    expect(tail.outputMeta?.truncated).toBe(true);

    // Create a longer-running job to exercise block+timeout and kill.
    await requestOk({
      agent,
      method: 'session/prompt',
      requestSchema: MethodSchemas.SessionPromptRequestSchema,
      responseSchema: MethodSchemas.SessionPromptResponseSchema,
      params: {
        content: [{ type: 'text', text: 'job: echo start; sleep 5; echo end' }],
      },
      label: 'prompt job sleep',
    });

    const listForKill = await requestOk<{
      jobs: Array<{ jobId: string; type: string; status: string }>;
    }>({
      agent,
      method: 'ent/job/list',
      requestSchema: MethodSchemas.EntJobListRequestSchema,
      responseSchema: MethodSchemas.EntJobListResponseSchema,
      label: 'job/list for kill',
    });
    const sleepJobId = listForKill.jobs.find(
      (j) => j.type === 'bash' && j.status === 'running'
    )?.jobId;
    expect(sleepJobId).toBeTruthy();

    let sawStart = false;
    for (let i = 0; i < 50; i++) {
      const probe = await requestOk<{ status: string; output: string }>({
        agent,
        method: 'ent/job/output',
        requestSchema: MethodSchemas.EntJobOutputRequestSchema,
        responseSchema: MethodSchemas.EntJobOutputResponseSchema,
        params: { jobId: sleepJobId! },
        label: 'job/output probe',
      });
      if (probe.status !== 'running') break;
      if (probe.output.includes('start')) {
        sawStart = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(sawStart).toBe(true);

    const killed = await requestOk<{ success: boolean }>({
      agent,
      method: 'ent/job/kill',
      requestSchema: MethodSchemas.EntJobKillRequestSchema,
      responseSchema: MethodSchemas.EntJobKillResponseSchema,
      params: { jobId: sleepJobId! },
      label: 'job/kill running',
    });
    expect(killed.success).toBe(true);

    let finalStatus: string | undefined;
    for (let i = 0; i < 50; i++) {
      const out = await requestOk<{ status: string }>({
        agent,
        method: 'ent/job/output',
        requestSchema: MethodSchemas.EntJobOutputRequestSchema,
        responseSchema: MethodSchemas.EntJobOutputResponseSchema,
        params: { jobId: sleepJobId!, block: true, timeout: 200 },
        label: 'job/output after kill',
        timeoutMs: 1_000,
      });
      if (out.status !== 'running') {
        finalStatus = out.status;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(finalStatus).toBe('cancelled');
  });

  it('covers job output/kill errors and checkpoint/rewind/compact validation', async () => {
    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });
    const { sessionId } = await requestOk<{ sessionId: string }>({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });
    expect(sessionId).toBeTruthy();

    // Job output/kill on unknown job
    await expect(
      agent.peer.request('ent/job/output', { jobId: 'missing-job' })
    ).rejects.toMatchObject({ code: 8, message: 'JobNotFound' });
    const kill = await requestOk<{ success: boolean }>({
      agent,
      method: 'ent/job/kill',
      requestSchema: MethodSchemas.EntJobKillRequestSchema,
      responseSchema: MethodSchemas.EntJobKillResponseSchema,
      params: { jobId: 'missing-job' },
      label: 'job/kill missing',
    });
    expect(kill.success).toBe(false);

    // checkpoint and rewind invalid id
    const checkpoint = await requestOk<{ checkpointId: string; eventSeq: number }>({
      agent,
      method: 'ent/session/checkpoint',
      requestSchema: MethodSchemas.EntSessionCheckpointRequestSchema,
      responseSchema: MethodSchemas.EntSessionCheckpointResponseSchema,
      params: { label: 'test' },
      label: 'session/checkpoint',
    });
    expect(checkpoint.checkpointId).toBeTruthy();
    expect(typeof checkpoint.eventSeq).toBe('number');

    // add a non-checkpoint event to advance eventSeq without a checkpoint
    await requestNotificationOk({
      agent,
      method: 'ent/session/inject',
      notificationSchema: MethodSchemas.EntSessionInjectNotificationSchema,
      params: { content: [{ type: 'text', text: 'ctx' }], priority: 'normal' },
      label: 'session/inject',
    });

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
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });
    const { providers } = await requestOk<{ providers: ProviderInfo[] }>({
      agent,
      method: 'ent/providers/list',
      requestSchema: MethodSchemas.EntProvidersListRequestSchema,
      responseSchema: MethodSchemas.EntProvidersListResponseSchema,
      label: 'providers/list',
    });
    const providerId = providers[0].providerId;
    const { connectionId } = await requestOk<{ connectionId: string }>({
      agent,
      method: 'ent/connections/upsert',
      requestSchema: MethodSchemas.EntConnectionsUpsertRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsUpsertResponseSchema,
      params: { providerId, connection: { name: 'struct-out', config: {} } },
      label: 'connections/upsert',
    });
    const { models } = await requestOk<{ models: Array<{ modelId: string }> }>({
      agent,
      method: 'ent/models/list',
      requestSchema: MethodSchemas.EntModelsListRequestSchema,
      responseSchema: MethodSchemas.EntModelsListResponseSchema,
      params: { connectionId },
      label: 'models/list',
    });
    const modelId = models[0].modelId;

    await requestOk({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });
    await requestOk({
      agent,
      method: 'ent/session/configure',
      requestSchema: MethodSchemas.EntSessionConfigureRequestSchema,
      responseSchema: MethodSchemas.EntSessionConfigureResponseSchema,
      params: { connectionId, modelId },
      label: 'session/configure',
    });

    await expect(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'hi' }],
        outputFormat: { type: 'json_schema', schema: 'not-an-object' },
      })
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('covers ent/session/events filtering and pagination', async () => {
    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    await requestOk({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });

    const checkpoint = await requestOk<{ checkpointId: string; eventSeq: number }>({
      agent,
      method: 'ent/session/checkpoint',
      requestSchema: MethodSchemas.EntSessionCheckpointRequestSchema,
      responseSchema: MethodSchemas.EntSessionCheckpointResponseSchema,
      params: { label: 'evt' },
      label: 'session/checkpoint',
    });
    expect(checkpoint.checkpointId).toBeTruthy();
    expect(typeof checkpoint.eventSeq).toBe('number');

    const all = await requestOk<{
      events: Array<{ eventSeq: number; type: string }>;
      nextCursor?: number;
    }>({
      agent,
      method: 'ent/session/events',
      requestSchema: MethodSchemas.EntSessionEventsRequestSchema,
      responseSchema: MethodSchemas.EntSessionEventsResponseSchema,
      params: { limit: 50 },
      label: 'session/events',
    });
    expect(Array.isArray(all.events)).toBe(true);
    expect(all.events.length).toBeGreaterThan(0);

    const after = await requestOk<{ events: Array<{ eventSeq: number }> }>({
      agent,
      method: 'ent/session/events',
      requestSchema: MethodSchemas.EntSessionEventsRequestSchema,
      responseSchema: MethodSchemas.EntSessionEventsResponseSchema,
      params: { afterEventSeq: all.events[0].eventSeq, limit: 50 },
      label: 'session/events after',
    });
    expect(after.events.every((e) => e.eventSeq > all.events[0].eventSeq)).toBe(true);

    const checkpointEventType = (all as any).events?.find(
      (e: any) => e?.data?.checkpointId === checkpoint.checkpointId
    )?.type as string | undefined;
    expect(typeof checkpointEventType).toBe('string');

    const filtered = await requestOk<{ events: Array<{ type: string }> }>({
      agent,
      method: 'ent/session/events',
      requestSchema: MethodSchemas.EntSessionEventsRequestSchema,
      responseSchema: MethodSchemas.EntSessionEventsResponseSchema,
      params: { types: [checkpointEventType!], limit: 50 },
      label: 'session/events filtered',
    });
    expect(filtered.events.length).toBeGreaterThan(0);
    expect(new Set(filtered.events.map((e) => e.type))).toEqual(new Set([checkpointEventType]));
  });

  it('covers MCP server method error paths without active session', async () => {
    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    const list = await requestOk<{ servers: unknown[] }>({
      agent,
      method: 'ent/mcp/servers/list',
      requestSchema: MethodSchemas.EntMcpServersListRequestSchema,
      responseSchema: MethodSchemas.EntMcpServersListResponseSchema,
      params: {},
      label: 'mcp/servers/list',
    });
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
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

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
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    const { providers } = await requestOk<{ providers: ProviderInfo[] }>({
      agent,
      method: 'ent/providers/list',
      requestSchema: MethodSchemas.EntProvidersListRequestSchema,
      responseSchema: MethodSchemas.EntProvidersListResponseSchema,
      label: 'providers/list',
    });
    const providerId = providers[0].providerId;
    const { connectionId } = await requestOk<{ connectionId: string }>({
      agent,
      method: 'ent/connections/upsert',
      requestSchema: MethodSchemas.EntConnectionsUpsertRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsUpsertResponseSchema,
      params: { providerId, connection: { name: 'conn-test', config: {} } },
      label: 'connections/upsert',
    });

    const testResult = await requestOk<{ ok: boolean; error?: string; latencyMs?: number }>({
      agent,
      method: 'ent/connections/test',
      requestSchema: MethodSchemas.EntConnectionsTestRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsTestResponseSchema,
      params: { connectionId },
      label: 'connections/test',
    });
    expect(typeof testResult.ok).toBe('boolean');
    if (testResult.latencyMs !== undefined) expect(testResult.latencyMs).toBeGreaterThanOrEqual(0);
    if (testResult.ok === false) expect(typeof testResult.error).toBe('string');

    await requestOk({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });

    // No-op without a running subagent job (notification; should not throw).
    notifyOk({
      agent,
      method: 'ent/job/inject',
      notificationSchema: MethodSchemas.EntJobInjectNotificationSchema,
      params: { jobId: 'missing-job', content: [{ type: 'text', text: 'hi' }], priority: 'normal' },
    });
  });

  it('accepts $/cancel_request notification', async () => {
    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });
    await requestOk({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });

    notifyOk({
      agent,
      method: '$/cancel_request',
      notificationSchema: MethodSchemas.CancelRequestNotificationSchema,
      params: { requestId: 'c_1' },
    });

    const ping = await requestOk<{ ok: boolean }>({
      agent,
      method: 'ent/agent/ping',
      requestSchema: MethodSchemas.EntAgentPingRequestSchema,
      responseSchema: MethodSchemas.EntAgentPingResponseSchema,
      label: 'agent/ping',
    });
    expect(ping.ok).toBe(true);
  });

  it('supports credentials status and session list/load/fork/set_mode', async () => {
    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    const { providers } = await requestOk<{ providers: ProviderInfo[] }>({
      agent,
      method: 'ent/providers/list',
      requestSchema: MethodSchemas.EntProvidersListRequestSchema,
      responseSchema: MethodSchemas.EntProvidersListResponseSchema,
      label: 'providers/list',
    });
    const providerId =
      providers.find((p) => p.providerId === 'openai')?.providerId ?? providers[0].providerId;

    const { connectionId } = await requestOk<{ connectionId: string }>({
      agent,
      method: 'ent/connections/upsert',
      requestSchema: MethodSchemas.EntConnectionsUpsertRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsUpsertResponseSchema,
      params: { providerId, connection: { name: 'cred-status', config: {} } },
      label: 'connections/upsert',
    });

    const statusMissing = await requestOk<{ state: 'ready' | 'missing' }>({
      agent,
      method: 'ent/connections/credentials/status',
      requestSchema: MethodSchemas.EntConnectionsCredentialsStatusRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsCredentialsStatusResponseSchema,
      params: { connectionId },
      label: 'credentials/status missing',
    });
    expect(statusMissing.state).toBe('missing');

    await requestOk({
      agent,
      method: 'ent/connections/credentials/submit',
      requestSchema: MethodSchemas.EntConnectionsCredentialsSubmitRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsCredentialsSubmitResponseSchema,
      params: { connectionId, values: { apiKey: 'sk-test' } },
      label: 'credentials/submit',
    });

    const statusReady = await requestOk<{ state: 'ready' | 'missing' }>({
      agent,
      method: 'ent/connections/credentials/status',
      requestSchema: MethodSchemas.EntConnectionsCredentialsStatusRequestSchema,
      responseSchema: MethodSchemas.EntConnectionsCredentialsStatusResponseSchema,
      params: { connectionId },
      label: 'credentials/status ready',
    });
    expect(statusReady.state).toBe('ready');

    await expect(
      agent.peer.request('ent/connections/credentials/status', { connectionId: 'missing-conn' })
    ).rejects.toMatchObject({ code: 14, message: 'ConnectionNotFound' });

    const workDirA = join(workDir, 'a');
    const workDirB = join(workDir, 'b');
    mkdirSync(workDirA, { recursive: true });
    mkdirSync(workDirB, { recursive: true });

    const { sessionId: sessionA } = await requestOk<{ sessionId: string }>({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir: workDirA },
      label: 'session/new A',
    });

    const { sessionId: sessionB } = await requestOk<{ sessionId: string }>({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir: workDirB },
      label: 'session/new B',
    });

    const listAll = await requestOk<{ sessions: Array<{ sessionId: string; cwd: string }> }>({
      agent,
      method: 'session/list',
      requestSchema: MethodSchemas.SessionListRequestSchema,
      responseSchema: MethodSchemas.SessionListResponseSchema,
      params: {},
      label: 'session/list all',
    });
    expect(listAll.sessions.some((s) => s.sessionId === sessionA)).toBe(true);
    expect(listAll.sessions.some((s) => s.sessionId === sessionB)).toBe(true);

    const listFiltered = await requestOk<{ sessions: Array<{ sessionId: string; cwd: string }> }>({
      agent,
      method: 'session/list',
      requestSchema: MethodSchemas.SessionListRequestSchema,
      responseSchema: MethodSchemas.SessionListResponseSchema,
      params: { cwd: workDirA },
      label: 'session/list filtered',
    });
    expect(listFiltered.sessions.length).toBe(1);
    expect(listFiltered.sessions[0]).toMatchObject({ sessionId: sessionA, cwd: workDirA });

    // session/load establishes the active session (switching sessions is allowed when idle)
    const loaded = await requestOk<{ sessionId: string; messageCount: number; updatedAt: string }>({
      agent,
      method: 'session/load',
      requestSchema: MethodSchemas.SessionLoadRequestSchema,
      responseSchema: MethodSchemas.SessionLoadResponseSchema,
      params: { sessionId: sessionA },
      label: 'session/load A',
    }).catch((error) => {
      const message = (error as any)?.message ?? String(error);
      throw new Error(`session/load A failed: ${message}`);
    });
    expect(loaded.sessionId).toBe(sessionA);
    expect(typeof loaded.messageCount).toBe('number');
    expect(new Date(loaded.updatedAt).toString()).not.toBe('Invalid Date');

    try {
      await agent.peer.request('session/load', { sessionId: 'not-a-session-id' });
      throw new Error('expected InvalidParams');
    } catch (error) {
      expect(error).toMatchObject({ code: -32602, message: 'InvalidParams' });
    }

    try {
      await agent.peer.request('session/load', {
        sessionId: 'sess_00000000-0000-0000-0000-000000000000',
      });
      throw new Error('expected SessionNotFound');
    } catch (error) {
      expect(error).toMatchObject({ code: 1, message: 'SessionNotFound' });
    }

    const fork = await requestOk<{ sessionId: string; forkedFrom: string }>({
      agent,
      method: 'session/fork',
      requestSchema: MethodSchemas.SessionForkRequestSchema,
      responseSchema: MethodSchemas.SessionForkResponseSchema,
      params: { sessionId: sessionA, cwd: workDirB },
      label: 'session/fork',
    });
    expect(fork.sessionId).toBeTruthy();
    expect(fork.forkedFrom).toBe(sessionA);

    await requestOk({
      agent,
      method: 'session/load',
      requestSchema: MethodSchemas.SessionLoadRequestSchema,
      responseSchema: MethodSchemas.SessionLoadResponseSchema,
      params: { sessionId: fork.sessionId },
      label: 'load fork',
    }).catch((error) => {
      const message = (error as any)?.message ?? String(error);
      throw new Error(`session/load fork failed: ${message}`);
    });

    const { previousMode } = await requestOk<{ mode: string; previousMode: string }>({
      agent,
      method: 'session/set_mode',
      requestSchema: MethodSchemas.SessionSetModeRequestSchema,
      responseSchema: MethodSchemas.SessionSetModeResponseSchema,
      params: { mode: 'plan' },
      label: 'session/set_mode plan',
    }).catch((error) => {
      const message = (error as any)?.message ?? String(error);
      throw new Error(`session/set_mode failed: ${message}`);
    });
    expect(previousMode === 'plan' || previousMode === 'execute').toBe(true);
  });

  it('receives session/update notifications for context injection', async () => {
    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });
    await requestOk({
      agent,
      method: 'session/new',
      requestSchema: MethodSchemas.SessionNewRequestSchema,
      responseSchema: MethodSchemas.SessionNewResponseSchema,
      params: { workDir },
      label: 'session/new',
    });

    const update = await withTimeout(
      new Promise<any>((resolve) => {
        agent!.peer.onRequest('session/update', async (params) => {
          resolve(params);
          return undefined;
        });
        void requestNotificationOk({
          agent: agent!,
          method: 'ent/session/inject',
          notificationSchema: MethodSchemas.EntSessionInjectNotificationSchema,
          params: { content: [{ type: 'text', text: 'ctx' }], priority: 'normal' },
          label: 'session/inject',
        });
      }),
      2_000,
      'session/update'
    );

    expect(update).toMatchObject({ type: 'context_injected', priority: 'normal' });
  });

  it('reissues pending permission prompts via session/request_permission on session/load', async () => {
    const sessionId = 'sess_00000000-0000-0000-0000-000000000001';
    const sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });

    const created = new Date().toISOString();
    writeSessionMeta(sessionDir, { sessionId, workDir, created });

    ensureSessionFiles(sessionDir);
    let state = { nextEventSeq: 1, nextStreamSeq: 1, config: {} as Record<string, unknown> } as any;
    const toolCallId = 'tool_00000000-0000-0000-0000-000000000001';
    const requestedAt = new Date().toISOString();

    const appended = appendDurableEvent(sessionDir, state, {
      type: 'permission_requested',
      turnId: 'turn_00000000-0000-0000-0000-000000000001',
      data: {
        toolCallId,
        turnSeq: 1,
        tool: 'read_file',
        kind: 'file',
        resource: '/tmp/example.txt',
        options: [
          { optionId: 'allow', label: 'Allow' },
          { optionId: 'deny', label: 'Deny' },
        ],
        requestedAt,
        input: { path: '/tmp/example.txt' },
      },
    });
    state = appended.nextState;
    writeSessionState(sessionDir, state);

    agent = spawnAgentProcess({ laceDir });
    await requestOk({
      agent,
      method: 'initialize',
      requestSchema: MethodSchemas.InitializeRequestSchema,
      responseSchema: MethodSchemas.InitializeResponseSchema,
      params: defaultInitializeParams(),
      label: 'init',
    });

    const permissionRequest = await withTimeout(
      new Promise<any>((resolve) => {
        agent!.peer.onRequest('session/request_permission', async (params) => {
          resolve(params);
          return { decision: 'allow' };
        });
        void requestOk({
          agent: agent!,
          method: 'session/load',
          requestSchema: MethodSchemas.SessionLoadRequestSchema,
          responseSchema: MethodSchemas.SessionLoadResponseSchema,
          params: { sessionId },
          label: 'session/load',
        });
      }),
      5_000,
      'session/request_permission'
    );

    expect(permissionRequest).toMatchObject({
      sessionId,
      toolCallId,
      requestedAt,
      tool: 'read_file',
      resource: '/tmp/example.txt',
    });

    // Wait for the decision to be recorded durably.
    const events = await withTimeout(
      (async () => {
        for (let i = 0; i < 25; i++) {
          const result = await requestOk<{ events: any[] }>({
            agent: agent!,
            method: 'ent/session/events',
            requestSchema: MethodSchemas.EntSessionEventsRequestSchema,
            responseSchema: MethodSchemas.EntSessionEventsResponseSchema,
            params: { limit: 200 },
            label: 'session/events poll',
          });
          if (
            Array.isArray(result?.events) &&
            result.events.some((e: any) => e.type === 'permission_decided')
          ) {
            return result.events as any[];
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const finalResult = await requestOk<{ events: any[] }>({
          agent: agent!,
          method: 'ent/session/events',
          requestSchema: MethodSchemas.EntSessionEventsRequestSchema,
          responseSchema: MethodSchemas.EntSessionEventsResponseSchema,
          params: { limit: 200 },
          label: 'session/events final',
        });
        return finalResult;
      })(),
      2_000,
      'session/events'
    );

    const decided = (events as any[]).find((e: any) => e.type === 'permission_decided');
    expect(decided?.data?.toolCallId).toBe(toolCallId);
  });
});
