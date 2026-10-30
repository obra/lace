// ABOUTME: Exercises bounded wording-triggered completion reminders after tool use.
// ABOUTME: Keeps terminal completion independent of prose about future work.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { ToolExecutor } from '@lace/agent/tools/executor';
import { FileReadTool } from '@lace/agent/tools/implementations/file_read';
import { FileWriteTool } from '@lace/agent/tools/implementations/file_write';
import { readDurableEvents } from '@lace/agent/storage/event-log';

/**
 * Provider whose responses are a per-call script. The first model call gets
 * responses[0], the second responses[1], etc. After the script is exhausted,
 * it keeps returning the final scripted response (so the runner is never
 * starved if it elects to retry more times than scripted).
 *
 * Tracks call count so tests can assert how many model calls the runner made.
 */
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

/**
 * Build a minimal "tool exists" stub: the runner only reads `tool.annotations`
 * (for permission gating). With approvalMode='approve' permission is skipped
 * anyway, so an empty annotations field is sufficient.
 */
function fakeTool(name: string): CoreTool {
  return { name, annotations: undefined } as unknown as CoreTool;
}

/**
 * Per-call queue of tool results. Tools are matched purely by call order.
 * If the runner calls the executor more times than results were provided,
 * a default 'completed' result is returned to keep things going.
 */
function makeToolExecutor(toolResults: Array<Omit<CoreToolResult, 'id'>>) {
  let idx = 0;
  return {
    getTool: (name: string): CoreTool | undefined => fakeTool(name),
    execute: async (toolCall: ToolCall, _context: ToolContext): Promise<CoreToolResult> => {
      const next =
        toolResults[idx++] ??
        ({
          status: 'completed',
          content: [{ type: 'text', text: 'default scripted tool result' }],
        } as Omit<CoreToolResult, 'id'>);
      return { ...next, id: toolCall.id } as CoreToolResult;
    },
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

describe('ConversationRunner — completion reminders after tool use', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-intent-text-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-intent-text-cwd-${testId}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    // Seed system_prompt_set at eventSeq 1 so the runner's invariant check passes.
    // All real sessions must have one; nextEventSeq: 2 so appendDurableEvent starts at 2.
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
      sessionId: 'sess_intent_text',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
  }

  function runOnce(
    provider: AIProvider,
    toolExecutor: ReturnType<typeof makeToolExecutor>,
    maxTurns?: number
  ) {
    const runner = new ConversationRunner(makeConfig(), createMockDeps(provider, toolExecutor));
    return runner.run({
      content: [{ type: 'text', text: 'prompt under test' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns,
    });
  }

  it('reminds once for a standalone promise and accepts repeated future intent', async () => {
    const provider = new ScriptedProvider([
      // Turn 1: tool_use(generic_tool) — pretend the model decided to act.
      {
        content: "I'll check the input now.",
        toolCalls: [{ id: 'call_1', name: 'generic_tool', arguments: { path: 'foo.txt' } }],
        stopReason: 'tool_use',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
      // Turn 2: text-only INTENT, no tool_use. THIS is the production-shape bug.
      {
        content: 'I will now apply the change.',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      },
      // Turn 3 (in case the runner retries): still intent text, no tool_use.
      {
        content: 'Yes, I will now apply the change.',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { promptTokens: 14, completionTokens: 9, totalTokens: 23 },
      },
    ]);

    const toolExecutor = makeToolExecutor([
      {
        status: 'completed',
        content: [{ type: 'text', text: 'tool ran ok; result is empty' }],
      } as Omit<CoreToolResult, 'id'>,
    ]);

    const requests = vi.spyOn(provider, 'createStreamingResponse');
    const result = await runOnce(provider, toolExecutor);

    expect(requests.mock.calls.filter((call) => call[5]?.toolChoice === 'required')).toHaveLength(
      1
    );
    expect(provider.callCount).toBe(3);
    expect(result.stopReason).toBe('end_turn');
  });

  it('allows conditional external deferral after reading the real todo', async () => {
    const artifact = join(cwd, 'todo.md');
    const todo = 'Ask Ada for the delivery date; hold the todo until she answers.\n';
    writeFileSync(artifact, todo);
    const report = "I'll hold the todo until she answers.";
    const provider = new ScriptedProvider([
      {
        content: 'Reading the pending todo.',
        toolCalls: [{ id: 'read-todo', name: 'file_read', arguments: { path: artifact } }],
        stopReason: 'tool_use',
      },
      { content: report, toolCalls: [], stopReason: 'end_turn' },
      {
        content: 'Checking the pending condition.',
        toolCalls: [{ id: 'verify-todo', name: 'file_read', arguments: { path: artifact } }],
        stopReason: 'tool_use',
      },
      { content: report, toolCalls: [], stopReason: 'end_turn' },
    ]);
    const requests = vi.spyOn(provider, 'createStreamingResponse');
    const executor = new ToolExecutor();
    executor.registerTools([new FileReadTool()]);

    const result = await runOnce(provider, executor);

    expect(readFileSync(artifact, 'utf8')).toBe(todo);
    expect(
      readDurableEvents(sessionDir, { types: ['tool_use'] }).events.map((event) => ({
        id: event.data.toolCallId,
        outcome: event.data.result?.outcome,
      }))
    ).toEqual([
      { id: 'read-todo', outcome: 'completed' },
      { id: 'verify-todo', outcome: 'completed' },
    ]);
    expect(result.stopReason).toBe('end_turn');
    expect(result.content).toEqual([{ type: 'text', text: report }]);
    expect(provider.callCount).toBe(4);
    expect(requests.mock.calls.filter((call) => call[5]?.toolChoice === 'required')).toHaveLength(
      1
    );
  });

  it.each([2, 20])(
    'ends first future-intent text on final round %s without an unusable reminder',
    async (maxTurns) => {
      const report = 'I will now apply the change.';
      const responses: ProviderResponse[] = Array.from({ length: maxTurns - 1 }, (_, index) => ({
        content: 'Checking the input.',
        toolCalls: [{ id: `check-${index}`, name: 'generic_tool', arguments: {} }],
        stopReason: 'tool_use',
      }));
      responses.push({ content: report, toolCalls: [], stopReason: 'end_turn' });
      const provider = new ScriptedProvider(responses);
      const requests = vi.spyOn(provider, 'createStreamingResponse');

      const result = await runOnce(provider, makeToolExecutor([]), maxTurns);

      expect(result.stopReason).toBe('end_turn');
      expect(result.content).toEqual([{ type: 'text', text: report }]);
      expect(provider.callCount).toBe(maxTurns);
      expect(requests.mock.calls.filter((call) => call[5]?.toolChoice === 'required')).toHaveLength(
        0
      );
    }
  );

  /**
   * SCENARIO 2 — negative test: pure text turn 1 (no prior tool) is legitimate.
   *
   * A model can legitimately answer a non-tool-requiring question with just
   * text on the first turn. The fix for kata #31 must NOT regress this — it
   * must only act on the "intent-text AFTER a tool round-trip" shape, not on
   * every text-only response.
   */
  it('PASSING — single text-only turn (no prior tool use) terminates cleanly with stopReason=end_turn', async () => {
    const provider = new ScriptedProvider([
      {
        content: 'The answer to your question is 42.',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
      },
      // If runner retries unexpectedly, keep returning the same final answer.
      {
        content: 'The answer to your question is 42.',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
      },
    ]);

    const toolExecutor = makeToolExecutor([]);

    const result = await runOnce(provider, toolExecutor);

    expect(result.stopReason).toBe('end_turn');
    expect(result.content[0]?.text).toBe('The answer to your question is 42.');
  });

  it('reminds once for an observation followed by a promise and accepts the final text', async () => {
    const provider = new ScriptedProvider([
      {
        content: 'Let me read the persona file first.',
        toolCalls: [{ id: 'call_1', name: 'file_read', arguments: { path: 'persona/persona.md' } }],
        stopReason: 'tool_use',
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      },
      {
        content: "The file is essentially empty. I'll add a brief note at the end in Ada's voice.",
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { promptTokens: 24, completionTokens: 18, totalTokens: 42 },
      },
      {
        content: "I'll add a brief note at the end in Ada's voice now.",
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { promptTokens: 26, completionTokens: 14, totalTokens: 40 },
      },
    ]);

    const toolExecutor = makeToolExecutor([
      {
        status: 'completed',
        content: [{ type: 'text', text: '' }],
      } as Omit<CoreToolResult, 'id'>,
    ]);

    const result = await runOnce(provider, toolExecutor);

    expect(provider.callCount).toBe(3);
    expect(result.stopReason).toBe('end_turn');
  });

  /**
   * SCENARIO 4 — negative test: multi-tool follow-through with explicit
   * completion summary IS legitimate.
   *
   * The model:
   *   • Turn 1: file_read tool_use
   *   • Turn 2: file_write tool_use (acts on what it just read)
   *   • Turn 3: text-only "Done. Updated successfully." (past-tense summary,
   *     no future-tense intent).
   *
   * A correct fix must let this scenario complete cleanly — stopReason
   * 'end_turn', summary text as final content. This test guards against
   * over-correcting (e.g. treating *any* no-tool-after-tool turn as
   * incomplete).
   */
  it('PASSING — multi-tool follow-through with past-tense completion summary terminates cleanly', async () => {
    const provider = new ScriptedProvider([
      // Turn 1: file_read
      {
        content: 'Reading the file.',
        toolCalls: [{ id: 'call_1', name: 'file_read', arguments: { path: 'note.md' } }],
        stopReason: 'tool_use',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
      // Turn 2: file_write — actually does the work.
      {
        content: 'Updating the file.',
        toolCalls: [
          {
            id: 'call_2',
            name: 'file_write',
            arguments: { path: 'note.md', content: 'updated' },
          },
        ],
        stopReason: 'tool_use',
        usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
      },
      // Turn 3: completion summary — past-tense, no future-tense intent.
      {
        content: 'Done. Updated note.md successfully.',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { promptTokens: 14, completionTokens: 8, totalTokens: 22 },
      },
      // Stable response if runner retries beyond the script.
      {
        content: 'Done. Updated note.md successfully.',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { promptTokens: 14, completionTokens: 8, totalTokens: 22 },
      },
    ]);

    const toolExecutor = makeToolExecutor([
      {
        status: 'completed',
        content: [{ type: 'text', text: 'old content' }],
      } as Omit<CoreToolResult, 'id'>,
      {
        status: 'completed',
        content: [{ type: 'text', text: 'wrote 7 bytes' }],
      } as Omit<CoreToolResult, 'id'>,
    ]);

    const result = await runOnce(provider, toolExecutor);

    expect(result.stopReason).toBe('end_turn');
    expect(result.content[0]?.text).toContain('Done');
  });

  describe.each([
    {
      shape: 'multiple paragraphs',
      report:
        "I'll report the result.\n\nThe requested update is saved.\n\nNothing further to change.",
    },
    {
      shape: 'one compact paragraph',
      report: "I'll report the result. The requested update is saved.",
    },
    {
      shape: 'a negated contracted promise',
      report:
        "The missing detail is a gap for the handoff owner, not something I'll invent on their behalf.",
    },
    {
      shape: 'a negated uncontracted promise',
      report: 'The missing detail is not something I will invent on their behalf.',
    },
    {
      shape: 'a terminal turn-closing declaration',
      report: "The requested update is saved, so I'll end the turn.",
    },
    {
      shape: 'an uncontracted turn-closing declaration',
      report: 'The requested update is saved. I will end the turn.',
    },
  ])('completed report in $shape', ({ report }) => {
    it.each([false, true])(
      'finishes naturally after real work (verification retry already used: %s)',
      async (verify) => {
        const artifact = join(cwd, 'result.txt');
        const responses: ProviderResponse[] = [
          {
            content: 'Writing the requested update.',
            toolCalls: [
              {
                id: 'write-result',
                name: 'file_write',
                arguments: { path: artifact, content: 'The requested update.\n' },
              },
            ],
            stopReason: 'tool_use',
          },
        ];
        if (verify) {
          responses.push(
            {
              content: 'The file is written. I will now verify it.',
              toolCalls: [],
              stopReason: 'end_turn',
            },
            {
              content: 'Checking the saved update.',
              toolCalls: [{ id: 'read-result', name: 'file_read', arguments: { path: artifact } }],
              stopReason: 'tool_use',
            }
          );
        }
        responses.push({ content: report, toolCalls: [], stopReason: 'end_turn' });
        const provider = new ScriptedProvider(responses);
        const requests = vi.spyOn(provider, 'createStreamingResponse');
        const executor = new ToolExecutor();
        executor.registerTools([new FileReadTool(), new FileWriteTool()]);

        const result = await runOnce(provider, executor);

        expect(readFileSync(artifact, 'utf8')).toBe('The requested update.\n');
        expect(result.stopReason).toBe('end_turn');
        expect(result.content[0]?.text).toBe(report);
        expect(provider.callCount).toBe(verify ? 4 : 2);
        expect(
          requests.mock.calls.filter((call) => call[5]?.toolChoice === 'required')
        ).toHaveLength(verify ? 1 : 0);
      }
    );
  });

  it.each([
    "The missing detail is not something I'll invent, but I'll verify the source.",
    "I'll write the follow-up, then I'll end the turn.",
    "I'll write the follow-up, so I'll end the turn.",
    "I'll end the turn after I write the follow-up.",
    "I'll end the turn and write the follow-up.",
    "After I verify the saved file, I'll end the turn.",
    'Once I check the saved file, I will end the turn.',
  ])('reminds once for future work despite turn-closing language: %s', async (report) => {
    const artifact = join(cwd, 'result.txt');
    const provider = new ScriptedProvider([
      {
        content: 'Writing the requested update.',
        toolCalls: [
          {
            id: 'write-result',
            name: 'file_write',
            arguments: { path: artifact, content: 'The requested update.\n' },
          },
        ],
        stopReason: 'tool_use',
      },
      { content: report, toolCalls: [], stopReason: 'end_turn' },
    ]);
    const requests = vi.spyOn(provider, 'createStreamingResponse');
    const executor = new ToolExecutor();
    executor.registerTools([new FileReadTool(), new FileWriteTool()]);

    const result = await runOnce(provider, executor);

    expect(readFileSync(artifact, 'utf8')).toBe('The requested update.\n');
    expect(result.stopReason).toBe('end_turn');
    expect(provider.callCount).toBe(3);
    expect(requests.mock.calls.filter((call) => call[5]?.toolChoice === 'required')).toHaveLength(
      1
    );
  });
});
