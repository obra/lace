// ABOUTME: Responses-API chaining vs stateless mode, asserted on the HTTP bodies the real
// ABOUTME: provider sends (fetch stubbed at the boundary, OpenAI SDK and provider left real).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { OpenAIProvider } from '../openai-provider';
import { ProviderRegistry } from '../registry';
import { ProviderInstanceManager } from '../instance/manager';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
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

/**
 * Stubs the global fetch the OpenAI SDK sends through, answering hop 1 with a tool
 * call and hop 2 with text, and recording every /responses request body.
 */
function stubResponsesEndpoint(streaming: boolean): SentBody[] {
  const sent: SentBody[] = [];
  const fetchStub = vi.fn(async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as SentBody);
    const [id, output] = sent.length === 1 ? [HOP1_ID, hop1Output] : [HOP2_ID, hop2Output];
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
      expect(hop1.previous_response_id).toBeUndefined();
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
      expect(hop1.previous_response_id).toBeUndefined();
      expect(hop2.store).toBe(false);
      expect(hop2).not.toHaveProperty('previous_response_id');
      expect(hop2).not.toHaveProperty('context_management');
      expect(hop2.input).toEqual(FULL_HISTORY);
    });
  }
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
});
