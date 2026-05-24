// ABOUTME: PRI-1818 — ConversationRunner.run() must ALWAYS write a turn_end
// durable event before returning, including when the loop throws.
// Without this, 78 of 163 turn_starts on Ada (48%) never saw a matching
// turn_end. The classifier maps the caught error to a fine-grained
// `stopReason` so downstream consumers (cost accounting, compaction,
// supervision UI) can render the failure mode explicitly.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invalidatePersonaCache, readDurableEvents } from '@lace/agent/storage/event-log';
import { EntErrorCodes } from '@lace/ent-protocol';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
} from '@lace/agent/providers/base-provider';
import type { Tool } from '@lace/agent/tools/tool';

function createMockDeps(overrides: Partial<RunnerDependencies> = {}): RunnerDependencies {
  const mockToolExecutor = {
    getTool: vi.fn().mockReturnValue(null),
    execute: vi
      .fn()
      .mockResolvedValue({ status: 'completed', content: [{ type: 'text', text: 'mock result' }] }),
  };

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
    createToolExecutor: vi.fn().mockReturnValue({
      executor: mockToolExecutor,
      toolsForProvider: [],
    }),
    createProvider: vi.fn(),
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

/**
 * Base provider that lets each test plant a specific error to throw from
 * createStreamingResponse. Keeps the boilerplate (providerName, isConfigured,
 * createResponse) consistent so the test bodies only express the throw shape.
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
  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    conversationState?: ConversationState,
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    return this.createStreamingResponse(messages, tools, model, signal, conversationState, options);
  }
  async createStreamingResponse(): Promise<ProviderResponse> {
    throw this.thrown;
  }
}

/**
 * Provider that returns a tool call on the first request then a clean stop on
 * the second. Used to drive the tool-execution path before injecting a tool
 * throw via the mock executor.
 *
 * `content` is configurable so tests can mirror either the empty-content shape
 * (an assistant turn that ONLY emits a tool_use) or the message_then_no_tool_use
 * shape from the Ada production trace where the model emitted prose first and
 * was about to invoke a tool when the throw happened.
 */
class ToolCallThenStopProvider extends AIProvider {
  callCount = 0;
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
  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    conversationState?: ConversationState,
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    return this.createStreamingResponse(messages, tools, model, signal, conversationState, options);
  }
  async createStreamingResponse(): Promise<ProviderResponse> {
    this.callCount++;
    return {
      content: this.content,
      toolCalls: [{ id: 'tc_1', name: this.toolName, arguments: this.toolArguments }],
      stopReason: 'tool_use',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  }
}

describe('ConversationRunner — turn_end on error (PRI-1818)', () => {
  let laceDir: string;
  let sessionDir: string;
  let sessionId: string;
  let cwd: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-runner-tte-'));
    sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    cwd = join(tmpdir(), `lace-runner-tte-cwd-${randomUUID().substring(0, 8)}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({
        sessionId,
        workDir: cwd,
        created: new Date().toISOString(),
        persona: 'test',
      })
    );
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

    savedLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
  });

  afterEach(() => {
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    if (existsSync(laceDir)) rmSync(laceDir, { recursive: true, force: true });
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  function findTurnEnd(): { stopReason: string } | undefined {
    const { events } = readDurableEvents(sessionDir, {});
    const turnEnd = events.find((e) => e.type === 'turn_end') as
      | { type: 'turn_end'; data: { stopReason: string } }
      | undefined;
    return turnEnd ? { stopReason: turnEnd.data.stopReason } : undefined;
  }

  async function runAndExpectThrow(runner: ConversationRunner): Promise<unknown> {
    let caught: unknown;
    try {
      await runner.run({
        content: [{ type: 'text', text: 'hi' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });
    } catch (e) {
      caught = e;
    }
    return caught;
  }

  it('writes turn_end(stopReason=provider_error_overloaded) when Anthropic returns 529 / overloaded_error', async () => {
    // Shape mirrors what AnthropicProvider throws after a 529: an Error whose
    // message contains 'overloaded_error' (per the actual production log
    // sample from turn_8c8de2b7 in classified.csv).
    const provider = new ThrowingProvider(
      new Error('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')
    );
    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
    });
    const runner = new ConversationRunner(config, deps);

    const err = await runAndExpectThrow(runner);
    expect(err).toBeDefined();

    const turnEnd = findTurnEnd();
    expect(turnEnd).toBeDefined();
    expect(turnEnd?.stopReason).toBe('provider_error_overloaded');
  });

  it('writes turn_end(stopReason=provider_error_invalid) on 400 invalid_request_error / 404 model not found', async () => {
    // Production sample: "400 invalid proxy path: expected /{provider}/...".
    // Same bucket also covers "404 model: opus" alias misconfigs.
    const provider = new ThrowingProvider(
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.0.content.9: unexpected `tool_use`"}}'
      )
    );
    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
    });
    const runner = new ConversationRunner(config, deps);

    await runAndExpectThrow(runner);

    const turnEnd = findTurnEnd();
    expect(turnEnd?.stopReason).toBe('provider_error_invalid');
  });

  it('writes turn_end(stopReason=provider_error_network) when fetch fails with a network error', async () => {
    const networkErr = new Error('fetch failed: ECONNREFUSED 127.0.0.1:8080');
    (networkErr as { code?: string }).code = 'ECONNREFUSED';
    const provider = new ThrowingProvider(networkErr);
    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
    });
    const runner = new ConversationRunner(config, deps);

    await runAndExpectThrow(runner);

    const turnEnd = findTurnEnd();
    expect(turnEnd?.stopReason).toBe('provider_error_network');
  });

  it('writes turn_end(stopReason=provider_error_other) for an unclassified provider failure', async () => {
    const provider = new ThrowingProvider(new Error('something weird happened in the SDK layer'));
    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
    });
    const runner = new ConversationRunner(config, deps);

    await runAndExpectThrow(runner);

    const turnEnd = findTurnEnd();
    expect(turnEnd?.stopReason).toBe('provider_error_other');
  });

  it('writes turn_end(stopReason=tool_error_throw) when executeToolCall throws synchronously', async () => {
    // The 19 message_then_no_error_logged cases in classified.csv all match
    // this pattern: provider returned a tool call, runner wrote the message,
    // then the tool path threw and the turn never wrote turn_end.
    const provider = new ToolCallThenStopProvider();
    const mockTool = { name: 'bash', description: 'mock', schema: {} } as unknown as Tool;
    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      // 'approve' so we don't trigger a permission flow; the throw must come
      // from the executor itself.
      approvalMode: 'approve',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      createToolExecutor: vi.fn().mockReturnValue({
        executor: {
          getTool: vi.fn().mockReturnValue(mockTool),
          execute: vi.fn().mockImplementation(async () => {
            throw new Error('synthetic tool throw');
          }),
        },
        toolsForProvider: [mockTool],
      }),
    });
    const runner = new ConversationRunner(config, deps);

    const err = await runAndExpectThrow(runner);
    expect(err).toBeDefined();

    const turnEnd = findTurnEnd();
    expect(turnEnd?.stopReason).toBe('tool_error_throw');
  });

  it('reproduces Ada message_then_no_tool_use: writes message THEN turn_end(tool_error_throw) when the tool throws after an assistant message landed', async () => {
    // PRI-1818 #4 — Ada production trace turn_3736e12e (eventSeq 910-911,
    // 2026-05-23T01:36:24Z). The model returned BOTH prose AND a `delegate`
    // tool call. Runner wrote the message event, then executeToolCall threw
    // (likely an onUpdate notify failure on the RPC peer — 18 of 19 cases
    // happened in a 20-minute burst). Pre-PR-#341 the throw escaped silently;
    // post-PR-#341 it is caught, classified, logged at ERROR, and turn_end
    // is written. This test asserts the post-#341 invariant.
    const adaProse =
      "Three smoke retries lined up. Personas have been refreshed. Let me fire all three in parallel with notify subscriptions, then return my turn — they'll wake me on completion.";
    const provider = new ToolCallThenStopProvider(adaProse, 'bash', { command: 'echo hi' });
    const mockTool = { name: 'bash', description: 'mock', schema: {} } as unknown as Tool;
    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      createToolExecutor: vi.fn().mockReturnValue({
        executor: {
          getTool: vi.fn().mockReturnValue(mockTool),
          execute: vi.fn().mockImplementation(async () => {
            // Synthesizes the silent-throw mechanism. Concrete cause in
            // production is unknown — see PRI-1818 followup item #5 — but
            // any uncaught throw in the tool path now lands in this catch.
            throw new Error('synthetic tool throw mid-execute');
          }),
        },
        toolsForProvider: [mockTool],
      }),
    });
    const runner = new ConversationRunner(config, deps);

    const err = await runAndExpectThrow(runner);
    expect(err).toBeDefined();

    // Replay the durable log: the message must land BEFORE turn_end (matching
    // the Ada trace), there must be NO tool_use event (the throw happened
    // before the durable write at runner.ts:1210), and the turn must close
    // out cleanly with tool_error_throw. turn_start is written by prompt.ts
    // (not the runner) so it does not appear in this runner-only test.
    const { events } = readDurableEvents(sessionDir, {});
    const turnEvents = events.filter((e) => ['message', 'tool_use', 'turn_end'].includes(e.type));
    const types = turnEvents.map((e) => e.type);
    expect(types).toEqual(['message', 'turn_end']);

    const messageEvent = turnEvents.find((e) => e.type === 'message') as
      | { type: 'message'; data: { content: Array<{ type: string; text: string }> } }
      | undefined;
    expect(messageEvent?.data.content?.[0]?.text).toBe(adaProse);

    const turnEnd = findTurnEnd();
    expect(turnEnd?.stopReason).toBe('tool_error_throw');
  });

  it('writes turn_end(stopReason=internal_error) for an unrecognised throw inside the runner', async () => {
    // Anything thrown from inside the runner that is NOT a provider call and
    // NOT a tool execution falls into this bucket. We trigger it by making
    // the `runExclusive` mutex throw — that wraps every durable event write.
    let throwOnNext = false;
    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const provider = new (class extends AIProvider {
      get providerName(): string {
        return 'internal-err-test';
      }
      getProviderInfo() {
        return { name: 'internal-err-test', displayName: 'Internal Err', requiresApiKey: false };
      }
      isConfigured(): boolean {
        return true;
      }
      get supportsStreaming(): boolean {
        return true;
      }
      async createResponse(
        messages: ProviderMessage[],
        tools: Tool[],
        model: string,
        signal?: AbortSignal,
        conversationState?: ConversationState,
        options?: RequestOptions
      ): Promise<ProviderResponse> {
        return this.createStreamingResponse(
          messages,
          tools,
          model,
          signal,
          conversationState,
          options
        );
      }
      async createStreamingResponse(): Promise<ProviderResponse> {
        // Arm the next write to throw — this fires inside the runner's
        // writeAndAdvance path for the assistant message, which is neither
        // a provider nor a tool path.
        throwOnNext = true;
        return {
          content: 'hello',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
    })();
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      runExclusive: vi.fn().mockImplementation(async <T>(fn: () => T | Promise<T>) => {
        if (throwOnNext) {
          throwOnNext = false;
          throw new Error('synthetic internal failure during durable write');
        }
        return await fn();
      }),
    });
    const runner = new ConversationRunner(config, deps);

    const err = await runAndExpectThrow(runner);
    expect(err).toBeDefined();

    const turnEnd = findTurnEnd();
    // The internal write failed, but the finally block must STILL have
    // recorded turn_end. The finally uses runExclusive too; the mock only
    // arms one throw, so the second write succeeds.
    expect(turnEnd?.stopReason).toBe('internal_error');
  });

  it('rethrows the original error after the turn_end finally block runs', async () => {
    const original = new Error('provider exploded');
    const provider = new ThrowingProvider(original);
    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
    });
    const runner = new ConversationRunner(config, deps);

    const err = await runAndExpectThrow(runner);
    expect(err).toBeDefined();

    // The runner re-throws so callers (prompt.ts, scripted SDK consumers, the
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
