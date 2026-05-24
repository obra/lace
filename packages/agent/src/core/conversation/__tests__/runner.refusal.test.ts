// ABOUTME: Tests that the runner surfaces stopReason='refusal' verbatim,
// ABOUTME: preserves partial content (including unexecuted tool_use blocks), and
// ABOUTME: does NOT execute any pending tool calls when the provider refuses.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { readDurableEvents } from '@lace/agent/storage/event-log';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
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

describe('ConversationRunner — refusal stop reason', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-refusal-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-refusal-cwd-${testId}`);
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
      sessionId: 'sess_refusal',
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

  it('surfaces stopReason=refusal verbatim with stopDetails and does NOT execute pending tools', async () => {
    const refusalDetails = {
      type: 'refusal' as const,
      category: 'cyber',
      explanation: 'request involves disallowed cyber-offense content',
      source: 'anthropic_classifier' as const,
    };

    const provider = new ScriptedProvider([
      {
        content: 'I can offer a partial answer here, but I cannot continue.',
        toolCalls: [{ id: 'toolu_x', name: 'bash', arguments: { command: 'rm -rf /' } }],
        stopReason: 'refusal',
        stopDetails: refusalDetails,
        usage: { promptTokens: 10, completionTokens: 12, totalTokens: 22 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const { promise, deps } = runOnce(provider, toolExecutor);
    const result = await promise;

    expect(result.stopReason).toBe('refusal');
    expect(result.stopDetails).toEqual(refusalDetails);
    expect(result.content).toEqual([
      { type: 'text', text: 'I can offer a partial answer here, but I cannot continue.' },
    ]);

    // Tool execution must NOT have happened.
    expect(toolExecutor.execute).not.toHaveBeenCalled();

    // The unexecuted tool_use lands with a SYNTHETIC cancelled tool_result.
    // We write the synthetic result at runner time (not at rebuild time) so
    // the next turn's provider message history stays valid: every assistant
    // tool_use must be paired with a tool_result, or Anthropic/OpenAI reject
    // the request. The runner did NOT actually execute the tool — the
    // synthetic result is purely a durable-event artifact.
    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const toolEvents = events.filter((e) => e.type === 'tool_use');
    for (const ev of toolEvents) {
      const data = ev.data as {
        result?: { outcome?: string; content?: Array<{ type?: string; text?: string }> };
      };
      expect(data.result).toBeDefined();
      expect(data.result?.outcome).toBe('cancelled');
      expect(data.result?.content?.[0]?.type).toBe('text');
      expect(data.result?.content?.[0]?.text).toMatch(/not executed.*reason refusal/);
    }

    // No tool-use update with status='completed' should have been emitted either —
    // the runner uses onUpdate to mirror tool execution into the stream.
    const onUpdateCalls = (deps.onUpdate as ReturnType<typeof vi.fn>).mock.calls as Array<
      [number, { type: string; status?: string }]
    >;
    const completedToolUpdates = onUpdateCalls.filter(
      ([, update]) => update.type === 'tool_use' && update.status === 'completed'
    );
    expect(completedToolUpdates).toEqual([]);
  });

  it('preserves the unexecuted tool_use as a durable event with a synthetic cancelled result', async () => {
    const provider = new ScriptedProvider([
      {
        content: 'partial answer before refusal',
        toolCalls: [
          { id: 'toolu_y', name: 'file_write', arguments: { path: '/tmp/x', content: 'hi' } },
        ],
        stopReason: 'refusal',
        stopDetails: {
          type: 'refusal',
          category: null,
          explanation: null,
          source: 'anthropic_classifier',
        },
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
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
      result?: { outcome?: string; content?: Array<{ type?: string; text?: string }> };
    };
    expect(data.toolCallId).toBe('toolu_y');
    expect(data.name).toBe('file_write');
    // The runner synthesizes a cancelled tool_result for unexecuted tool_use
    // blocks. Without it, the next turn's rebuilt provider message history
    // would contain an orphan assistant tool_use that providers reject.
    expect(data.result).toBeDefined();
    expect(data.result?.outcome).toBe('cancelled');
    expect(data.result?.content?.[0]?.type).toBe('text');
    expect(data.result?.content?.[0]?.text).toContain('not executed');
    expect(data.result?.content?.[0]?.text).toContain('refusal');
  });

  it('persists stopDetails on the turn_end durable event for refusals', async () => {
    const refusalDetails = {
      type: 'refusal' as const,
      category: 'csam',
      explanation: 'request involves disallowed content',
      source: 'anthropic_classifier' as const,
    };

    const provider = new ScriptedProvider([
      {
        content: 'I cannot help with that.',
        toolCalls: [],
        stopReason: 'refusal',
        stopDetails: refusalDetails,
        usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const { promise } = runOnce(provider, toolExecutor);
    await promise;

    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });

    const turnEndEvents = events.filter((e) => e.type === 'turn_end');
    expect(turnEndEvents).toHaveLength(1);

    const turnEnd = turnEndEvents[0]!.data as {
      type: 'turn_end';
      stopReason: string;
      stopDetails?: unknown;
    };
    expect(turnEnd.stopReason).toBe('refusal');
    expect(turnEnd.stopDetails).toEqual(refusalDetails);
  });

  it('persists stopDetails as null when the stop reason has no extra context', async () => {
    const provider = new ScriptedProvider([
      {
        content: 'all done',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const { promise } = runOnce(provider, toolExecutor);
    await promise;

    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });

    const turnEndEvents = events.filter((e) => e.type === 'turn_end');
    expect(turnEndEvents).toHaveLength(1);

    const turnEnd = turnEndEvents[0]!.data as {
      type: 'turn_end';
      stopReason: string;
      stopDetails?: unknown;
    };
    expect(turnEnd.stopReason).toBe('end_turn');
    // The field is present but null — distinguishes "current writer, no detail"
    // from a legacy event (field absent → undefined).
    expect(turnEnd.stopDetails).toBeNull();
  });

  it('produces a valid rebuilt provider message history after a refusal with orphan tool_use', async () => {
    // Regression: roborev job 803 Finding 1. Before the fix, a terminal stop
    // (refusal / context_window_exceeded / max_output_tokens / stop_sequence)
    // with unexecuted tool_use blocks would write a tool_use durable event
    // with no result. On the NEXT turn the rebuilder produced
    //   [user, assistant{tool_use}, user(new prompt)]
    // which Anthropic rejects (assistant tool_use must be followed by a
    // user tool_result). The fix synthesizes a cancelled tool_result at write
    // time so the durable log rebuilds into a valid provider conversation.
    const provider = new ScriptedProvider([
      {
        content: 'I cannot continue.',
        toolCalls: [{ id: 'toolu_orphan', name: 'bash', arguments: { command: 'rm -rf /' } }],
        stopReason: 'refusal',
        stopDetails: {
          type: 'refusal',
          category: 'cyber',
          explanation: null,
          source: 'anthropic_classifier',
        },
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      },
    ]);

    const toolExecutor = makeToolExecutor();
    const { promise } = runOnce(provider, toolExecutor);
    await promise;

    // Simulate a follow-up turn: the rebuilt history is what would be fed to
    // the provider when the user sends their next prompt. Every assistant
    // tool_use MUST be paired with a user tool_result.
    const { messages } = buildProviderMessagesFromDurableEvents(sessionDir);

    // Walk every assistant tool_use and assert the immediately-following
    // message is a user with a tool_result matching the same call id.
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role !== 'assistant' || !Array.isArray(m.toolCalls) || m.toolCalls.length === 0) {
        continue;
      }
      const next = messages[i + 1];
      expect(next).toBeDefined();
      expect(next!.role).toBe('user');
      const ids = new Set((next!.toolResults ?? []).map((r) => r.id));
      for (const call of m.toolCalls) {
        expect(ids.has(call.id)).toBe(true);
      }
    }

    // Sanity: the orphan tool_use we wrote did get paired.
    const allCallIds = messages
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => (m.toolCalls ?? []).map((c) => c.id));
    expect(allCallIds).toContain('toolu_orphan');
  });
});
