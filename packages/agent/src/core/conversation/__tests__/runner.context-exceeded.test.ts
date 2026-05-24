// ABOUTME: Tests that the runner surfaces stopReason='context_window_exceeded' verbatim,
// ABOUTME: preserves partial content (including unexecuted tool_use blocks), and
// ABOUTME: does NOT execute any pending tool calls when the provider returns
// ABOUTME: context_window_exceeded.

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
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { ToolCall, ToolContext, ToolResult as CoreToolResult } from '@lace/agent/tools/types';

class ScriptedProvider extends AIProvider {
  public callCount = 0;
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
    _messages: ProviderMessage[],
    _tools: WireTool[],
    _model: string,
    _signal?: AbortSignal,
    _conversationState?: ConversationState,
    _options?: RequestOptions
  ): Promise<ProviderResponse> {
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

describe('ConversationRunner — context_window_exceeded stop reason', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-ctx-exceeded-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-ctx-exceeded-cwd-${testId}`);
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
      sessionId: 'sess_ctx_exceeded',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
  }

  function runOnce(provider: AIProvider, toolExecutor: ReturnType<typeof makeToolExecutor>) {
    const deps = createMockDeps(provider, toolExecutor);
    const runner = new ConversationRunner(makeConfig(), deps);
    return {
      promise: runner.run({
        content: [{ type: 'text', text: 'prompt under test' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      }),
      deps,
    };
  }

  it('surfaces stopReason=context_window_exceeded with stopDetails and skips tool execution', async () => {
    const stopDetails = {
      type: 'context_window_exceeded' as const,
      source: 'anthropic_beta_stop_reason' as const,
      estimatedExcessTokens: 4096,
    };

    const provider = new ScriptedProvider([
      {
        content: 'I was about to call a tool when the context overflowed.',
        toolCalls: [{ id: 'toolu_a', name: 'bash', arguments: { command: 'ls' } }],
        stopReason: 'context_window_exceeded',
        stopDetails,
        usage: { promptTokens: 200000, completionTokens: 100, totalTokens: 200100 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const { promise } = runOnce(provider, toolExecutor);
    const result = await promise;

    expect(result.stopReason).toBe('context_window_exceeded');
    expect(result.stopDetails).toEqual(stopDetails);
    expect(result.content).toEqual([
      { type: 'text', text: 'I was about to call a tool when the context overflowed.' },
    ]);
    expect(toolExecutor.execute).not.toHaveBeenCalled();

    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const toolUseEvents = events.filter((e) => e.type === 'tool_use');
    for (const ev of toolUseEvents) {
      const data = ev.data as { result?: unknown };
      expect(data.result).toBeUndefined();
    }
  });

  it('preserves the unexecuted tool_use as a durable event without a result', async () => {
    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [
          { id: 'toolu_b', name: 'file_write', arguments: { path: '/tmp/x', content: 'hi' } },
        ],
        stopReason: 'context_window_exceeded',
        stopDetails: {
          type: 'context_window_exceeded',
          source: 'http_400_prompt_too_long',
        },
        usage: { promptTokens: 200000, completionTokens: 0, totalTokens: 200000 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const { promise } = runOnce(provider, toolExecutor);
    await promise;

    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });

    const toolUseEvents = events.filter((e) => e.type === 'tool_use');
    expect(toolUseEvents.length).toBe(1);
    const data = toolUseEvents[0]!.data as {
      toolCallId?: string;
      name?: string;
      result?: unknown;
    };
    expect(data.toolCallId).toBe('toolu_b');
    expect(data.name).toBe('file_write');
    expect(data.result).toBeUndefined();
  });
});
