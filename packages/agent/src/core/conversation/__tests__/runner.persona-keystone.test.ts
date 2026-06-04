// ABOUTME: runner stamps the authoritative persona into ToolContext, server-side.
// ABOUTME: The persona comes from RunnerConfig, not from tool-call arguments.
// ABOUTME: This is the keystone invariant: persona is resolved at construction,
// ABOUTME: never from tool args — so a prompt-injected tool_use cannot override it.

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

/**
 * Provider that emits one tool_use with the given name and arguments, then
 * returns end_turn on the second call.  Mirrors the ToolCallProvider pattern
 * from runner.turn-end-on-error.test.ts.
 */
class OneToolCallProvider extends AIProvider {
  private callCount = 0;
  constructor(
    private readonly toolName: string,
    private readonly toolArguments: Record<string, unknown> = {}
  ) {
    super();
  }
  get providerName(): string {
    return 'one-tool-call-test';
  }
  getProviderInfo() {
    return { name: 'one-tool-call-test', displayName: 'OneToolCall', requiresApiKey: false };
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
    this.callCount += 1;
    if (this.callCount === 1) {
      const response: ProviderResponse = {
        content: '',
        toolCalls: [{ id: 'tc_capture', name: this.toolName, arguments: this.toolArguments }],
        stopReason: 'tool_use',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
      this.emit('complete', { response });
      return response;
    }
    // Second call: end the turn so the runner loop exits.
    const response: ProviderResponse = {
      content: 'done',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
    this.emit('token', { token: 'done' });
    this.emit('complete', { response });
    return response;
  }
}

function fakeTool(name: string): CoreTool {
  return { name, annotations: undefined } as unknown as CoreTool;
}

function makeCapturingExecutor(onExecute: (toolCall: ToolCall, ctx: ToolContext) => void): {
  getTool: (n: string) => CoreTool | undefined;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi
    .fn<(toolCall: ToolCall, ctx: ToolContext) => Promise<CoreToolResult>>()
    .mockImplementation(async (toolCall, ctx) => {
      onExecute(toolCall, ctx);
      return {
        id: toolCall.id,
        status: 'completed' as const,
        content: [{ type: 'text' as const, text: 'ok' }],
      };
    });
  return {
    getTool: (name: string): CoreTool | undefined => fakeTool(name),
    execute,
  };
}

function createMockDeps(
  provider: AIProvider,
  toolExecutor: ReturnType<typeof makeCapturingExecutor>,
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

describe('ConversationRunner — persona keystone', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-pk-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-pk-cwd-${testId}`);
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

  function makeConfig(extra: Partial<RunnerConfig> = {}): RunnerConfig {
    return {
      sessionDir,
      sessionId: 'sess_pk',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      ...extra,
    };
  }

  it('stamps ToolContext.persona from config.persona, ignoring tool-call args', async () => {
    // The attacker injects persona:'attacker' into the tool arguments.
    // The runner must deliver persona:'researcher' (from config) to the tool.
    let capturedCtx: ToolContext | undefined;

    const provider = new OneToolCallProvider('capture', { persona: 'attacker' });
    const executor = makeCapturingExecutor((_toolCall, ctx) => {
      capturedCtx = ctx;
    });
    const deps = createMockDeps(provider, executor);
    const runner = new ConversationRunner(makeConfig({ persona: 'researcher' }), deps);

    await runner.run({
      content: [{ type: 'text', text: 'Run the capture tool.' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns: 2,
    });

    // The tool must have been called.
    expect(executor.execute).toHaveBeenCalled();
    // The context must carry the config persona, not the attacker-supplied arg.
    expect(capturedCtx?.persona).toBe('researcher');
  });

  it('leaves ToolContext.persona undefined when config.persona is not set', async () => {
    let capturedCtx: ToolContext | undefined;

    const provider = new OneToolCallProvider('capture', {});
    const executor = makeCapturingExecutor((_toolCall, ctx) => {
      capturedCtx = ctx;
    });
    const deps = createMockDeps(provider, executor);
    // No persona on config.
    const runner = new ConversationRunner(makeConfig(), deps);

    await runner.run({
      content: [{ type: 'text', text: 'Run the capture tool.' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns: 2,
    });

    expect(executor.execute).toHaveBeenCalled();
    expect(capturedCtx?.persona).toBeUndefined();
  });
});
