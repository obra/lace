// ABOUTME: Parametric tests over runner dispatch for the remaining terminal stop
// ABOUTME: reasons — max_output_tokens, stop_sequence, and failed. The 'failed'
// ABOUTME: case asserts the runner throws (not returns) with stopDetails on the
// ABOUTME: thrown error.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
  type LaceStopDetails,
  type WireTool,
} from '@lace/agent/providers/base-provider';
import { EntErrorCodes } from '@lace/ent-protocol';
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

describe('ConversationRunner — stop-dispatch (max_output_tokens, stop_sequence, failed)', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-dispatch-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-dispatch-cwd-${testId}`);
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
      sessionId: 'sess_dispatch',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
  }

  function buildRunner(provider: AIProvider, toolExecutor: ReturnType<typeof makeToolExecutor>) {
    const deps = createMockDeps(provider, toolExecutor);
    return new ConversationRunner(makeConfig(), deps);
  }

  it('max_output_tokens: surfaces stopReason and stopDetails with partial text content', async () => {
    const stopDetails: LaceStopDetails = {
      type: 'max_output_tokens',
      source: 'anthropic_stop_reason',
      requestedMaxTokens: 4096,
    };

    const provider = new ScriptedProvider([
      {
        content: 'partial output cut off at the token limit',
        toolCalls: [],
        stopReason: 'max_output_tokens',
        stopDetails,
        usage: { promptTokens: 100, completionTokens: 4096, totalTokens: 4196 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const result = await buildRunner(provider, toolExecutor).run({
      content: [{ type: 'text', text: 'Generate a lot' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(result.stopReason).toBe('max_output_tokens');
    expect(result.stopDetails).toEqual(stopDetails);
    expect(result.content).toEqual([
      { type: 'text', text: 'partial output cut off at the token limit' },
    ]);
  });

  it('stop_sequence: surfaces stopReason and stopDetails with partial text content', async () => {
    const stopDetails: LaceStopDetails = {
      type: 'stop_sequence',
      sequence: '\n\nHuman:',
      source: 'anthropic_stop_sequence',
    };

    const provider = new ScriptedProvider([
      {
        content: 'output that ended at the stop sequence',
        toolCalls: [],
        stopReason: 'stop_sequence',
        stopDetails,
        usage: { promptTokens: 100, completionTokens: 12, totalTokens: 112 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const result = await buildRunner(provider, toolExecutor).run({
      content: [{ type: 'text', text: 'Generate' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(result.stopReason).toBe('stop_sequence');
    expect(result.stopDetails).toEqual(stopDetails);
    expect(result.content).toEqual([
      { type: 'text', text: 'output that ended at the stop sequence' },
    ]);
  });

  it('failed: runner throws with EntErrorCodes.ProviderError and stopDetails on the error', async () => {
    const stopDetails: LaceStopDetails = {
      type: 'failed',
      code: 'server_error',
      message: 'OpenAI Responses returned status=failed',
      source: 'openai_responses_failed_status',
    };

    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [],
        stopReason: 'failed',
        stopDetails,
        usage: { promptTokens: 100, completionTokens: 0, totalTokens: 100 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const runner = buildRunner(provider, toolExecutor);

    let thrown: unknown = null;
    try {
      await runner.run({
        content: [{ type: 'text', text: 'do work' }],
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
      message: 'OpenAI Responses returned status=failed',
      data: {
        category: 'provider',
        stopDetails,
      },
    });
  });

  it('failed: when stopDetails is missing the message field, runner throws with a generic message', async () => {
    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [],
        stopReason: 'failed',
        stopDetails: null,
        usage: { promptTokens: 100, completionTokens: 0, totalTokens: 100 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const runner = buildRunner(provider, toolExecutor);

    let thrown: unknown = null;
    try {
      await runner.run({
        content: [{ type: 'text', text: 'do work' }],
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
      message: 'Provider request failed',
      data: { category: 'provider' },
    });
  });
});
