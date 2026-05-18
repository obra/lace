// ABOUTME: Pins kata #31 (round 2) — subagent terminates with stopReason='end_turn'
// ABOUTME: when the model returns text-only intent after a successful tool round-trip.
// ABOUTME: Tests 1+3 FAIL on current code (production-shape bug). Tests 2+4 PASS.
// ABOUTME: TEST-ONLY. The fix is a separate worker's job — do not modify the runner here.

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
    queueNotification: vi.fn(),
    flushNotifications: vi.fn().mockReturnValue([]),
    getNotificationQueue: vi.fn().mockReturnValue([]),
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

describe('ConversationRunner — intent-text-after-tool-result (kata #31 round 2)', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-intent-text-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-intent-text-cwd-${testId}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({ nextEventSeq: 1, nextStreamSeq: 1 })
    );
    writeFileSync(join(sessionDir, 'events.jsonl'), '');
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

  function runOnce(provider: AIProvider, toolExecutor: ReturnType<typeof makeToolExecutor>) {
    const runner = new ConversationRunner(makeConfig(), createMockDeps(provider, toolExecutor));
    return runner.run({
      content: [{ type: 'text', text: 'prompt under test' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * SCENARIO 1 — production-shape bug (generic tool).
   *
   * Production parallel:
   *   • subagent (any persona)
   *   • Turn 1: model emits a tool_use (e.g. file_read)
   *   • Tool returns a result the model can act on
   *   • Turn 2: model returns *intent text only* — "I will now do X" — with
   *     stopReason='end_turn' and no tool_use.
   *   • Runner currently accepts this as terminal → subagent finishes with
   *     stopReason='end_turn' and the intent string as final content. The work
   *     the model promised to do never happens. (Job logs as 'completed' but
   *     produces a degenerate output.)
   *
   * Behaviour pinned by this test:
   *   When the model declares intent (future-tense, no tool_use) on a turn
   *   that follows a tool round-trip, the runner MUST NOT exit with
   *   stopReason='end_turn'. Some other stopReason (e.g. a new
   *   'incomplete'/'no_action', or the existing 'max_turns') should be
   *   returned so the parent agent / caller can distinguish "subagent did
   *   the work and explained it" from "subagent declared it would and
   *   didn't".
   *
   * What a fix needs to make this pass:
   *   • Detect "no tool_calls after a tool round-trip + future-tense intent
   *     marker in the content" and either retry harder, surface an
   *     'incomplete' status, or otherwise signal non-clean termination.
   *   • The runner already has a one-shot retriedWithToolChoice path. Making
   *     this test pass requires extending that beyond a single retry, or
   *     reclassifying the terminal stopReason for this pattern.
   */
  it('FAILING — intent-text after tool round-trip should NOT terminate with stopReason=end_turn', async () => {
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
      // A robust fix must not accept this either.
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

    const result = await runOnce(provider, toolExecutor);

    // Sanity: tool round-trip actually happened, and provider was asked again.
    expect(provider.callCount).toBeGreaterThanOrEqual(2);

    // FAILING ASSERTION — pins the bug:
    // Today the runner returns stopReason='end_turn' here with intent text
    // as the final content. A fix must surface a non-end_turn stopReason so
    // callers can tell the subagent did not actually complete the work it
    // declared.
    expect(result.stopReason).not.toBe('end_turn');
  });

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

  /**
   * SCENARIO 3 — therapist-persona production reproduction.
   *
   * Direct parallel to the production smoke trace:
   *   • Persona has tools: [file_read, file_write].
   *   • Turn 1: file_read tool_use on persona/persona.md.
   *   • Tool result: file content is empty.
   *   • Turn 2: "The file is essentially empty. I'll add a brief note at the
   *     end in Ada's voice." — text-only, stopReason='end_turn', no tool_use.
   *   • Production observed: subagent terminated as 'completed', host file
   *     unchanged.
   *
   * Same pinned behaviour as Scenario 1, but with the exact production phrase
   * and tool. This catches a fix that hand-tunes for one wording but misses
   * the therapist phrasing or vice versa.
   */
  it('FAILING — therapist-style file_read + intent-text should NOT terminate with stopReason=end_turn', async () => {
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

    expect(provider.callCount).toBeGreaterThanOrEqual(2);

    // FAILING ASSERTION — pins the production bug.
    // A subagent that says "I'll add a brief note" without calling
    // file_write must not be reported as a clean end_turn.
    expect(result.stopReason).not.toBe('end_turn');
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
});
