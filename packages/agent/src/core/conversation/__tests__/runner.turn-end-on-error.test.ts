// ABOUTME: PRI-1818 — ConversationRunner.run() must ALWAYS write a turn_end
// ABOUTME: durable event before returning, including when the loop throws.
// ABOUTME: 78 of 163 turn_starts on Ada (48%) saw no matching turn_end before
// ABOUTME: the fix. The classifier maps the caught error to a fine-grained
// ABOUTME: stopReason so downstream consumers (cost accounting, compaction,
// ABOUTME: supervision UI) can render the failure mode explicitly.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { readDurableEvents } from '@lace/agent/storage/event-log';
import { EntErrorCodes } from '@lace/ent-protocol';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
  type WireTool,
} from '@lace/agent/providers/base-provider';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { ToolCall, ToolContext, ToolResult as CoreToolResult } from '@lace/agent/tools/types';

/**
 * Provider that throws a specific error from `_createStreamingResponseImpl`.
 * Lets each test plant the exact shape (Error instance, envelope object,
 * network-coded Error) it wants to drive through the runner.
 */
class ThrowingProvider extends AIProvider {
  constructor(private readonly thrown: unknown) {
    super();
  }
  get providerName(): string {
    return 'throwing-test';
  }
  getProviderInfo() {
    return { name: 'throwing-test', displayName: 'Throwing', requiresApiKey: false };
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
  protected async _createStreamingResponseImpl(): Promise<ProviderResponse> {
    throw this.thrown;
  }
}

/**
 * Provider that returns a single tool call with configurable preceding prose.
 * `content=''` mirrors a tool-only assistant turn; non-empty `content` mirrors
 * the Ada message_then_no_tool_use shape (turn_3736e12e: model emitted prose
 * then a `delegate` tool call).
 */
class ToolCallProvider extends AIProvider {
  constructor(
    private readonly content: string = '',
    private readonly toolName: string = 'bash',
    private readonly toolArguments: Record<string, unknown> = { command: 'ls' }
  ) {
    super();
  }
  get providerName(): string {
    return 'tool-call-test';
  }
  getProviderInfo() {
    return { name: 'tool-call-test', displayName: 'ToolCall', requiresApiKey: false };
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
  protected async _createStreamingResponseImpl(): Promise<ProviderResponse> {
    const response: ProviderResponse = {
      content: this.content,
      toolCalls: [{ id: 'tc_1', name: this.toolName, arguments: this.toolArguments }],
      stopReason: 'tool_use',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
    if (this.content.length > 0) {
      this.emit('token', { token: this.content });
    }
    this.emit('complete', { response });
    return response;
  }
}

function fakeTool(name: string): CoreTool {
  return { name, annotations: undefined } as unknown as CoreTool;
}

function makeToolExecutor(executeImpl?: (toolCall: ToolCall) => Promise<CoreToolResult>) {
  const executeMock = vi
    .fn<(toolCall: ToolCall, ctx: ToolContext) => Promise<CoreToolResult>>()
    .mockImplementation(
      executeImpl ??
        (async (toolCall) => ({
          id: toolCall.id,
          status: 'completed',
          content: [{ type: 'text', text: 'mock result' }],
        }))
    );
  return {
    getTool: (name: string): CoreTool | undefined => fakeTool(name),
    execute: executeMock,
  };
}

function createMockDeps(
  provider: AIProvider,
  toolExecutor: ReturnType<typeof makeToolExecutor>,
  overrides: Partial<RunnerDependencies> = {}
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
    ...overrides,
  };
}

describe('ConversationRunner — turn_end on error (PRI-1818)', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-tte-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-tte-cwd-${testId}`);
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
      sessionId: 'sess_tte',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
  }

  async function runAndExpectThrow(runner: ConversationRunner): Promise<unknown> {
    let caught: unknown;
    try {
      await runner.run({
        content: [{ type: 'text', text: 'prompt under test' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });
    } catch (e) {
      caught = e;
    }
    return caught;
  }

  function findTurnEnd(): { stopReason: string } | undefined {
    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const turnEnd = events.find((e) => e.type === 'turn_end');
    if (!turnEnd) return undefined;
    const data = turnEnd.data as { stopReason?: string };
    return { stopReason: data.stopReason ?? '' };
  }

  it('writes turn_end(provider_error_overloaded) when the provider throws an overloaded_error', async () => {
    // Production sample turn_8c8de2b7: Anthropic SDK throws an Error whose
    // message contains 'overloaded_error' after a 529 response.
    const provider = new ThrowingProvider(
      new Error('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')
    );
    const deps = createMockDeps(provider, makeToolExecutor());
    const runner = new ConversationRunner(makeConfig(), deps);

    const err = await runAndExpectThrow(runner);
    expect(err).toBeDefined();
    expect(findTurnEnd()?.stopReason).toBe('provider_error_overloaded');
  });

  it('writes turn_end(provider_error_invalid) on 400 invalid_request_error / 404 model not found', async () => {
    // Production sample: "400 invalid proxy path", and "404 model: opus" alias
    // misconfigs both fall in this bucket.
    const provider = new ThrowingProvider(
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.0.content.9: unexpected `tool_use`"}}'
      )
    );
    const deps = createMockDeps(provider, makeToolExecutor());
    const runner = new ConversationRunner(makeConfig(), deps);

    await runAndExpectThrow(runner);
    expect(findTurnEnd()?.stopReason).toBe('provider_error_invalid');
  });

  it('writes turn_end(provider_error_network) when fetch fails with a network error', async () => {
    const networkErr = new Error('fetch failed: ECONNREFUSED 127.0.0.1:8080');
    (networkErr as { code?: string }).code = 'ECONNREFUSED';
    const provider = new ThrowingProvider(networkErr);
    const deps = createMockDeps(provider, makeToolExecutor());
    const runner = new ConversationRunner(makeConfig(), deps);

    await runAndExpectThrow(runner);
    expect(findTurnEnd()?.stopReason).toBe('provider_error_network');
  });

  it('writes turn_end(provider_error_other) for an unclassified provider failure', async () => {
    // Runner's inner try/catch wraps the provider throw in a ProviderError
    // envelope (code=EntErrorCodes.ProviderError, data.category='provider').
    // The classifier should still pick provider_error_other even when the
    // upstream message doesn't match overloaded/invalid/network heuristics.
    const provider = new ThrowingProvider(new Error('something weird happened in the SDK layer'));
    const deps = createMockDeps(provider, makeToolExecutor());
    const runner = new ConversationRunner(makeConfig(), deps);

    await runAndExpectThrow(runner);
    expect(findTurnEnd()?.stopReason).toBe('provider_error_other');
  });

  it('writes turn_end(tool_error_throw) when executeToolCall throws synchronously', async () => {
    // The 19 message_then_no_error_logged cases in classified.csv all match
    // this pattern: provider returned a tool call, runner wrote the message,
    // then the tool path threw and the turn never wrote turn_end.
    const provider = new ToolCallProvider();
    const toolExecutor = makeToolExecutor(async () => {
      throw new Error('synthetic tool throw');
    });
    const deps = createMockDeps(provider, toolExecutor);
    const runner = new ConversationRunner(makeConfig(), deps);

    const err = await runAndExpectThrow(runner);
    expect(err).toBeDefined();
    expect(findTurnEnd()?.stopReason).toBe('tool_error_throw');
  });

  it('reproduces Ada message_then_no_tool_use: writes message THEN turn_end(tool_error_throw)', async () => {
    // Ada production trace turn_3736e12e (eventSeq 910-911, 2026-05-23T01:36).
    // Model returned BOTH prose AND a `delegate` tool call. Runner wrote the
    // message event, then executeToolCall threw (likely an onUpdate notify
    // failure on the RPC peer — 18 of 19 cases happened in a 20-minute burst).
    // Pre-fix the throw escaped silently; post-fix it is caught, classified,
    // logged at ERROR, and turn_end is written.
    const adaProse =
      "Three smoke retries lined up. Personas have been refreshed. Let me fire all three in parallel with notify subscriptions, then return my turn — they'll wake me on completion.";
    const provider = new ToolCallProvider(adaProse, 'bash', { command: 'echo hi' });
    const toolExecutor = makeToolExecutor(async () => {
      // Concrete cause in production is unknown — see PRI-1818 followup #5 —
      // but any uncaught throw in the tool path now lands in this catch.
      throw new Error('synthetic tool throw mid-execute');
    });
    const deps = createMockDeps(provider, toolExecutor);
    const runner = new ConversationRunner(makeConfig(), deps);

    const err = await runAndExpectThrow(runner);
    expect(err).toBeDefined();

    // Durable log: message must land BEFORE turn_end (matching the Ada
    // trace), there must be NO tool_use event (the throw happened before the
    // tool_use durable write), and the turn must close cleanly with
    // tool_error_throw. turn_start is written by prompt.ts (not the runner)
    // so it does not appear in this runner-only test.
    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const turnEvents = events.filter((e) => ['message', 'tool_use', 'turn_end'].includes(e.type));
    const types = turnEvents.map((e) => e.type);
    expect(types).toEqual(['message', 'turn_end']);

    const messageEvent = turnEvents.find((e) => e.type === 'message') as
      | { type: 'message'; data: { content: Array<{ type: string; text: string }> } }
      | undefined;
    expect(messageEvent?.data.content?.[0]?.text).toBe(adaProse);
    expect(findTurnEnd()?.stopReason).toBe('tool_error_throw');
  });

  it('writes turn_end(internal_error) for an unrecognised throw inside the runner', async () => {
    // Anything thrown from inside the runner that is NOT a provider call and
    // NOT a tool execution falls into this bucket. Trigger it by making the
    // `runExclusive` mutex throw — that wraps every durable event write. We
    // arm exactly ONE throw so the finally's own write still succeeds.
    let throwOnNext = false;
    const provider = new (class extends AIProvider {
      get providerName(): string {
        return 'internal-err-test';
      }
      getProviderInfo() {
        return { name: 'internal-err-test', displayName: 'Internal', requiresApiKey: false };
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
      protected async _createStreamingResponseImpl(): Promise<ProviderResponse> {
        // Arm the next runExclusive call to throw — this fires inside the
        // assistant 'message' write, which is neither a provider nor a tool
        // path.
        throwOnNext = true;
        const response: ProviderResponse = {
          content: 'hello',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
        this.emit('token', { token: 'hello' });
        this.emit('complete', { response });
        return response;
      }
    })();
    const deps = createMockDeps(provider, makeToolExecutor(), {
      runExclusive: vi.fn().mockImplementation(async <T>(fn: () => T | Promise<T>) => {
        if (throwOnNext) {
          throwOnNext = false;
          throw new Error('synthetic internal failure during durable write');
        }
        return await fn();
      }),
    });
    const runner = new ConversationRunner(makeConfig(), deps);

    const err = await runAndExpectThrow(runner);
    expect(err).toBeDefined();
    // The internal write failed, but the finally block must STILL have
    // recorded turn_end. The finally uses runExclusive too; only the first
    // call is armed to throw, so the finally's own write succeeds.
    expect(findTurnEnd()?.stopReason).toBe('internal_error');
  });

  it('rethrows the original provider error after the turn_end finally block runs', async () => {
    const provider = new ThrowingProvider(new Error('provider exploded'));
    const deps = createMockDeps(provider, makeToolExecutor());
    const runner = new ConversationRunner(makeConfig(), deps);

    const err = await runAndExpectThrow(runner);
    expect(err).toBeDefined();

    // The runner rethrows so callers (prompt.ts, scripted SDK consumers, the
    // job layer) still see the failure and don't believe the run succeeded.
    // The thrown value is the existing ProviderError envelope shape rather
    // than the raw Error — that's the unchanged contract from the inner
    // provider try/catch and we keep it.
    const envelope = err as { code?: number };
    expect(envelope.code).toBe(EntErrorCodes.ProviderError);

    // And turn_end still landed.
    expect(findTurnEnd()).toBeDefined();
  });
});
