// ABOUTME: Cross-turn cache-stability gate. A second turn whose only difference is
// a longer tail must leave the shared message prefix byte-stable, or the provider
// prompt cache misses. Anthropic uses the real-server two-turn helper (compared
// with cache_control markers stripped, since the rolling anchor moves inside the
// prefix); OpenAI/Gemini use their file-hoisted SDK mocks (object capture, whole).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    },
  })),
}));

import { OpenAIProvider } from '@lace/agent/providers/openai-provider';
import { GeminiProvider } from '@lace/agent/providers/gemini-provider';
import { captureAnthropicTwoTurn, captureAnthropicTwoTurnParallel } from './_capture-request-body';

const stripCacheControl = (s: string) => s.replace(/,?"cache_control":\{[^}]*\}/g, '');

// SHARED base history = 4 messages. Turn N+1 appends an assistant answer + a new
// user message, so the first `sharedCount` provider-messages must be identical.
const BASE = [
  { role: 'user' as const, content: 'q1' },
  { role: 'assistant' as const, content: 'a1' },
  { role: 'user' as const, content: 'q2' },
  { role: 'assistant' as const, content: 'a2' },
];
const TURN1 = [...BASE, { role: 'user' as const, content: 'NEW1' }];
const TURN2 = [
  ...BASE,
  { role: 'user' as const, content: 'NEW1' },
  { role: 'assistant' as const, content: 'NEWA1' },
  { role: 'user' as const, content: 'NEW2' },
];

// Slice the shared prefix from a captured request object.
function prefixFromObject(
  obj: Record<string, unknown[]>,
  key: string,
  sharedCount: number
): string {
  return JSON.stringify((obj[key] as unknown[]).slice(0, sharedCount));
}

describe('cross-turn cache stability: shared prefix is byte-stable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: undefined }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
  });

  it('Anthropic: prefix identical after stripping cache_control', async () => {
    const [t1, t2] = await captureAnthropicTwoTurn();
    const pre = (body: string) =>
      JSON.stringify((JSON.parse(body) as { messages: unknown[] }).messages.slice(0, BASE.length));
    expect(stripCacheControl(pre(t1))).toBe(stripCacheControl(pre(t2)));
  });

  it('OpenAI: request-object prefix identical (server-side cache, no markers)', async () => {
    const p = new OpenAIProvider({ apiKey: 'test-key', baseURL: 'http://localhost:8080/v1' });
    p.setSystemPrompt('You are Lace. Cached system block.');
    await p.createResponse(TURN1, [], 'gpt-4o');
    const o1 = mockCreate.mock.calls.at(-1)![0] as Record<string, unknown[]>;
    await p.createResponse(TURN2, [], 'gpt-4o');
    const o2 = mockCreate.mock.calls.at(-1)![0] as Record<string, unknown[]>;
    // OpenAI prepends a system message → shared count = BASE.length + 1.
    expect(prefixFromObject(o1, 'messages', BASE.length + 1)).toBe(
      prefixFromObject(o2, 'messages', BASE.length + 1)
    );
  });

  it('Gemini: request-object prefix identical (no managed cache, no markers)', async () => {
    const p = new GeminiProvider({ apiKey: 'test-api-key' });
    p.setSystemPrompt('You are Lace. Cached system block.');
    await p.createResponse(TURN1, [], 'gemini-2.5-flash');
    const o1 = mockGenerateContent.mock.calls.at(-1)![0] as Record<string, unknown[]>;
    await p.createResponse(TURN2, [], 'gemini-2.5-flash');
    const o2 = mockGenerateContent.mock.calls.at(-1)![0] as Record<string, unknown[]>;
    // Gemini uses `contents` and a separate `systemInstruction` (no leading system message).
    expect(prefixFromObject(o1, 'contents', BASE.length)).toBe(
      prefixFromObject(o2, 'contents', BASE.length)
    );
  });
});

// A parallel-tool exchange in the shared history must stay byte-stable across turns.
// Before the event reducer was unified, the rebuilt shape (split assistant/user per
// call) differed from the sent shape (one assistant + one user), so this prefix
// drifted on every parallel-tool turn. Now both are the canonical shape, so turn 1's
// whole request is a byte-prefix of turn 2's.
const PARALLEL_BASE = [
  { role: 'user' as const, content: 'do two things' },
  {
    role: 'assistant' as const,
    content: 'doing two things',
    toolCalls: [
      { id: 'c1', name: 'echo', arguments: { v: 'a' } },
      { id: 'c2', name: 'echo', arguments: { v: 'b' } },
    ],
  },
  {
    role: 'user' as const,
    content: '',
    toolResults: [
      { id: 'c1', content: [{ type: 'text' as const, text: 'a' }], status: 'completed' as const },
      { id: 'c2', content: [{ type: 'text' as const, text: 'b' }], status: 'completed' as const },
    ],
  },
];
const P_TURN1 = [...PARALLEL_BASE, { role: 'user' as const, content: 'NEW1' }];
const P_TURN2 = [
  ...PARALLEL_BASE,
  { role: 'user' as const, content: 'NEW1' },
  { role: 'assistant' as const, content: 'NEWA1' },
  { role: 'user' as const, content: 'NEW2' },
];

// turn 1's SHARED HISTORY must be a byte-prefix of turn 2's request. We drop turn 1's
// final message (the new user prompt) because that is the moving tail: Anthropic wraps
// the tail's string content into a [{type:text,…}] block to attach a cache marker, so
// the tail message is never part of the stable cached prefix — only the history before
// it is. (The Step-0 cross-turn test sidesteps this the same way, comparing only the
// deep base.) Here that history includes the parallel-tool exchange we are pinning.
// Returns [turn2-prefix, turn1-shared-history] for a byte-equality assertion in the
// test body (keeping `expect` in the test satisfies vitest/expect-expect).
function sharedHistoryPair(
  turn1: unknown[],
  turn2: unknown[],
  normalize: (s: string) => string = (s) => s
): [string, string] {
  const sharedHistory = turn1.slice(0, -1);
  return [
    normalize(JSON.stringify(turn2.slice(0, sharedHistory.length))),
    normalize(JSON.stringify(sharedHistory)),
  ];
}

describe('cross-turn cache stability: a parallel-tool exchange stays byte-stable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: undefined }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
  });

  it('Anthropic: turn 1 messages are a byte-prefix of turn 2 (markers stripped)', async () => {
    const [t1, t2] = await captureAnthropicTwoTurnParallel();
    const m1 = (JSON.parse(t1) as { messages: unknown[] }).messages;
    const m2 = (JSON.parse(t2) as { messages: unknown[] }).messages;
    const [got, want] = sharedHistoryPair(m1, m2, stripCacheControl);
    expect(got).toBe(want);
  });

  it('OpenAI: turn 1 messages are a byte-prefix of turn 2', async () => {
    const p = new OpenAIProvider({ apiKey: 'test-key', baseURL: 'http://localhost:8080/v1' });
    p.setSystemPrompt('You are Lace. Cached system block.');
    await p.createResponse(P_TURN1, [], 'gpt-4o');
    const o1 = mockCreate.mock.calls.at(-1)![0] as { messages: unknown[] };
    await p.createResponse(P_TURN2, [], 'gpt-4o');
    const o2 = mockCreate.mock.calls.at(-1)![0] as { messages: unknown[] };
    const [got, want] = sharedHistoryPair(o1.messages, o2.messages);
    expect(got).toBe(want);
  });

  it('Gemini: turn 1 contents are a byte-prefix of turn 2', async () => {
    const p = new GeminiProvider({ apiKey: 'test-api-key' });
    p.setSystemPrompt('You are Lace. Cached system block.');
    await p.createResponse(P_TURN1, [], 'gemini-2.5-flash');
    const o1 = mockGenerateContent.mock.calls.at(-1)![0] as { contents: unknown[] };
    await p.createResponse(P_TURN2, [], 'gemini-2.5-flash');
    const o2 = mockGenerateContent.mock.calls.at(-1)![0] as { contents: unknown[] };
    const [got, want] = sharedHistoryPair(o1.contents, o2.contents);
    expect(got).toBe(want);
  });
});
