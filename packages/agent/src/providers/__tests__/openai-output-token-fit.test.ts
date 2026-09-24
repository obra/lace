// ABOUTME: The OpenAI provider shrinks the requested output limit to the room the input leaves
// ABOUTME: in the context window, asserted on the HTTP bodies the real provider sends (fetch stubbed),
// ABOUTME: and turns LunaRoute's context-overflow 400 into a context_window_exceeded stop.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { OpenAIProvider } from '../openai-provider';
import { ProviderRegistry } from '../registry';
import { ProviderInstanceManager } from '../instance/manager';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import type { AIProvider } from '../base-provider';
import type { CatalogProvider, ProviderInstancesConfig } from '../catalog/types';

const MODEL = 'deepseek-4.1-flash';
const CONTEXT_WINDOW = 1_048_576;
const MAX_OUTPUT = 262_144;

// 1 000 estimated tokens of system prompt (the estimator counts 4 chars per token).
const SYSTEM_PROMPT = 's'.repeat(4_000);

/** A single user message the estimator sizes at exactly `tokens` tokens. */
function userMessageOf(tokens: number) {
  return [{ role: 'user' as const, content: 'x'.repeat(tokens * 4) }];
}

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };

function responsesJson(): Response {
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
      usage,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function responsesSse(): Response {
  const events = [
    { type: 'response.output_text.delta', output_index: 0, delta: 'ok' },
    {
      type: 'response.completed',
      response: {
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
        usage,
      },
    },
  ];
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function chatCompletionJson(): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl_1',
      object: 'chat.completion',
      created: 0,
      model: MODEL,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

// What LunaRoute answered, live, when input + max_output_tokens exceeded the window.
function lunaRouteContextOverflow(): Response {
  return new Response(
    JSON.stringify({
      error: {
        cause: 'model_context_length_exceeded',
        code: 'UPSTREAM_ERROR',
        message: 'Upstream provider error',
      },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } }
  );
}

/** Stubs the fetch the OpenAI SDK sends through and records each request body. */
function stubEndpoint(respond: () => Response): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return respond();
    })
  );
  return sent;
}

// Low input: nothing to fit, the catalog limit goes out as-is.
// 700K estimated (699K message + 1K system prompt): reserve 700K * 1.25 = 875K for input,
//   leaving 1 048 576 - 875 000 = 173 576 for output.
// 900K estimated: 1.125M reserved exceeds the window, so the output limit drops to the floor.
const CASES = [
  { label: 'low input', messageTokens: 1, expected: MAX_OUTPUT },
  { label: '700K estimated input', messageTokens: 699_000, expected: 173_576 },
  { label: '900K estimated input', messageTokens: 899_000, expected: 4_096 },
];

describe('OpenAI Responses output limit fits the context window (shipped LunaRoute catalog)', () => {
  const _tempLaceDir = setupCoreTest();
  let previousDisableDynamic: string | undefined;
  let provider: AIProvider;

  beforeEach(async () => {
    previousDisableDynamic = process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    process.env.LACE_DISABLE_DYNAMIC_CATALOGS = '1';
    const instances: ProviderInstancesConfig = {
      version: '1.0',
      instances: {
        'test-lunaroute': { displayName: 'Test LunaRoute', catalogProviderId: 'lunaroute' },
      },
    };
    fs.writeFileSync(
      path.join(process.env.LACE_DIR!, 'provider-instances.json'),
      JSON.stringify(instances, null, 2)
    );
    await new ProviderInstanceManager().saveCredential('test-lunaroute', {
      apiKey: 'test-lunaroute-fake-key',
    });
    ProviderRegistry.clearInstance();
    provider = await ProviderRegistry.getInstance().createProviderFromInstanceAndModel(
      'test-lunaroute',
      MODEL
    );
    provider.setSystemPrompt(SYSTEM_PROMPT);
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

  for (const { label, messageTokens, expected } of CASES) {
    it(`sends max_output_tokens ${expected} at ${label} (non-streaming)`, async () => {
      const sent = stubEndpoint(responsesJson);

      const response = await provider.createResponse(userMessageOf(messageTokens), [], MODEL);

      expect(response.content).toBe('ok');
      expect(sent).toHaveLength(1);
      expect(sent[0]?.max_output_tokens).toBe(expected);
    });

    it(`sends max_output_tokens ${expected} at ${label} (streaming)`, async () => {
      const sent = stubEndpoint(responsesSse);

      const response = await provider.createStreamingResponse(
        userMessageOf(messageTokens),
        [],
        MODEL
      );

      expect(response.content).toBe('ok');
      expect(sent).toHaveLength(1);
      expect(sent[0]?.max_output_tokens).toBe(expected);
    });
  }

  for (const streaming of [false, true]) {
    it(`reports LunaRoute's context-overflow 400 as context_window_exceeded (${streaming ? 'streaming' : 'non-streaming'})`, async () => {
      const sent = stubEndpoint(lunaRouteContextOverflow);
      const send = (streaming ? provider.createStreamingResponse : provider.createResponse).bind(
        provider
      );

      const response = await send(userMessageOf(1), [], MODEL);

      expect(sent).toHaveLength(1);
      expect(response.stopReason).toBe('context_window_exceeded');
      expect(response.content).toBe('');
    });
  }
});

describe('OpenAI Chat Completions output limit fits the context window', () => {
  const catalogProvider: CatalogProvider = {
    name: 'Test Gateway',
    id: 'test-gateway',
    type: 'openai',
    api_endpoint: 'https://gw.example.com/v1',
    default_large_model_id: MODEL,
    default_small_model_id: MODEL,
    models: [
      {
        id: MODEL,
        name: 'Test Model',
        context_window: CONTEXT_WINDOW,
        default_max_tokens: MAX_OUTPUT,
      },
    ],
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const { label, messageTokens, expected } of CASES) {
    it(`sends max_completion_tokens ${expected} at ${label}`, async () => {
      const provider = new OpenAIProvider({
        apiKey: 'sk-test-fake',
        baseURL: 'https://gw.example.com/v1',
        catalogProvider,
      });
      provider.setSystemPrompt(SYSTEM_PROMPT);
      const sent = stubEndpoint(chatCompletionJson);

      const response = await provider.createResponse(userMessageOf(messageTokens), [], MODEL);

      expect(response.content).toBe('ok');
      expect(sent).toHaveLength(1);
      expect(sent[0]?.max_completion_tokens).toBe(expected);
    });
  }
});
