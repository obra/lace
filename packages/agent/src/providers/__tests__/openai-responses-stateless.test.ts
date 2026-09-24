// ABOUTME: Responses-API chaining vs stateless mode, asserted on the HTTP bodies the real
// ABOUTME: provider sends (fetch stubbed at the boundary, OpenAI SDK and provider left real).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { OpenAIProvider } from '../openai-provider';
import { ProviderRegistry } from '../registry';
import { ProviderInstanceManager } from '../instance/manager';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import { appendOrMergeUser } from '@lace/agent/message-building/append-or-merge';
import type { AIProvider, ProviderMessage } from '../base-provider';
import type { ProviderInstancesConfig } from '../catalog/types';

interface SentItem {
  type?: string;
  role?: string;
  content?: unknown;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: unknown;
}

interface SentBody {
  instructions?: string;
  input: SentItem[];
  store?: boolean;
  previous_response_id?: string;
  context_management?: unknown;
}

const HOP1_ID = 'resp_hop1';
const HOP2_ID = 'resp_hop2';

const USER_MESSAGE: ProviderMessage = { role: 'user', content: 'what is x?' };
const ASSISTANT_TOOL_CALL: ProviderMessage = {
  role: 'assistant',
  content: '',
  toolCalls: [{ id: 'call_1', name: 'lookup', arguments: { q: 'x' } }],
};
const TOOL_RESULT: ProviderMessage = {
  role: 'user',
  content: '',
  toolResults: [{ id: 'call_1', status: 'completed', content: [{ type: 'text', text: 'x=42' }] }],
};

const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };

const hop1Output = [
  { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' },
];
const hop2Output = [
  {
    type: 'message',
    id: 'msg_1',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'x is 42', annotations: [] }],
  },
];

function jsonResponse(id: string, output: unknown[]): Response {
  return new Response(
    JSON.stringify({ id, object: 'response', status: 'completed', output, usage }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function sseResponse(id: string, output: unknown[]): Response {
  const events: Array<Record<string, unknown>> = [];
  output.forEach((item, index) => {
    const typed = item as { type: string; arguments?: string };
    if (typed.type === 'function_call') {
      events.push({
        type: 'response.output_item.added',
        output_index: index,
        item: { ...typed, arguments: '' },
      });
      events.push({
        type: 'response.function_call_arguments.delta',
        output_index: index,
        delta: typed.arguments,
      });
    } else {
      events.push({ type: 'response.output_text.delta', output_index: index, delta: 'x is 42' });
    }
  });
  events.push({
    type: 'response.completed',
    response: { id, object: 'response', status: 'completed', output, usage },
  });
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

type Reply = [id: string, output: unknown[]];

/**
 * Stubs the global fetch the OpenAI SDK sends through, answering the Nth request with
 * the Nth reply (by default hop 1 a tool call, hop 2 text), and recording every
 * /responses request body.
 */
function stubResponsesEndpoint(
  streaming: boolean,
  replies: Reply[] = [
    [HOP1_ID, hop1Output],
    [HOP2_ID, hop2Output],
  ]
): SentBody[] {
  const sent: SentBody[] = [];
  const fetchStub = vi.fn(async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as SentBody);
    const [id, output] = replies[sent.length - 1];
    return streaming ? sseResponse(id, output) : jsonResponse(id, output);
  });
  vi.stubGlobal('fetch', fetchStub);
  return sent;
}

/**
 * Runs a two-hop turn the way the conversation runner does: hop 1 answers with a
 * tool call, hop 2 carries the tool result and hop 1's response id.
 */
async function runTwoHopTurn(
  provider: AIProvider,
  model: string,
  streaming: boolean
): Promise<SentBody[]> {
  const sent = stubResponsesEndpoint(streaming);
  const send = (streaming ? provider.createStreamingResponse : provider.createResponse).bind(
    provider
  );

  const hop1 = await send([USER_MESSAGE], [], model);
  expect(hop1.responseId).toBe(HOP1_ID);
  expect(hop1.toolCalls).toEqual([{ id: 'call_1', name: 'lookup', arguments: { q: 'x' } }]);

  const hop2 = await send([USER_MESSAGE, ASSISTANT_TOOL_CALL, TOOL_RESULT], [], model, undefined, {
    previousResponseId: hop1.responseId,
  });
  expect(hop2.content).toBe('x is 42');

  expect(sent).toHaveLength(2);
  return sent;
}

// The same items an unchained first request builds for these three messages.
const FULL_HISTORY: SentItem[] = [
  { role: 'user', content: 'what is x?' },
  { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' },
  { type: 'function_call_output', call_id: 'call_1', output: 'x=42' },
];

describe('OpenAI Responses API chaining', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const streaming of [false, true]) {
    const mode = streaming ? 'streaming' : 'non-streaming';

    it(`chains hop 2 onto hop 1 by default (${mode})`, async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test-fake' });

      const [hop1, hop2] = await runTwoHopTurn(provider, 'gpt-5', streaming);

      expect(hop1.store).toBe(true);
      expect(hop2.store).toBe(true);
      expect(hop2.previous_response_id).toBe(HOP1_ID);
      // Only what came after the last assistant message: the tool result.
      expect(hop2.input.map((item) => item.type ?? item.role)).toEqual(['function_call_output']);
    });

    it(`sends full history, store:false and no previous_response_id when the provider does not support chaining (${mode})`, async () => {
      const provider = new OpenAIProvider({
        apiKey: 'sk-test-fake',
        baseURL: 'https://gw.example.com/v1',
        apiStyle: 'responses',
        supportsResponseChaining: false,
      });

      const [hop1, hop2] = await runTwoHopTurn(provider, 'some-model', streaming);

      expect(hop1.store).toBe(false);
      expect(hop2.store).toBe(false);
      expect(hop2).not.toHaveProperty('previous_response_id');
      expect(hop2).not.toHaveProperty('context_management');
      expect(hop2.input).toEqual(FULL_HISTORY);
    });
  }
});

const SYSTEM_PROMPT = 'You are Sen, a careful coworker.';
const REMINDER = '<system-reminder>Context budget is at 80%.</system-reminder>';

/**
 * A three-hop history as the conversation runner builds it: assistant text beside
 * parallel tool calls, a system-reminder merged into the tool-result turn by
 * appendOrMergeUser (string-content branch), and a user interjection merged into the
 * next tool-result turn (array-content branch). The history also carries a
 * role:'system' message, which travels only as `instructions`.
 */
function multiHopHistory(): ProviderMessage[] {
  const history: ProviderMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: 'compare a.txt and b.txt, then write the diff' },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'Reading both files.' }],
      toolCalls: [
        { id: 'call_a', name: 'read_file', arguments: { path: 'a.txt' } },
        { id: 'call_b', name: 'read_file', arguments: { path: 'b.txt' } },
      ],
    },
  ];
  const withReminder = appendOrMergeUser(
    [
      ...history,
      {
        role: 'user',
        content: '',
        toolResults: [
          { id: 'call_a', status: 'completed', content: [{ type: 'text', text: 'A body' }] },
          { id: 'call_b', status: 'completed', content: [{ type: 'text', text: 'B body' }] },
        ],
      },
    ],
    REMINDER
  );
  return appendOrMergeUser(
    [
      ...withReminder,
      {
        role: 'assistant',
        content: 'Writing the diff.',
        toolCalls: [{ id: 'call_c', name: 'write_file', arguments: { path: 'diff.txt' } }],
      },
      {
        role: 'user',
        content: [],
        toolResults: [
          { id: 'call_c', status: 'completed', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ],
    'also, thanks!'
  );
}

// What a stateless hop sends for multiHopHistory(). Text merged into a tool-result turn
// follows that turn's function_call_output items, the same tool-results-first rule the
// Anthropic converter follows (see message-building/append-or-merge.ts).
const MULTI_HOP_FULL_HISTORY: SentItem[] = [
  { role: 'user', content: 'compare a.txt and b.txt, then write the diff' },
  { role: 'assistant', content: 'Reading both files.' },
  { type: 'function_call', call_id: 'call_a', name: 'read_file', arguments: '{"path":"a.txt"}' },
  { type: 'function_call', call_id: 'call_b', name: 'read_file', arguments: '{"path":"b.txt"}' },
  { type: 'function_call_output', call_id: 'call_a', output: 'A body' },
  { type: 'function_call_output', call_id: 'call_b', output: 'B body' },
  { role: 'user', content: REMINDER },
  { role: 'assistant', content: 'Writing the diff.' },
  {
    type: 'function_call',
    call_id: 'call_c',
    name: 'write_file',
    arguments: '{"path":"diff.txt"}',
  },
  { type: 'function_call_output', call_id: 'call_c', output: 'ok' },
  { role: 'user', content: 'also, thanks!' },
];

/**
 * Asserts the tool-results-first rule: every function_call's output appears after it
 * and before any later user message item.
 */
function expectToolOutputsBeforeUserText(input: SentItem[]): void {
  input.forEach((item, callIndex) => {
    if (item.type !== 'function_call') return;
    const outputIndex = input.findIndex(
      (other) => other.type === 'function_call_output' && other.call_id === item.call_id
    );
    const nextUserIndex = input.findIndex(
      (other, index) => index > callIndex && other.role === 'user'
    );
    expect(outputIndex, `output for ${item.call_id}`).toBeGreaterThan(callIndex);
    if (nextUserIndex >= 0) {
      expect(outputIndex, `output for ${item.call_id} precedes user text`).toBeLessThan(
        nextUserIndex
      );
    }
  });
}

function responsesProvider(supportsResponseChaining: boolean): OpenAIProvider {
  const provider = new OpenAIProvider({
    apiKey: 'sk-test-fake',
    baseURL: 'https://gw.example.com/v1',
    apiStyle: 'responses',
    supportsResponseChaining,
  });
  provider.setSystemPrompt(SYSTEM_PROMPT);
  return provider;
}

describe('OpenAI Responses API multi-hop history', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const streaming of [false, true]) {
    const mode = streaming ? 'streaming' : 'non-streaming';

    it(`sends the whole multi-hop history on a stateless hop (${mode})`, async () => {
      const provider = responsesProvider(false);
      const sent = stubResponsesEndpoint(streaming, [[HOP2_ID, hop2Output]]);
      const send = (streaming ? provider.createStreamingResponse : provider.createResponse).bind(
        provider
      );

      const reply = await send(multiHopHistory(), [], 'some-model', undefined, {
        previousResponseId: 'resp_previous_hop',
      });
      expect(reply.content).toBe('x is 42');

      expect(sent).toHaveLength(1);
      const [body] = sent;
      expect(body.input).toEqual(MULTI_HOP_FULL_HISTORY);
      expectToolOutputsBeforeUserText(body.input);
      expect(body.instructions).toBe(SYSTEM_PROMPT);
      expect(body.store).toBe(false);
      expect(body).not.toHaveProperty('previous_response_id');
      expect(body).not.toHaveProperty('context_management');
    });

    it(`puts tool outputs before merged user text on a chained hop (${mode})`, async () => {
      const provider = responsesProvider(true);
      const sent = stubResponsesEndpoint(streaming, [[HOP2_ID, hop2Output]]);
      const send = (streaming ? provider.createStreamingResponse : provider.createResponse).bind(
        provider
      );

      await send(multiHopHistory(), [], 'some-model', undefined, {
        previousResponseId: 'resp_previous_hop',
      });

      const [body] = sent;
      expect(body.previous_response_id).toBe('resp_previous_hop');
      // Only what follows the last assistant message: its tool result, then the merged text.
      expect(body.input).toEqual([
        { type: 'function_call_output', call_id: 'call_c', output: 'ok' },
        { role: 'user', content: 'also, thanks!' },
      ]);
    });
  }

  // Known limitation: in stateless mode, prior-hop reasoning isn't carried. Lace's only
  // replay slot for reasoning is ProviderMessage.thinkingBlocks, which is Anthropic-shaped
  // and never filled by the OpenAI provider; the Responses converter ignores it, so no
  // `reasoning` item is sent. LunaRoute accepted stateless tool round trips with and
  // without reasoning items in live probes on 2026-09-24.
  it('does not carry prior-hop reasoning on a stateless hop (known limitation)', async () => {
    const provider = responsesProvider(false);
    const sent = stubResponsesEndpoint(false, [[HOP2_ID, hop2Output]]);
    const history = multiHopHistory().map((msg) =>
      msg.role === 'assistant'
        ? {
            ...msg,
            thinkingBlocks: [{ type: 'thinking' as const, thinking: 'plan it', signature: 's' }],
          }
        : msg
    );

    await provider.createResponse(history, [], 'some-model');

    expect(sent[0].input).toEqual(MULTI_HOP_FULL_HISTORY);
  });
});

describe('shipped LunaRoute catalog response chaining', () => {
  const _tempLaceDir = setupCoreTest();
  let previousDisableDynamic: string | undefined;

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
    await ProviderRegistry.getInstance().ensureInitialized();
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

  it('runs a tool-call turn statelessly against the LunaRoute endpoint', async () => {
    const provider = await ProviderRegistry.getInstance().createProviderFromInstanceAndModel(
      'test-lunaroute',
      'deepseek-4.1-flash'
    );

    const [, hop2] = await runTwoHopTurn(provider, 'deepseek-4.1-flash', true);

    expect(hop2.store).toBe(false);
    expect(hop2).not.toHaveProperty('previous_response_id');
    expect(hop2.input).toEqual(FULL_HISTORY);
  });

  it('carries the catalog flag through createProviderFromInstance', async () => {
    const provider =
      await ProviderRegistry.getInstance().createProviderFromInstance('test-lunaroute');

    const [hop1, hop2] = await runTwoHopTurn(provider, 'deepseek-4.1-flash', true);

    expect(hop1.store).toBe(false);
    expect(hop2.store).toBe(false);
    expect(hop2).not.toHaveProperty('previous_response_id');
    expect(hop2.input).toEqual(FULL_HISTORY);
  });
});
