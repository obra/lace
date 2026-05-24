// ABOUTME: Tests pause_turn auto-resume in the conversation runner. The runner
// ABOUTME: transparently continues a paused turn by re-feeding the partial
// ABOUTME: assistant text into the next provider call, with a safety counter
// ABOUTME: (MAX_PAUSE_RESUMES) bounding pathological loops to a 'failed' result.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { readDurableEvents } from '@lace/agent/storage/event-log';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
  type WireTool,
} from '@lace/agent/providers/base-provider';
import { EntErrorCodes } from '@lace/ent-protocol';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { ToolCall, ToolContext, ToolResult as CoreToolResult } from '@lace/agent/tools/types';

class ScriptedProvider extends AIProvider {
  public callCount = 0;
  public capturedMessages: ProviderMessage[][] = [];
  private readonly responses: ProviderResponse[];

  constructor(responses: ProviderResponse[]) {
    super();
    this.responses = responses;
  }

  get providerName(): string {
    return 'scripted-test';
  }

  getProviderInfo() {
    return {
      name: 'scripted-test',
      displayName: 'Scripted Test Provider',
      requiresApiKey: false,
    };
  }

  isConfigured(): boolean {
    return true;
  }

  get supportsStreaming(): boolean {
    return true;
  }

  protected async _createResponseImpl(
    messages: ProviderMessage[],
    tools: WireTool[],
    model: string,
    signal?: AbortSignal,
    conversationState?: ConversationState,
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    return this._createStreamingResponseImpl(
      messages,
      tools,
      model,
      signal,
      conversationState,
      options
    );
  }

  protected async _createStreamingResponseImpl(
    messages: ProviderMessage[],
    _tools: WireTool[],
    _model: string,
    _signal?: AbortSignal,
    _conversationState?: ConversationState,
    _options?: RequestOptions
  ): Promise<ProviderResponse> {
    // Snapshot the inbound messages so tests can assert on cross-iteration state.
    this.capturedMessages.push(messages.map((m) => ({ ...m })));
    const idx = Math.min(this.callCount, this.responses.length - 1);
    this.callCount += 1;
    const response = this.responses[idx];
    if (typeof response.content === 'string' && response.content.length > 0) {
      this.emit('token', { token: response.content });
    }
    this.emit('complete', { response });
    return response;
  }
}

function fakeTool(name: string): CoreTool {
  return { name, annotations: undefined } as unknown as CoreTool;
}

function makeToolExecutor() {
  const executeMock = vi
    .fn<(toolCall: ToolCall, ctx: ToolContext) => Promise<CoreToolResult>>()
    .mockImplementation(async (toolCall) => ({
      id: toolCall.id,
      status: 'completed',
      content: [{ type: 'text', text: 'should-not-be-called' }],
    }));
  return {
    getTool: (name: string): CoreTool | undefined => fakeTool(name),
    execute: executeMock,
  };
}

function createMockDeps(
  provider: AIProvider,
  toolExecutor: ReturnType<typeof makeToolExecutor>
): RunnerDependencies {
  const mockJobManager = {
    getJob: vi.fn().mockReturnValue(undefined),
    listJobs: vi.fn().mockReturnValue([]),
    getJobOutput: vi.fn().mockReturnValue(''),
    createJob: vi
      .fn()
      .mockResolvedValue({ jobId: 'job_test', job: { completion: Promise.resolve() } }),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    finalizeJob: vi.fn().mockResolvedValue(undefined),
    getStreamingMode: vi.fn().mockReturnValue('full'),
    setStreamingMode: vi.fn(),
    getRunningJobs: vi.fn().mockReturnValue([]),
  };

  return {
    onUpdate: vi.fn().mockResolvedValue(undefined),
    runExclusive: vi
      .fn()
      .mockImplementation(<T>(fn: () => T | Promise<T>) => Promise.resolve(fn())),
    requestPermission: vi.fn().mockResolvedValue({ decision: 'allow' }),
    createToolExecutor: vi.fn().mockResolvedValue({
      executor: toolExecutor,
      toolsForProvider: [],
    }),
    createProvider: vi.fn().mockResolvedValue(provider),
    getModelPricing: vi.fn().mockResolvedValue(null),
    startShellJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    jobManager: mockJobManager as unknown as RunnerDependencies['jobManager'],
    mcpServerManager: undefined,
    setActiveTurnStatus: vi.fn(),
    getSessionCostUsd: vi.fn().mockReturnValue(0),
    updateSessionUsage: vi.fn(),
  };
}

describe('ConversationRunner — pause_turn auto-resume', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-pause-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-pause-cwd-${testId}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({ nextEventSeq: 2, nextStreamSeq: 1 })
    );
    writeFileSync(
      join(sessionDir, 'events.jsonl'),
      JSON.stringify({
        eventSeq: 1,
        timestamp: new Date().toISOString(),
        type: 'system_prompt_set',
        data: { type: 'system_prompt_set', text: 'You are a test assistant.' },
      }) + '\n'
    );
  });

  afterEach(() => {
    if (existsSync(sessionDir)) rmSync(sessionDir, { recursive: true, force: true });
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  function makeConfig(): RunnerConfig {
    return {
      sessionDir,
      sessionId: 'sess_pause',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
  }

  function buildRunner(provider: AIProvider, toolExecutor: ReturnType<typeof makeToolExecutor>) {
    const deps = createMockDeps(provider, toolExecutor);
    return { runner: new ConversationRunner(makeConfig(), deps), deps };
  }

  it('single pause: pause_turn → end_turn concatenates content and writes one message event', async () => {
    const provider = new ScriptedProvider([
      {
        content: 'part one ',
        toolCalls: [],
        stopReason: 'pause_turn',
        stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
        usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
      },
      {
        content: 'part two',
        toolCalls: [],
        stopReason: 'end_turn',
        stopDetails: null,
        usage: { promptTokens: 13, completionTokens: 3, totalTokens: 16 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const { runner } = buildRunner(provider, toolExecutor);
    const result = await runner.run({
      content: [{ type: 'text', text: 'prompt' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(result.stopReason).toBe('end_turn');
    expect(result.content).toEqual([{ type: 'text', text: 'part one part two' }]);

    // Provider should have been called twice (once paused, once resumed).
    expect(provider.callCount).toBe(2);

    // The resumed call must have seen the partial assistant turn appended.
    const secondCallMessages = provider.capturedMessages[1]!;
    const lastMessage = secondCallMessages[secondCallMessages.length - 1]!;
    expect(lastMessage.role).toBe('assistant');
    expect(lastMessage.content).toBe('part one ');

    // Exactly ONE durable 'message' event with the concatenated text.
    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const messageEvents = events.filter((e) => e.type === 'message');
    expect(messageEvents.length).toBe(1);
    const data = messageEvents[0]!.data as { content?: unknown };
    expect(data.content).toEqual([{ type: 'text', text: 'part one part two' }]);
  });

  it('multiple pauses: pause_turn × 3 → end_turn concatenates content and writes one message event', async () => {
    const provider = new ScriptedProvider([
      {
        content: 'one ',
        toolCalls: [],
        stopReason: 'pause_turn',
        stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
        usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
      },
      {
        content: 'two ',
        toolCalls: [],
        stopReason: 'pause_turn',
        stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
        usage: { promptTokens: 11, completionTokens: 1, totalTokens: 12 },
      },
      {
        content: 'three ',
        toolCalls: [],
        stopReason: 'pause_turn',
        stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
        usage: { promptTokens: 12, completionTokens: 1, totalTokens: 13 },
      },
      {
        content: 'four',
        toolCalls: [],
        stopReason: 'end_turn',
        stopDetails: null,
        usage: { promptTokens: 13, completionTokens: 1, totalTokens: 14 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const { runner } = buildRunner(provider, toolExecutor);
    const result = await runner.run({
      content: [{ type: 'text', text: 'prompt' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(result.stopReason).toBe('end_turn');
    expect(result.content).toEqual([{ type: 'text', text: 'one two three four' }]);
    expect(provider.callCount).toBe(4);

    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const messageEvents = events.filter((e) => e.type === 'message');
    expect(messageEvents.length).toBe(1);
    const data = messageEvents[0]!.data as { content?: unknown };
    expect(data.content).toEqual([{ type: 'text', text: 'one two three four' }]);
  });

  it('pause loop: pause_turn × 11 triggers MAX_PAUSE_RESUMES safety and throws failed', async () => {
    // 11 consecutive pause_turn responses. MAX_PAUSE_RESUMES=10 permits 10
    // successful resumes; the 11th consecutive pause must surface 'failed'
    // with stopDetails.code='pause_turn_loop'.
    const pauseResponse: ProviderResponse = {
      content: 'x',
      toolCalls: [],
      stopReason: 'pause_turn',
      stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
      usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
    };
    const provider = new ScriptedProvider(Array.from({ length: 11 }, () => pauseResponse));

    const toolExecutor = makeToolExecutor();
    const { runner } = buildRunner(provider, toolExecutor);

    let thrown: unknown = null;
    try {
      await runner.run({
        content: [{ type: 'text', text: 'prompt' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect(thrown).toMatchObject({
      code: EntErrorCodes.ProviderError,
      data: {
        category: 'provider',
        stopDetails: {
          type: 'failed',
          code: 'pause_turn_loop',
          source: 'http_error',
        },
      },
    });
    // The 11th call is the one that throws — we saw exactly 11 provider calls.
    expect(provider.callCount).toBe(11);
  });

  it('positive boundary: pause_turn × 10 followed by end_turn completes successfully', async () => {
    // MAX_PAUSE_RESUMES=10 means EXACTLY 10 successful resumes must be allowed.
    // Counter-example for an off-by-one: with `>=` instead of `>` the runner
    // would throw on the 10th pause, before the end_turn could be reached.
    const pauseResponse: ProviderResponse = {
      content: 'p',
      toolCalls: [],
      stopReason: 'pause_turn',
      stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
      usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
    };
    const endResponse: ProviderResponse = {
      content: 'done',
      toolCalls: [],
      stopReason: 'end_turn',
      stopDetails: null,
      usage: { promptTokens: 20, completionTokens: 1, totalTokens: 21 },
    };
    const provider = new ScriptedProvider([
      ...Array.from({ length: 10 }, () => pauseResponse),
      endResponse,
    ]);

    const toolExecutor = makeToolExecutor();
    const { runner } = buildRunner(provider, toolExecutor);
    const result = await runner.run({
      content: [{ type: 'text', text: 'prompt' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(result.stopReason).toBe('end_turn');
    // 10 pauses each emit 'p', then end_turn emits 'done'.
    expect(result.content).toEqual([{ type: 'text', text: 'ppppppppppdone' }]);
    expect(provider.callCount).toBe(11);
  });

  it('multi-pause provider-message integrity: never appends consecutive assistants', async () => {
    // Regression test for the consecutive-assistant bug: prior to the merge
    // fix the runner pushed a NEW assistant message on each pause iteration,
    // producing [user, assistant, assistant, assistant, ...] which Anthropic
    // rejects. The fix merges by replacing the last assistant message with
    // the cumulative concatenated text. Assert (1) no two consecutive
    // messages share a role in any captured request, and (2) the final
    // request carries the full cumulative assistant text in a single
    // trailing assistant message.
    const provider = new ScriptedProvider([
      {
        content: 'one ',
        toolCalls: [],
        stopReason: 'pause_turn',
        stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
        usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
      },
      {
        content: 'two ',
        toolCalls: [],
        stopReason: 'pause_turn',
        stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
        usage: { promptTokens: 11, completionTokens: 1, totalTokens: 12 },
      },
      {
        content: 'three ',
        toolCalls: [],
        stopReason: 'pause_turn',
        stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
        usage: { promptTokens: 12, completionTokens: 1, totalTokens: 13 },
      },
      {
        content: 'four',
        toolCalls: [],
        stopReason: 'end_turn',
        stopDetails: null,
        usage: { promptTokens: 13, completionTokens: 1, totalTokens: 14 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const { runner } = buildRunner(provider, toolExecutor);
    const result = await runner.run({
      content: [{ type: 'text', text: 'prompt' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(result.stopReason).toBe('end_turn');
    expect(provider.callCount).toBe(4);
    // 4 captured request snapshots, one per provider call.
    expect(provider.capturedMessages.length).toBe(4);

    // Invariant: no two consecutive messages in any request share a role.
    for (const messages of provider.capturedMessages) {
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i]!.role).not.toBe(messages[i - 1]!.role);
      }
    }

    // The final (4th) request must end with a single assistant message
    // carrying the cumulative concatenated text of all prior pauses.
    const finalRequest = provider.capturedMessages[3]!;
    const lastMessage = finalRequest[finalRequest.length - 1]!;
    expect(lastMessage.role).toBe('assistant');
    expect(lastMessage.content).toBe('one two three ');
    // And there must be EXACTLY ONE assistant message in that final request
    // (we merged, not appended).
    const assistantCount = finalRequest.filter((m) => m.role === 'assistant').length;
    expect(assistantCount).toBe(1);
  });

  it('pause_turn does NOT count against maxTurns', async () => {
    // Build a script of 2 logical turns, each consisting of pause_turn → end_turn,
    // followed by a third turn that should never be reached. With maxTurns=2 the
    // runner should complete two logical turns and then exit via max_turns (the
    // outer for-loop terminates before the 3rd turn's pair runs). The first
    // logical turn's end_turn yields no tool calls so the runner exits early.
    //
    // Actually with no tool calls in the response the runner exits after the
    // first logical turn (stopReason='end_turn' or 'incomplete' depending on
    // text). To exercise multi-logical-turn behaviour we'd need tool calls. The
    // simpler property to assert here is: a pause-resume iteration does NOT
    // increment the maxTurns counter — proven by completing the pause + end_turn
    // pair (which would be 2 provider calls) under maxTurns=1.
    const provider = new ScriptedProvider([
      {
        content: 'first half ',
        toolCalls: [],
        stopReason: 'pause_turn',
        stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      },
      {
        content: 'second half',
        toolCalls: [],
        stopReason: 'end_turn',
        stopDetails: null,
        usage: { promptTokens: 12, completionTokens: 2, totalTokens: 14 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const { runner } = buildRunner(provider, toolExecutor);
    const result = await runner.run({
      content: [{ type: 'text', text: 'prompt' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns: 1,
    });

    // Pause did NOT count against maxTurns: under maxTurns=1 we still completed
    // the full pause→end_turn cycle and got a clean end_turn result.
    expect(result.stopReason).toBe('end_turn');
    expect(result.content).toEqual([{ type: 'text', text: 'first half second half' }]);
    expect(provider.callCount).toBe(2);
  });
});
