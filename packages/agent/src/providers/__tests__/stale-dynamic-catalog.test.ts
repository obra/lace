// ABOUTME: Verifies local model metadata and dynamic discovery behavior when a catalog cache
// ABOUTME: predates a model or contains inferred metadata and the upstream refresh fails.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import * as fs from 'fs';
import * as path from 'path';
import { ProviderRegistry } from '../registry';
import { ProviderInstanceManager } from '../instance/manager';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import type { CatalogModel, CatalogProvider, ProviderInstancesConfig } from '../catalog/types';
import { writeSseStream } from './anthropic-sse-stream';

const INSTANCE_ID = 'sen-anthropic';
const MODEL_ID = 'claude-opus-5-5';
const DAY_MS = 24 * 60 * 60 * 1000;

interface CapturedMessagesBody {
  max_tokens?: number;
  output_config?: { effort?: string };
}

/** Stands in for the Anthropic API: /models always fails, /messages is captured and streamed. */
function startFakeAnthropic(): Promise<{
  server: Server;
  baseURL: string;
  modelsRequests: string[];
  messagesBodies: CapturedMessagesBody[];
}> {
  const modelsRequests: string[] = [];
  const messagesBodies: CapturedMessagesBody[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const url = req.url ?? '';
      if (url.includes('/models')) {
        modelsRequests.push(url);
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error' } }));
        return;
      }
      messagesBodies.push(JSON.parse(body) as CapturedMessagesBody);
      writeSseStream(res, MODEL_ID);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('no address');
      resolve({ server, baseURL: `http://127.0.0.1:${addr.port}`, modelsRequests, messagesBodies });
    });
  });
}

function readShippedCatalog(catalogProviderId: string): CatalogProvider {
  const raw = fs.readFileSync(
    path.resolve(__dirname, `../catalog/data/${catalogProviderId}.json`),
    'utf8'
  );
  return JSON.parse(raw) as CatalogProvider;
}

function seedCache(
  models: CatalogModel[],
  fetchedAt: Date,
  catalogProviderId = 'anthropic',
  instanceId = INSTANCE_ID
): void {
  const catalogsDir = path.join(process.env.LACE_DIR!, 'catalogs');
  fs.mkdirSync(catalogsDir, { recursive: true });
  const provider: CatalogProvider = { ...readShippedCatalog(catalogProviderId), models };
  fs.writeFileSync(
    path.join(catalogsDir, `${catalogProviderId}-${instanceId}.json`),
    JSON.stringify({
      _meta: {
        fetchedAt: fetchedAt.toISOString(),
        version: '1.0',
        availableModelCount: models.length,
        source: 'https://api.anthropic.com/v1/models',
      },
      provider,
    })
  );
}

describe('a stale dynamic Anthropic catalog', () => {
  const _tempLaceDir = setupCoreTest();
  let fake: Awaited<ReturnType<typeof startFakeAnthropic>>;
  let previousDisableDynamic: string | undefined;
  let previousReasoningEffort: string | undefined;
  const opus5 = readShippedCatalog('anthropic').models.find((m) => m.id === 'claude-opus-5')!;

  beforeEach(async () => {
    // The runtime path: dynamic catalogs ON, effort from the catalog only.
    previousDisableDynamic = process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    previousReasoningEffort = process.env.LACE_REASONING_EFFORT;
    delete process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    delete process.env.LACE_REASONING_EFFORT;

    fake = await startFakeAnthropic();
    const instances: ProviderInstancesConfig = {
      version: '1.0',
      instances: {
        [INSTANCE_ID]: {
          displayName: 'Sen Anthropic',
          catalogProviderId: 'anthropic',
          endpoint: fake.baseURL,
        },
      },
    };
    fs.writeFileSync(
      path.join(process.env.LACE_DIR!, 'provider-instances.json'),
      JSON.stringify(instances, null, 2)
    );
    await new ProviderInstanceManager().saveCredential(INSTANCE_ID, { apiKey: 'sk-ant-test' });
    ProviderRegistry.clearInstance();
  });

  afterEach(async () => {
    ProviderRegistry.clearInstance();
    await new Promise<void>((resolve, reject) =>
      fake.server.close((err) => (err ? reject(err) : resolve()))
    );
    if (previousDisableDynamic === undefined) delete process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    else process.env.LACE_DISABLE_DYNAMIC_CATALOGS = previousDisableDynamic;
    if (previousReasoningEffort === undefined) delete process.env.LACE_REASONING_EFFORT;
    else process.env.LACE_REASONING_EFFORT = previousReasoningEffort;
  });

  async function expectShippedOpus55Metadata(): Promise<void> {
    const registry = ProviderRegistry.getInstance();
    await registry.ensureInitialized();
    const provider = await registry.createProviderFromInstanceAndModel(INSTANCE_ID, MODEL_ID);

    expect(provider.config.model).toBe(MODEL_ID);
    expect(provider.contextWindowForModel(MODEL_ID)).toBe(1_000_000);

    // Streaming, as the runtime does: the SDK refuses a non-streaming request
    // whose max_tokens implies more than ten minutes of output.
    await provider.createStreamingResponse([{ role: 'user', content: 'hi' }], [], MODEL_ID);
    expect(fake.messagesBodies).toHaveLength(1);
    expect(fake.messagesBodies[0].max_tokens).toBe(50_000);
    expect(fake.messagesBodies[0].output_config?.effort).toBe('medium');
  }

  it('uses shipped metadata without refreshing an expired catalog that omits the model', async () => {
    seedCache([opus5], new Date(Date.now() - 9 * DAY_MS));

    await expectShippedOpus55Metadata();
    expect(fake.modelsRequests).toHaveLength(0);
  });

  it('uses exact model metadata from a local Anthropic catalog override', async () => {
    const localModel = { ...opus5, id: 'claude-local-model', context_window: 123_456 };
    const userCatalogDir = path.join(process.env.LACE_DIR!, 'user-catalog');
    fs.mkdirSync(userCatalogDir, { recursive: true });
    fs.writeFileSync(
      path.join(userCatalogDir, 'anthropic.json'),
      JSON.stringify({ ...readShippedCatalog('anthropic'), models: [localModel] })
    );

    const registry = ProviderRegistry.getInstance();
    const provider = await registry.createProviderFromInstanceAndModel(INSTANCE_ID, localModel.id);

    expect(provider.config.model).toBe('claude-local-model');
    expect(provider.contextWindowForModel('claude-local-model')).toBe(123_456);
    expect(fake.modelsRequests).toHaveLength(0);
  });

  it('tries discovery for a dynamic-only model and falls back to the expired cache', async () => {
    const dynamicOnly: CatalogModel = {
      id: 'claude-dynamic-only',
      name: 'Claude Dynamic Only',
      context_window: 200_000,
      default_max_tokens: 32_000,
    };
    seedCache([dynamicOnly], new Date(Date.now() - 9 * DAY_MS));

    const registry = ProviderRegistry.getInstance();
    const provider = await registry.createProviderFromInstanceAndModel(INSTANCE_ID, dynamicOnly.id);

    expect(provider.config.model).toBe('claude-dynamic-only');
    expect(fake.modelsRequests).toHaveLength(1);
  });

  it('tries explicit refresh and upgrades inferred metadata when discovery fails', async () => {
    const inferred: CatalogModel = {
      id: MODEL_ID,
      name: 'Claude Opus 5.5',
      context_window: 200_000,
      default_max_tokens: 32_000,
    };
    seedCache([inferred], new Date());

    const registry = ProviderRegistry.getInstance();
    const catalog = await registry.getCatalogForInstance(INSTANCE_ID, true);

    expect(fake.modelsRequests).toHaveLength(1);
    expect(catalog?.models).toMatchObject([
      { id: MODEL_ID, context_window: 1_000_000, default_max_tokens: 50_000 },
    ]);
  });
});

describe('a fresh OpenAI dynamic catalog that predates a shipped model', () => {
  const _tempLaceDir = setupCoreTest();
  let previousDisableDynamic: string | undefined;

  beforeEach(async () => {
    previousDisableDynamic = process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    delete process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    const instances: ProviderInstancesConfig = {
      version: '1.0',
      instances: { 'sen-openai': { displayName: 'Sen OpenAI', catalogProviderId: 'openai' } },
    };
    fs.writeFileSync(
      path.join(process.env.LACE_DIR!, 'provider-instances.json'),
      JSON.stringify(instances, null, 2)
    );
    await new ProviderInstanceManager().saveCredential('sen-openai', { apiKey: 'sk-test' });
    ProviderRegistry.clearInstance();
  });

  afterEach(() => {
    ProviderRegistry.clearInstance();
    if (previousDisableDynamic === undefined) delete process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    else process.env.LACE_DISABLE_DYNAMIC_CATALOGS = previousDisableDynamic;
  });

  it('still gives the model the shipped metadata', async () => {
    const shipped = readShippedCatalog('openai').models;
    const gpt5 = shipped.find((m) => m.id === 'gpt-5')!;
    const gpt51 = shipped.find((m) => m.id === 'gpt-5.1')!;
    // Fresh, so the registry serves it without contacting the API.
    seedCache([gpt5], new Date(), 'openai', 'sen-openai');

    const registry = ProviderRegistry.getInstance();
    await registry.ensureInitialized();
    const provider = await registry.createProviderFromInstanceAndModel('sen-openai', 'gpt-5.1');

    expect(provider.contextWindowForModel('gpt-5.1')).toBe(gpt51.context_window);
    expect(provider.getAvailableModels().find((m) => m.id === 'gpt-5.1')?.maxOutputTokens).toBe(
      gpt51.default_max_tokens
    );
  });
});
