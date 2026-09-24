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

function usageFor(inputTokens: number) {
  return { input_tokens: inputTokens, output_tokens: 1, total_tokens: inputTokens + 1 };
}

function responsesJson(inputTokens = 1): Response {
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
      usage: usageFor(inputTokens),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function responsesSse(inputTokens = 1): Response {
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
        usage: usageFor(inputTokens),
      },
    },
  ];
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A Chat Completions reply; `promptTokens` null leaves usage out, as some gateways do. */
function chatCompletionJson(promptTokens: number | null = 1): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl_1',
      object: 'chat.completion',
      created: 0,
      model: MODEL,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
      ...(promptTokens !== null && {
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: 1,
          total_tokens: promptTokens + 1,
        },
      }),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function chatCompletionSse(promptTokens: number): Response {
  const chunks = [
    {
      id: 'chatcmpl_1',
      object: 'chat.completion.chunk',
      created: 0,
      model: MODEL,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl_1',
      object: 'chat.completion.chunk',
      created: 0,
      model: MODEL,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: promptTokens, completion_tokens: 1, total_tokens: promptTokens + 1 },
    },
  ];
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
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

/**
 * A projection scaled by measured ratio x 1.1 is the ceiling of a floating-point
 * product (2.0 * 1.1 is 2.2000000000000002), so it can land one token above the exact
 * figure, leaving one token less output. Either value is correct.
 */
function expectOutputLimit(actual: unknown, exact: number): void {
  expect(actual).toBeGreaterThanOrEqual(exact - 1);
  expect(actual).toBeLessThanOrEqual(exact);
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
// 500K estimated (499K message + 1K system prompt): project 500K * 1.7 = 850K of input,
//   leaving 1 048 576 - 850 000 = 198 576 for output.
// 900K estimated: 1.53M projected exceeds the window, so the output limit drops to the floor.
const CASES = [
  { label: 'low input', messageTokens: 1, expected: MAX_OUTPUT },
  { label: '500K estimated input', messageTokens: 499_000, expected: 198_576 },
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

  it('keeps input + max_output_tokens within the window when chars/4 undercounts by 1.6x', async () => {
    // 600K estimated (599K message + 1K system prompt); real content at 2.5 chars/token
    // is 1.6x that. Projected at 1.7x: 1 020 000, leaving 28 576 for output.
    const trueInputTokens = 600_000 * 1.6;
    const sent = stubEndpoint(() => responsesJson());

    await provider.createResponse(userMessageOf(599_000), [], MODEL);

    const maxOutput = sent[0]?.max_output_tokens as number;
    expect(maxOutput).toBe(28_576);
    expect(trueInputTokens + maxOutput).toBeLessThanOrEqual(CONTEXT_WINDOW);
  });

  // Hop 1 is 400K estimated (399K message + 1K system prompt) and the gateway reports
  // `ratio` x that as real input. Hop 2 projects its own estimate x (ratio x 1.1).
  //   1.0x: 614K estimated -> 675 400 projected -> full limit, far above the floor.
  //   1.6x: 550K estimated (880K real) -> 968 000 projected -> 80 576 left.
  //   2.0x: 400K estimated (800K real) -> 880 000 projected -> 168 576 left.
  const MEASURED_CASES = [
    { ratio: 1.0, hop2MessageTokens: 613_000, expected: MAX_OUTPUT },
    { ratio: 1.6, hop2MessageTokens: 549_000, expected: 80_576 },
    { ratio: 2.0, hop2MessageTokens: 399_000, expected: 168_576 },
  ];

  for (const { ratio, hop2MessageTokens, expected } of MEASURED_CASES) {
    for (const streaming of [false, true]) {
      it(`sizes hop 2 by hop 1's measured ${ratio}x ratio (${streaming ? 'streaming' : 'non-streaming'})`, async () => {
        const hop1RealInput = 400_000 * ratio;
        const hop2RealInput = (hop2MessageTokens + 1_000) * ratio;
        const sent = stubEndpoint(() =>
          streaming ? responsesSse(hop1RealInput) : responsesJson(hop1RealInput)
        );
        const send = (streaming ? provider.createStreamingResponse : provider.createResponse).bind(
          provider
        );

        await send(userMessageOf(399_000), [], MODEL);
        await send(userMessageOf(hop2MessageTokens), [], MODEL);

        expect(sent).toHaveLength(2);
        // Hop 1 has no measurement yet: 400K x 1.7 = 680K projected, full limit.
        expect(sent[0]?.max_output_tokens).toBe(MAX_OUTPUT);
        const hop2MaxOutput = sent[1]?.max_output_tokens as number;
        expectOutputLimit(hop2MaxOutput, expected);
        expect(hop2RealInput + hop2MaxOutput).toBeLessThanOrEqual(CONTEXT_WINDOW);
      });
    }
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
      const sent = stubEndpoint(() => chatCompletionJson());

      const response = await provider.createResponse(userMessageOf(messageTokens), [], MODEL);

      expect(response.content).toBe('ok');
      expect(sent).toHaveLength(1);
      expect(sent[0]?.max_completion_tokens).toBe(expected);
    });
  }

  function makeProvider(): OpenAIProvider {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test-fake',
      baseURL: 'https://gw.example.com/v1',
      catalogProvider,
    });
    provider.setSystemPrompt(SYSTEM_PROMPT);
    return provider;
  }

  for (const streaming of [false, true]) {
    it(`sizes hop 2 by hop 1's reported prompt_tokens (${streaming ? 'streaming' : 'non-streaming'})`, async () => {
      // Hop 1: 400K estimated, 800K reported (2.0x). Hop 2: 400K x 2.2 = 880 000 -> 168 576.
      const provider = makeProvider();
      const sent = stubEndpoint(() =>
        streaming ? chatCompletionSse(800_000) : chatCompletionJson(800_000)
      );
      const send = (streaming ? provider.createStreamingResponse : provider.createResponse).bind(
        provider
      );

      await send(userMessageOf(399_000), [], MODEL);
      await send(userMessageOf(399_000), [], MODEL);

      expect(sent).toHaveLength(2);
      expectOutputLimit(sent[1]?.max_completion_tokens, 168_576);
    });
  }

  it('does not treat usage it had to estimate as a measurement', async () => {
    // Hop 1's reply carries no usage, so lace fills promptTokens with its own estimate.
    // That is not a measured ratio: hop 2 at 500K estimated must still project at 1.7x
    // (850 000 -> 198 576), not at ~1.1x.
    const provider = makeProvider();
    const sent = stubEndpoint(() => chatCompletionJson(null));

    await provider.createResponse(userMessageOf(399_000), [], MODEL);
    await provider.createResponse(userMessageOf(499_000), [], MODEL);

    expect(sent).toHaveLength(2);
    expect(sent[1]?.max_completion_tokens).toBe(198_576);
  });
});
