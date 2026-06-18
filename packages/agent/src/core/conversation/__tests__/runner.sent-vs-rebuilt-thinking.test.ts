// ABOUTME: Proves the sent==rebuilt invariant for an assistant turn that has BOTH
// ABOUTME: thinking blocks AND tool calls. The shape the runner SENDS on the
// ABOUTME: continuation call (assistant message carrying the tool_use) must match
// ABOUTME: the shape REBUILT from durable events on the next turn — both must carry
// ABOUTME: the same thinkingBlocks. A mismatch breaks the prompt cache at every
// ABOUTME: thinking+tool assistant message.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
  type ThinkingBlock,
  type WireTool,
} from '@lace/agent/providers/base-provider';
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
    return { name: 'scripted-test', displayName: 'Scripted Test Provider', requiresApiKey: false };
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
    // Snapshot the inbound messages so the test can inspect what the runner SENT.
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
      content: [{ type: 'text', text: 'tool ran' }],
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

describe('ConversationRunner — sent == rebuilt for thinking+tool turn', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-sent-rebuilt-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-sent-rebuilt-cwd-${testId}`);
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
      sessionId: 'sess_sent_rebuilt',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
  }

  it('continuation assistant message carries the same thinkingBlocks as the rebuild', async () => {
    const thinkingBlocks: ThinkingBlock[] = [
      { type: 'thinking', thinking: 'let me reason about this', signature: 'sig-abc' },
    ];

    // Turn 1: BOTH thinking blocks AND a tool call (stopReason tool_use).
    // Turn 2: end_turn so the runner stops cleanly after the tool round-trip.
    const provider = new ScriptedProvider([
      {
        content: 'I will call the tool.',
        toolCalls: [{ id: 'call_1', name: 'mock', arguments: { foo: 'bar' } }],
        thinkingBlocks,
        stopReason: 'tool_use',
        stopDetails: null,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
      {
        content: 'All done.',
        toolCalls: [],
        stopReason: 'end_turn',
        stopDetails: null,
        usage: { promptTokens: 20, completionTokens: 3, totalTokens: 23 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const deps = createMockDeps(provider, toolExecutor);
    const runner = new ConversationRunner(makeConfig(), deps);

    const result = await runner.run({
      content: [{ type: 'text', text: 'do the thing' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(result.stopReason).toBe('end_turn');
    // At least one continuation call happened after the tool_use turn.
    expect(provider.callCount).toBeGreaterThanOrEqual(2);

    // The continuation call captured the message history the runner SENT —
    // including the assistant message that carries the tool_use. Find it across
    // all captured requests (the first continuation already carries it).
    const sentAssistant = provider.capturedMessages
      .flat()
      .find((m) => m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0);
    expect(sentAssistant).toBeDefined();

    // Rebuild the SAME assistant message from durable events (what the next turn
    // would actually send).
    const { messages: rebuilt } = buildProviderMessagesFromDurableEvents(sessionDir);
    const rebuiltAssistant = rebuilt.find(
      (m) => m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0
    );
    expect(rebuiltAssistant).toBeDefined();

    // The rebuild carries the thinking blocks (durable 'message' event stored them).
    expect(rebuiltAssistant!.thinkingBlocks).toEqual(thinkingBlocks);

    // INVARIANT: the SENT assistant message must carry the SAME thinking blocks as
    // the rebuilt one. This is the sent==rebuilt guarantee that keeps the prompt
    // cache stable across the thinking+tool turn.
    expect(sentAssistant!.thinkingBlocks).toEqual(rebuiltAssistant!.thinkingBlocks);
  });
});
