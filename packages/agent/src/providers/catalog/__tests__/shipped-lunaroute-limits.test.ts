// ABOUTME: Pins the LunaRoute models' context window, output limit and vision support in the
// ABOUTME: SHIPPED static catalog to what the gateway's GET /v1/models publishes, and checks
// ABOUTME: the real provider puts that output limit on the wire as max_output_tokens.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ProviderRegistry } from '../../registry';
import { ProviderInstanceManager } from '../../instance/manager';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import type { ProviderInstancesConfig } from '../types';

const LUNAROUTE_MODEL_IDS = ['deepseek-4.1-flash', 'deepseek-4.1-flash-background'];

// What the gateway's own GET /v1/models publishes for both ids (fetched 2026-09-24):
// context_window 1048576, max_output_tokens 262144, capabilities.vision true.
const LUNAROUTE_CONTEXT_WINDOW = 1_048_576;
const LUNAROUTE_MAX_OUTPUT_TOKENS = 262_144;

/** Stubs the fetch the OpenAI SDK sends through and records each request body. */
function stubResponsesEndpoint(): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: 'resp_1',
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'message',
              id: 'msg_1',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'ok', annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    })
  );
  return sent;
}

describe('shipped LunaRoute catalog limits', () => {
  const _tempLaceDir = setupCoreTest();
  let registry: ProviderRegistry;
  let previousDisableDynamic: string | undefined;

  beforeEach(async () => {
    // Static catalogs only: this pins what lace ships, not what a live gateway lists.
    previousDisableDynamic = process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    process.env.LACE_DISABLE_DYNAMIC_CATALOGS = '1';

    const instances: ProviderInstancesConfig = {
      version: '1.0',
      instances: {
        'sen-lunaroute': {
          displayName: 'Sen LunaRoute',
          catalogProviderId: 'lunaroute',
        },
      },
    };
    fs.writeFileSync(
      path.join(process.env.LACE_DIR!, 'provider-instances.json'),
      JSON.stringify(instances, null, 2)
    );
    await new ProviderInstanceManager().saveCredential('sen-lunaroute', {
      apiKey: 'test-lunaroute-key',
    });

    ProviderRegistry.clearInstance();
    registry = ProviderRegistry.getInstance();
    await registry.ensureInitialized();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ProviderRegistry.clearInstance();
    if (previousDisableDynamic === undefined) {
      delete process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    } else {
      process.env.LACE_DISABLE_DYNAMIC_CATALOGS = previousDisableDynamic;
    }
  });

  for (const modelId of LUNAROUTE_MODEL_IDS) {
    it(`pins the gateway-published limits and vision support for ${modelId}`, async () => {
      const provider = await registry.createProviderFromInstanceAndModel('sen-lunaroute', modelId);
      const model = provider.getAvailableModels().find((m) => m.id === modelId);

      expect(model?.contextWindow).toBe(LUNAROUTE_CONTEXT_WINDOW);
      expect(model?.maxOutputTokens).toBe(LUNAROUTE_MAX_OUTPUT_TOKENS);
      expect(model?.capabilities).toEqual(['attachments']);
      expect(provider.contextWindowForModel(modelId)).toBe(LUNAROUTE_CONTEXT_WINDOW);
    });

    it(`sends max_output_tokens ${LUNAROUTE_MAX_OUTPUT_TOKENS} on a ${modelId} request`, async () => {
      const provider = await registry.createProviderFromInstanceAndModel('sen-lunaroute', modelId);
      const sent = stubResponsesEndpoint();

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        modelId
      );

      expect(response.content).toBe('ok');
      expect(sent).toHaveLength(1);
      expect(sent[0]?.model).toBe(modelId);
      expect(sent[0]?.max_output_tokens).toBe(LUNAROUTE_MAX_OUTPUT_TOKENS);
    });
  }
});
