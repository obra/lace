// ABOUTME: Tests that the runner threads RunParams.outputFormat into the
// ABOUTME: provider RequestOptions and surfaces ProviderResponse.structuredOutput
// ABOUTME: on RunResult.

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
  type WireTool,
} from '@lace/agent/providers/base-provider';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { ToolCall, ToolContext, ToolResult as CoreToolResult } from '@lace/agent/tools/types';

class CapturingProvider extends AIProvider {
  public lastOptions: RequestOptions | undefined;
  private readonly response: ProviderResponse;

  constructor(response: ProviderResponse) {
    super();
    this.response = response;
  }

  get providerName(): string {
    return 'capturing-test';
  }

  getProviderInfo() {
    return {
      name: 'capturing-test',
      displayName: 'Capturing Test Provider',
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
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    this.lastOptions = options;
    if (typeof this.response.content === 'string' && this.response.content.length > 0) {
      this.emit('token', { token: this.response.content });
    }
    this.emit('complete', { response: this.response });
    return this.response;
  }
}

function fakeTool(name: string): CoreTool {
  return { name, annotations: undefined } as unknown as CoreTool;
}

function makeToolExecutor() {
  return {
    getTool: (name: string): CoreTool | undefined => fakeTool(name),
    execute: vi
      .fn<(toolCall: ToolCall, ctx: ToolContext) => Promise<CoreToolResult>>()
      .mockResolvedValue({ id: 'x', status: 'completed', content: [{ type: 'text', text: 'x' }] }),
  };
}

function createMockDeps(provider: AIProvider, toolExecutor: ReturnType<typeof makeToolExecutor>) {
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
    createToolExecutor: vi.fn().mockResolvedValue({ executor: toolExecutor, toolsForProvider: [] }),
    createProvider: vi.fn().mockResolvedValue(provider),
    getModelPricing: vi.fn().mockResolvedValue(null),
    startShellJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    jobManager: mockJobManager as unknown as RunnerDependencies['jobManager'],
    mcpServerManager: undefined,
    setActiveTurnStatus: vi.fn(),
    getSessionCostUsd: vi.fn().mockReturnValue(0),
    updateSessionUsage: vi.fn(),
  } as unknown as RunnerDependencies;
}

const OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: { decision: { type: 'string' } },
    required: ['decision'],
    additionalProperties: false,
  },
};

describe('ConversationRunner — structured output', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-structured-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-structured-cwd-${testId}`);
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
      sessionId: 'sess_structured',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
  }

  it('threads outputFormat into the provider and surfaces structuredOutput on the result', async () => {
    const provider = new CapturingProvider({
      content: '{"decision":"deny"}',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      structuredOutput: { decision: 'deny' },
    });
    const runner = new ConversationRunner(
      makeConfig(),
      createMockDeps(provider, makeToolExecutor())
    );

    const result = await runner.run({
      content: [{ type: 'text', text: 'decide' }],
      outputFormat: OUTPUT_FORMAT,
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(provider.lastOptions?.outputFormat).toEqual(OUTPUT_FORMAT);
    expect(result.structuredOutput).toEqual({ decision: 'deny' });
  });

  it('leaves structuredOutput undefined when no outputFormat is given', async () => {
    const provider = new CapturingProvider({
      content: 'plain text answer',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    });
    const runner = new ConversationRunner(
      makeConfig(),
      createMockDeps(provider, makeToolExecutor())
    );

    const result = await runner.run({
      content: [{ type: 'text', text: 'hi' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(provider.lastOptions?.outputFormat).toBeUndefined();
    expect(result.structuredOutput).toBeUndefined();
  });
});
