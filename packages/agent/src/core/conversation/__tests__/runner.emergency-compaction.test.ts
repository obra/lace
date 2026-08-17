// ABOUTME: Tests the emergency compaction self-heal (PRI-2903) — a turn that the
// ABOUTME: provider rejects with context_window_exceeded compacts the session,
// ABOUTME: tells the agent it happened, and retries the turn exactly once. A
// ABOUTME: second rejection surfaces as a failed turn rather than compacting again.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import {
  appendDurableEvent,
  invalidatePersonaCache,
  readDurableEvents,
} from '@lace/agent/storage/event-log';
import { readSessionState, writeSessionState } from '@lace/agent/storage/session-store';
import { injectNotification } from '@lace/agent/notifications/inject-notification';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
  type WireTool,
} from '@lace/agent/providers/base-provider';
import { resetRegistriesForTest } from '@lace/agent/plugins';

const CONTEXT_EXCEEDED: ProviderResponse = {
  content: '',
  toolCalls: [],
  stopReason: 'context_window_exceeded',
  stopDetails: { type: 'context_window_exceeded', source: 'http_400_prompt_too_long' },
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  // Providers with server-side conversation state hand back a response id that
  // the runner chains onto the next call.
  responseId: 'resp_pre_compaction',
};

const CLEAN_TURN: ProviderResponse = {
  content: 'Recovered and answered.',
  toolCalls: [],
  stopReason: 'end_turn',
  usage: { promptTokens: 50_000, completionTokens: 10, totalTokens: 50_010 },
};

/** Scripted provider that records what was actually sent on every call. */
class ScriptedProvider extends AIProvider {
  callCount = 0;
  readonly sentMessages: ProviderMessage[][] = [];
  readonly sentSystemPrompts: string[] = [];
  readonly sentPreviousResponseIds: (string | undefined)[] = [];

  /**
   * @param beforeRespond runs before each scripted response is returned, with
   *   the 0-based call index. Models a peer writing to the durable log while
   *   the provider call is in flight.
   */
  constructor(
    private readonly script: ProviderResponse[],
    private readonly beforeRespond?: (callIndex: number) => void
  ) {
    super();
  }

  get providerName(): string {
    return 'scripted-emergency-compaction';
  }

  getProviderInfo() {
    return {
      name: 'scripted-emergency-compaction',
      displayName: 'Scripted Emergency Compaction',
      requiresApiKey: false,
    };
  }

  isConfigured(): boolean {
    return true;
  }

  get supportsStreaming(): boolean {
    return true;
  }

  // Large window so ordinary pressure breakpoints never fire — the only
  // compaction these tests can observe is the emergency one.
  override contextWindowForModel(_modelId: string, _fallback?: number): number {
    return 1_000_000;
  }

  protected async _createResponseImpl(
    messages: ProviderMessage[],
    tools: WireTool[],
    model: string,
    signal?: AbortSignal,
    state?: ConversationState,
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    return this._createStreamingResponseImpl(messages, tools, model, signal, state, options);
  }

  protected async _createStreamingResponseImpl(
    messages: ProviderMessage[],
    _tools: WireTool[],
    _model: string,
    _signal?: AbortSignal,
    state?: ConversationState,
    _options?: RequestOptions
  ): Promise<ProviderResponse> {
    this.sentMessages.push(structuredClone(messages));
    this.sentSystemPrompts.push(this.systemPrompt);
    this.sentPreviousResponseIds.push(state?.previousResponseId ?? undefined);
    const step = this.script[Math.min(this.callCount, this.script.length - 1)]!;
    this.beforeRespond?.(this.callCount);
    this.callCount++;
    return step;
  }
}

function createMockDeps(
  provider: AIProvider,
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
      executor: {
        getTool: vi.fn().mockReturnValue(undefined),
        execute: vi.fn().mockResolvedValue({ status: 'completed', content: [] }),
      },
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

/** Flatten a sent message list to the plain text the model would actually read. */
function messagesAsText(messages: ProviderMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const content = m.content as unknown;
    if (typeof content === 'string') parts.push(content);
    else if (Array.isArray(content)) {
      for (const block of content as Array<{ text?: unknown }>) {
        if (typeof block?.text === 'string') parts.push(block.text);
      }
    }
  }
  return parts.join('\n');
}

describe('ConversationRunner — emergency compaction on context_window_exceeded', () => {
  let laceDir: string;
  let sessionDir: string;
  let sessionId: string;
  let cwd: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-emergency-compaction-test-'));
    sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    cwd = join(tmpdir(), `lace-emergency-compaction-cwd-${randomUUID().substring(0, 8)}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    // Seed enough completed turns that the track-based strategy produces a real
    // compaction event rather than a noop.
    const now = new Date().toISOString();
    const lines: string[] = [
      JSON.stringify({
        eventSeq: 1,
        timestamp: now,
        type: 'system_prompt_set',
        data: { type: 'system_prompt_set', text: 'You are a test assistant.' },
      }),
    ];
    let seq = 2;
    for (let i = 0; i < 11; i++) {
      const tid = `pre_turn_${i}`;
      lines.push(
        JSON.stringify({
          eventSeq: seq++,
          timestamp: now,
          type: 'prompt',
          data: { type: 'prompt', content: [{ type: 'text', text: `seed prompt ${i}` }] },
        })
      );
      lines.push(
        JSON.stringify({
          eventSeq: seq++,
          timestamp: now,
          turnId: tid,
          type: 'turn_start',
          data: { type: 'turn_start' },
        })
      );
      lines.push(
        JSON.stringify({
          eventSeq: seq++,
          timestamp: now,
          turnId: tid,
          type: 'message',
          data: { type: 'message', content: [{ type: 'text', text: `seed answer ${i}` }] },
        })
      );
      lines.push(
        JSON.stringify({
          eventSeq: seq++,
          timestamp: now,
          turnId: tid,
          type: 'turn_end',
          data: { type: 'turn_end', stopReason: 'end_turn' },
        })
      );
    }

    writeFileSync(join(sessionDir, 'events.jsonl'), lines.join('\n') + '\n');
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({ nextEventSeq: seq, nextStreamSeq: 1 })
    );
    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({ sessionId, workDir: cwd, created: now, persona: 'test' })
    );

    savedLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
    resetRegistriesForTest();
  });

  afterEach(() => {
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    if (existsSync(laceDir)) rmSync(laceDir, { recursive: true, force: true });
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  function run(provider: AIProvider, depOverrides: Partial<RunnerDependencies> = {}) {
    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps(provider, depOverrides);
    const runner = new ConversationRunner(config, deps);
    return {
      deps,
      promise: runner.run({
        content: [{ type: 'text', text: 'the prompt that overflowed the window' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      }),
    };
  }

  function durableEvents() {
    return readDurableEvents(sessionDir, { limit: Number.MAX_SAFE_INTEGER }).events;
  }

  it('compacts and retries the turn once, so the turn completes', async () => {
    const provider = new ScriptedProvider([CONTEXT_EXCEEDED, CLEAN_TURN]);
    const { promise } = run(provider);
    const result = await promise;

    expect(provider.callCount).toBe(2);
    expect(result.stopReason).toBe('end_turn');
    expect(durableEvents().filter((e) => e.type === 'context_compacted')).toHaveLength(1);
  });

  it('sends the COMPACTED history on the retry, not the history that just 400d', async () => {
    const provider = new ScriptedProvider([CONTEXT_EXCEEDED, CLEAN_TURN]);
    await run(provider).promise;

    const [first, second] = provider.sentMessages;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The whole point: the retry must not re-send the oversized conversation.
    // The compacted history replaces the seeded turns with a summary, so it is
    // strictly shorter than what the provider just rejected.
    expect(second!.length).toBeLessThan(first!.length);
    // The oldest turns are no longer sent verbatim; they arrive as a summary.
    expect(messagesAsText(first!)).not.toContain('compacted by track');
    expect(messagesAsText(second!)).toContain('compacted by track');
  });

  it('tells the agent an emergency compaction ran, in the retry request itself', async () => {
    const provider = new ScriptedProvider([CONTEXT_EXCEEDED, CLEAN_TURN]);
    await run(provider).promise;

    // Durable, so the notice survives a restart and future turns.
    const injected = durableEvents().filter(
      (e) =>
        e.type === 'context_injected' &&
        JSON.stringify(e.data).includes('kind=\\"emergency-compaction\\"')
    );
    expect(injected).toHaveLength(1);

    // Delivered: the agent sees the explanation on the very turn that lost the
    // history, not one turn later.
    const retryText = messagesAsText(provider.sentMessages[1]!);
    expect(retryText).toContain('kind="emergency-compaction"');
    // Exactly once — the projection and the inject tailer must not both add it.
    expect(retryText.split('kind="emergency-compaction"')).toHaveLength(2);
  });

  it('gives up rather than looping when compaction cannot get back under the window', async () => {
    // A provider that NEVER stops rejecting. The emergency budget is the only
    // thing that can stop this — the retry cancels the loop's turn increment,
    // so maxTurns cannot backstop it. Without a hard bound this run never ends.
    const provider = new ScriptedProvider([CONTEXT_EXCEEDED]);
    const { promise } = run(provider);
    const result = await promise;

    expect(result.stopReason).toBe('context_window_exceeded');
    expect(result.stopDetails).toEqual(CONTEXT_EXCEEDED.stopDetails);
    // Follows from MAX_EMERGENCY_COMPACTIONS = 2: two compactions are spent,
    // and the third rejection has no budget left, so it ends the turn.
    expect(durableEvents().filter((e) => e.type === 'context_compacted')).toHaveLength(2);
    expect(provider.callCount).toBe(3);
  });

  it('delivers a peer inject that lands during the compaction exactly once', async () => {
    // A Slack message or job completion arriving while the oversized call is
    // failing (10.7s in the live incident) is folded into the rebuilt
    // projection AND sits past the inject tailer's pre-call watermark. If the
    // tailer is not re-seeded on the rebuild, the model sees it twice.
    const marker = 'PEER-INJECT-DURING-COMPACTION';
    const provider = new ScriptedProvider([CONTEXT_EXCEEDED, CLEAN_TURN], (callIndex) => {
      if (callIndex !== 0) return;
      injectNotification({
        sessionDir,
        kind: 'job-completed',
        body: marker,
      });
    });
    await run(provider).promise;

    expect(provider.callCount).toBe(2);
    const retryText = messagesAsText(provider.sentMessages[1]!);
    expect(retryText).toContain(marker);
    expect(retryText.split(marker)).toHaveLength(2);
  });

  it('does not glue pre-compaction partial generation onto the recovered answer', async () => {
    // pause_turn accumulates text across iterations for a single durable
    // 'message' event. If the emergency retry does not clear that accumulator,
    // the partial the model produced against the OLD context is concatenated
    // onto the answer it produces against the compacted one, and that
    // corrupted splice is what gets persisted.
    const partial = 'PARTIAL-PRECOMPACTION-TEXT';
    const provider = new ScriptedProvider([
      {
        content: partial,
        toolCalls: [],
        stopReason: 'pause_turn',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
      CONTEXT_EXCEEDED,
      CLEAN_TURN,
    ]);
    const { promise } = run(provider);
    const result = await promise;

    expect(result.stopReason).toBe('end_turn');
    const answer = CLEAN_TURN.content as string;
    expect(result.content).toEqual([{ type: 'text', text: answer }]);

    const messages = durableEvents().filter(
      (e) => e.type === 'message' && JSON.stringify(e.data).includes(answer)
    );
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0]!.data)).not.toContain(partial);
  });

  it('drops the pre-compaction response chain on the retry', async () => {
    // previousResponseId identifies a server-side conversation keyed to the
    // message list we just replaced.
    const provider = new ScriptedProvider([CONTEXT_EXCEEDED, CLEAN_TURN]);
    await run(provider).promise;

    expect(provider.sentPreviousResponseIds[0]).toBeUndefined();
    expect(provider.sentPreviousResponseIds[1]).toBeUndefined();
  });

  it('retries with the system prompt the compaction re-rendered', async () => {
    // Compaction re-renders the persona, which can write a new
    // system_prompt_set. The retry must send the new one, not the prompt the
    // turn started with.
    const rerenderedPrompt = 'You are a test assistant, re-rendered after compaction.';
    const provider = new ScriptedProvider([CONTEXT_EXCEEDED, CLEAN_TURN]);
    await run(provider, {
      rerenderPersonaAfterCompaction: vi.fn().mockImplementation(async () => {
        const state = readSessionState(sessionDir);
        const { nextState } = appendDurableEvent(sessionDir, state, {
          type: 'system_prompt_set',
          data: { type: 'system_prompt_set', text: rerenderedPrompt },
        });
        writeSessionState(sessionDir, nextState);
      }),
    }).promise;

    expect(provider.sentSystemPrompts[0]).toBe('You are a test assistant.');
    expect(provider.sentSystemPrompts[1]).toBe(rerenderedPrompt);
  });

  it('does not compact when the turn never exceeds the window', async () => {
    const provider = new ScriptedProvider([CLEAN_TURN]);
    await run(provider).promise;

    expect(durableEvents().filter((e) => e.type === 'context_compacted')).toHaveLength(0);
    expect(
      durableEvents().filter((e) => JSON.stringify(e.data).includes('emergency-compaction'))
    ).toHaveLength(0);
  });
});
