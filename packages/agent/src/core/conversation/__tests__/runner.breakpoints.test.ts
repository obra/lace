// ABOUTME: Integration tests for configurable compaction breakpoints (Task 4)
// ABOUTME: Verifies that a notify breakpoint injects a notification (no compaction),
// ABOUTME: a compact breakpoint triggers compaction, highestFiredBreakpointAt persists
// ABOUTME: and resets when pressure drops, and noop sessions fire once then go quiet.
//
// The persona→breakpoints unit path is covered by select.test.ts. These tests
// mock compactionBreakpointsForSession so the runner wiring tests do not depend
// on the singleton personaRegistry seeing test-specific persona files.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { invalidatePersonaCache, readDurableEvents } from '@lace/agent/storage/event-log';
import { readSessionState } from '@lace/agent/storage/session-store';
import {
  AIProvider,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
  type ProviderMessage,
} from '@lace/agent/providers/base-provider';
import type { Tool } from '@lace/agent/tools/tool';
import { ToolExecutor } from '@lace/agent/tools/executor';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';
import { resetRegistriesForTest } from '@lace/agent/plugins';
import { estimateProviderTokens } from '@lace/agent/message-building/message-builder';

// ---------------------------------------------------------------------------
// Mock compactionBreakpointsForSession so persona file loading is not required
// ---------------------------------------------------------------------------
vi.mock('@lace/agent/compaction/select', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lace/agent/compaction/select')>();
  return {
    ...actual,
    compactionBreakpointsForSession: vi.fn(),
  };
});

import {
  compactionBreakpointsForSession,
  DEFAULT_BREAKPOINTS,
} from '@lace/agent/compaction/select';
const mockBreakpoints = vi.mocked(compactionBreakpointsForSession);

// ---------------------------------------------------------------------------
// Shared mock helpers (mirror runner.compact-session.test.ts pattern)
// ---------------------------------------------------------------------------

function createMockDeps(overrides: Partial<RunnerDependencies> = {}): RunnerDependencies {
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
      executor: {
        getTool: vi.fn().mockReturnValue(null),
        execute: vi
          .fn()
          .mockResolvedValue({ status: 'completed', content: [{ type: 'text', text: 'mock' }] }),
      },
      toolsForProvider: [],
    }),
    createProvider: vi.fn().mockImplementation(async () => new ScriptedProvider([])),
    getModelPricing: vi.fn().mockResolvedValue(null),
    startShellJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    startSubagentJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    deriveJobs: vi.fn().mockReturnValue([]),
    finalizeJob: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockReturnValue(undefined),
    jobManager: mockJobManager as unknown as RunnerDependencies['jobManager'],
    mcpServerManager: undefined,
    setActiveTurnStatus: vi.fn(),
    getSessionCostUsd: vi.fn().mockReturnValue(0),
    updateSessionUsage: vi.fn(),
    ...overrides,
  };
}

/** Provider with a scripted sequence of responses. */
class ScriptedProvider extends AIProvider {
  callCount = 0;

  constructor(
    private readonly script: ProviderResponse[],
    private readonly windowSize = 1_000_000
  ) {
    super();
  }

  get providerName(): string {
    return 'scripted-bp-test';
  }
  getProviderInfo() {
    return { name: 'scripted-bp-test', displayName: 'ScriptedBP', requiresApiKey: false };
  }
  isConfigured(): boolean {
    return true;
  }
  get supportsStreaming(): boolean {
    return true;
  }
  override contextWindowForModel(_modelId: string, _fallback?: number): number {
    return this.windowSize;
  }
  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    state?: ConversationState,
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    return this.createStreamingResponse(messages, tools, model, signal, state, options);
  }
  async createStreamingResponse(): Promise<ProviderResponse> {
    const step = this.script[this.callCount++];
    if (!step) {
      return {
        content: 'fallback',
        toolCalls: [],
        stopReason: 'stop',
        usage: { promptTokens: 50_000, completionTokens: 10, totalTokens: 50_010 },
      };
    }
    return step;
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Seed a session with enough prior turns that the track-based strategy
 * produces a real compaction event (not a noop). Mirrors the pattern in
 * runner.compact-session.test.ts.
 */
function seedSession(sessionDir: string, sessionId: string, cwd: string, persona?: string): void {
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
        data: { type: 'prompt', content: [{ type: 'text', text: `seed ${i}` }] },
      }),
      JSON.stringify({
        eventSeq: seq++,
        timestamp: now,
        turnId: tid,
        type: 'turn_start',
        data: { type: 'turn_start' },
      }),
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
    JSON.stringify({ sessionId, workDir: cwd, created: now, ...(persona ? { persona } : {}) })
  );
}

/**
 * Like seedSession, but with turns big enough that the compaction's TOKEN
 * budget — not its turn count — decides where the tail split lands.
 */
function seedLargeTurns(
  sessionDir: string,
  sessionId: string,
  cwd: string,
  persona: string,
  count: number,
  chars: number
): void {
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
  for (let i = 0; i < count; i++) {
    const tid = `big_turn_${i}`;
    const push = (type: string, data: Record<string, unknown>, turnId?: string) =>
      lines.push(
        JSON.stringify({
          eventSeq: seq++,
          timestamp: now,
          ...(turnId ? { turnId } : {}),
          type,
          data: { type, ...data },
        })
      );
    push('prompt', { content: [{ type: 'text', text: `big prompt ${i}` }] });
    push('turn_start', {}, tid);
    push('message', { content: [{ type: 'text', text: 'x'.repeat(chars) }] }, tid);
    push('turn_end', { stopReason: 'end_turn' }, tid);
  }
  writeFileSync(join(sessionDir, 'events.jsonl'), lines.join('\n') + '\n');
  writeFileSync(
    join(sessionDir, 'state.json'),
    JSON.stringify({ nextEventSeq: seq, nextStreamSeq: 1 })
  );
  writeFileSync(
    join(sessionDir, 'meta.json'),
    JSON.stringify({ sessionId, workDir: cwd, created: now, persona })
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConversationRunner - configurable breakpoints', () => {
  let laceDir: string;
  let sessionDir: string;
  let sessionId: string;
  let cwd: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-bp-test-'));
    sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    cwd = join(tmpdir(), `lace-bp-cwd-${randomUUID().substring(0, 8)}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    savedLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();

    resetRegistriesForTest();
    registerBuiltinTools();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    if (existsSync(laceDir)) rmSync(laceDir, { recursive: true, force: true });
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  it('crossing a notify breakpoint injects context_injected and does NOT write context_compacted', async () => {
    // Persona breakpoints: only notify at 0.5
    mockBreakpoints.mockReturnValue([{ at: 0.5, action: 'notify' }]);
    seedSession(sessionDir, sessionId, cwd, 'notify-only');

    // Provider returns 600_000 prompt tokens → 60% of 1_000_000 window → crosses 0.5 notify
    const provider = new ScriptedProvider(
      [
        {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 600_000, completionTokens: 10, totalTokens: 600_010 },
        },
      ],
      1_000_000
    );

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      persona: 'notify-only',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner = new ConversationRunner(config, deps);
    await runner.run({
      content: [{ type: 'text', text: 'hello' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const { events } = readDurableEvents(sessionDir, {});

    // A context_injected notification should have been written
    const injected = events.filter((e) => e.type === 'context_injected');
    expect(injected.length).toBeGreaterThanOrEqual(1);

    // No compaction should have happened
    expect(events.some((e) => e.type === 'context_compacted')).toBe(false);
  });

  it('crossing a compact breakpoint writes context_compacted', async () => {
    // Persona breakpoints: compact at 0.5
    mockBreakpoints.mockReturnValue([{ at: 0.5, action: 'compact' }]);
    seedSession(sessionDir, sessionId, cwd, 'compact-low');

    // 60% pressure → crosses 0.5 compact threshold
    const provider = new ScriptedProvider(
      [
        {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 600_000, completionTokens: 10, totalTokens: 600_010 },
        },
      ],
      1_000_000
    );

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      persona: 'compact-low',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner = new ConversationRunner(config, deps);
    await runner.run({
      content: [{ type: 'text', text: 'hello' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const { events } = readDurableEvents(sessionDir, {});
    expect(events.some((e) => e.type === 'context_compacted')).toBe(true);
  });

  it('sizes a breakpoint compaction to the model window, not a fixed 300K (PRI-2906)', async () => {
    // The post-turn trigger is the common case — breakpoints and the
    // compact_session tool both land here — so it is the one that most needs
    // to hand the strategy the right window. A compaction sized for a 1M model
    // leaves a 200K session still over its limit, which is the wedge.
    mockBreakpoints.mockReturnValue([{ at: 0.5, action: 'compact' }]);

    const compactedUnderWindow = async (window: number) => {
      seedLargeTurns(sessionDir, sessionId, cwd, 'compact-low', 12, 200_000);
      const provider = new ScriptedProvider(
        [
          {
            content: 'done',
            toolCalls: [],
            stopReason: 'stop',
            usage: {
              promptTokens: Math.floor(window * 0.6),
              completionTokens: 10,
              totalTokens: Math.floor(window * 0.6) + 10,
            },
          },
        ],
        window
      );
      const executor = new ToolExecutor();
      executor.registerAllAvailableTools({ skillDirs: [] } as any);
      const runner = new ConversationRunner(
        {
          sessionDir,
          sessionId,
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
          persona: 'compact-low',
        },
        createMockDeps({
          createProvider: vi.fn().mockImplementation(async () => provider),
          createToolExecutor: vi.fn().mockReturnValue({
            executor,
            toolsForProvider: executor.getAllTools(),
          }),
        })
      );
      await runner.run({
        content: [{ type: 'text', text: 'hello' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });
      const { events } = readDurableEvents(sessionDir, { limit: Number.MAX_SAFE_INTEGER });
      const compacted = events.filter((e) => e.type === 'context_compacted');
      expect(compacted.length).toBeGreaterThan(0);
      const preserved = (compacted.at(-1)!.data as { preserved: ProviderMessage[] }).preserved;
      return estimateProviderTokens(preserved);
    };

    const narrow = await compactedUnderWindow(200_000);
    const wide = await compactedUnderWindow(1_000_000);

    // The 200K session's compacted history actually fits its window...
    expect(narrow).toBeLessThan(200_000);
    // ...and it is genuinely a different, smaller history than the 1M one,
    // which keeps the 300K ceiling. Equal values mean the window never reached
    // the strategy.
    expect(narrow).toBeLessThan(wide);
  });

  it('crossing a compact breakpoint emits a compaction_complete session update (PRI-2889)', async () => {
    // The post-compaction wake in sen-core subscribes to this update; without it,
    // in-place breakpoint compaction strands in-flight work (ada, 2026-08-14).
    mockBreakpoints.mockReturnValue([{ at: 0.5, action: 'compact' }]);
    seedSession(sessionDir, sessionId, cwd, 'compact-low');

    const provider = new ScriptedProvider(
      [
        {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 600_000, completionTokens: 10, totalTokens: 600_010 },
        },
      ],
      1_000_000
    );

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      persona: 'compact-low',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner = new ConversationRunner(config, deps);
    await runner.run({
      content: [{ type: 'text', text: 'hello' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const compactionUpdates = (deps.onUpdate as ReturnType<typeof vi.fn>).mock.calls
      .map(([, update]) => update)
      .filter((u: { type: string }) => u.type === 'compaction_complete');
    expect(compactionUpdates).toHaveLength(1);
    expect(compactionUpdates[0]).toMatchObject({
      type: 'compaction_complete',
      strategy: expect.any(String),
      messagesCompacted: expect.any(Number),
    });
  });

  it('a notify breakpoint does not emit compaction_complete', async () => {
    mockBreakpoints.mockReturnValue([{ at: 0.5, action: 'notify' }]);
    seedSession(sessionDir, sessionId, cwd, 'notify-low');

    const provider = new ScriptedProvider(
      [
        {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 600_000, completionTokens: 10, totalTokens: 600_010 },
        },
      ],
      1_000_000
    );

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      persona: 'notify-low',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner = new ConversationRunner(config, deps);
    await runner.run({
      content: [{ type: 'text', text: 'hello' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const compactionUpdates = (deps.onUpdate as ReturnType<typeof vi.fn>).mock.calls
      .map(([, update]) => update)
      .filter((u: { type: string }) => u.type === 'compaction_complete');
    expect(compactionUpdates).toHaveLength(0);
  });

  it('highestFiredBreakpointAt persists after a notify crossing', async () => {
    mockBreakpoints.mockReturnValue([{ at: 0.5, action: 'notify' }]);
    seedSession(sessionDir, sessionId, cwd, 'notify-persist');

    const provider = new ScriptedProvider(
      [
        {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 600_000, completionTokens: 10, totalTokens: 600_010 },
        },
      ],
      1_000_000
    );

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      persona: 'notify-persist',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner = new ConversationRunner(config, deps);
    await runner.run({
      content: [{ type: 'text', text: 'hello' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    // After the run, highestFiredBreakpointAt should be 0.5
    const state = readSessionState(sessionDir);
    expect(state.highestFiredBreakpointAt).toBe(0.5);
  });

  it('does not re-fire a notify breakpoint once crossed (once-per-crossing)', async () => {
    mockBreakpoints.mockReturnValue([{ at: 0.5, action: 'notify' }]);
    seedSession(sessionDir, sessionId, cwd, 'notify-once');

    // Pre-set highestFiredBreakpointAt = 0.5 so the breakpoint has already fired
    const initialState = readSessionState(sessionDir);
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({ ...initialState, highestFiredBreakpointAt: 0.5 })
    );

    const provider = new ScriptedProvider(
      [
        {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 600_000, completionTokens: 10, totalTokens: 600_010 },
        },
      ],
      1_000_000
    );

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      persona: 'notify-once',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner = new ConversationRunner(config, deps);
    await runner.run({
      content: [{ type: 'text', text: 'hello' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const { events } = readDurableEvents(sessionDir, {});
    // No context_injected events at all (none from seeding, none from this run)
    const injectedEvents = events.filter((e) => e.type === 'context_injected');
    expect(injectedEvents).toHaveLength(0);
  });

  it('highestFiredBreakpointAt resets to 0 when pressure drops below all breakpoints', async () => {
    mockBreakpoints.mockReturnValue([{ at: 0.5, action: 'notify' }]);
    seedSession(sessionDir, sessionId, cwd, 'notify-reset');

    // Pre-set highestFiredBreakpointAt = 0.5 (already fired once)
    const initialState = readSessionState(sessionDir);
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({ ...initialState, highestFiredBreakpointAt: 0.5 })
    );

    // Pressure at 10% → below the 0.5 threshold → should reset
    const provider = new ScriptedProvider(
      [
        {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 100_000, completionTokens: 10, totalTokens: 100_010 },
        },
      ],
      1_000_000
    );

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      persona: 'notify-reset',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner = new ConversationRunner(config, deps);
    await runner.run({
      content: [{ type: 'text', text: 'hello' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const state = readSessionState(sessionDir);
    expect(state.highestFiredBreakpointAt).toBe(0);
  });

  it('default 0.6/0.9 breakpoints fire compact when no persona is configured', async () => {
    // No persona → compactionBreakpointsForSession returns DEFAULT_BREAKPOINTS [0.6 compact, 0.9 compact].
    // The call is unconditional; select.ts handles missing personas gracefully (returns defaults).
    mockBreakpoints.mockReturnValue(DEFAULT_BREAKPOINTS);
    seedSession(sessionDir, sessionId, cwd); // no persona

    // 70% pressure → crosses default 0.6 compact threshold
    const provider = new ScriptedProvider(
      [
        {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 700_000, completionTokens: 10, totalTokens: 700_010 },
        },
      ],
      1_000_000
    );

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      // No persona field
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner = new ConversationRunner(config, deps);
    await runner.run({
      content: [{ type: 'text', text: 'hello' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const { events } = readDurableEvents(sessionDir, {});
    expect(events.some((e) => e.type === 'context_compacted')).toBe(true);
  });

  it('noop session fires compact once and stays quiet on subsequent same-pressure runs', async () => {
    // Compact at 0.5 — verifies once-per-crossing for compact action
    mockBreakpoints.mockReturnValue([{ at: 0.5, action: 'compact' }]);
    seedSession(sessionDir, sessionId, cwd, 'compact-once');

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      persona: 'compact-once',
    };

    // First run: 60% pressure → compact fires
    const provider1 = new ScriptedProvider(
      [
        {
          content: 'first',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 600_000, completionTokens: 10, totalTokens: 600_010 },
        },
      ],
      1_000_000
    );
    const deps1 = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider1),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner1 = new ConversationRunner(config, deps1);
    await runner1.run({
      content: [{ type: 'text', text: 'first run' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const events1 = readDurableEvents(sessionDir, {}).events;
    expect(events1.some((e) => e.type === 'context_compacted')).toBe(true);
    const compactedCount1 = events1.filter((e) => e.type === 'context_compacted').length;

    // highestFiredBreakpointAt should be 0.5 now
    expect(readSessionState(sessionDir).highestFiredBreakpointAt).toBe(0.5);

    // Second run: still 60% pressure → compact does NOT fire again (already crossed)
    const provider2 = new ScriptedProvider(
      [
        {
          content: 'second',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 600_000, completionTokens: 10, totalTokens: 600_010 },
        },
      ],
      1_000_000
    );
    const deps2 = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider2),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner2 = new ConversationRunner(config, deps2);
    await runner2.run({
      content: [{ type: 'text', text: 'second run' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const events2 = readDurableEvents(sessionDir, {}).events;
    const compactedCount2 = events2.filter((e) => e.type === 'context_compacted').length;
    // Should not have gained any more compaction events
    expect(compactedCount2).toBe(compactedCount1);
  });

  it('error stop reason (via thrown error) does not fire breakpoints', async () => {
    // Persona breakpoints: compact at 0.5
    mockBreakpoints.mockReturnValue([{ at: 0.5, action: 'compact' }]);
    seedSession(sessionDir, sessionId, cwd, 'compact-gate');

    // Provider throws an overloaded error → mapErrorToStopReason → 'provider_error_overloaded'
    // which is NOT in CLEAN_STOP_REASONS → breakpoints should not fire
    class ThrowingProvider extends AIProvider {
      get providerName() {
        return 'throwing-test';
      }
      getProviderInfo() {
        return { name: 'throwing-test', displayName: 'Throwing', requiresApiKey: false };
      }
      isConfigured() {
        return true;
      }
      get supportsStreaming() {
        return true;
      }
      override contextWindowForModel() {
        return 1_000_000;
      }
      async createResponse(): Promise<ProviderResponse> {
        return this.createStreamingResponse();
      }
      async createStreamingResponse(): Promise<ProviderResponse> {
        // Throw an overloaded error so mapErrorToStopReason → 'provider_error_overloaded'
        const err: Record<string, unknown> = new Error('overloaded_error: too many requests');
        (err as unknown as Error).name = 'ProviderError';
        throw err;
      }
    }

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      persona: 'compact-gate',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => new ThrowingProvider()),
      createToolExecutor: vi.fn().mockReturnValue({
        executor,
        toolsForProvider: executor.getAllTools(),
      }),
    });

    const runner = new ConversationRunner(config, deps);
    // The runner will throw because the provider threw — catch it
    try {
      await runner.run({
        content: [{ type: 'text', text: 'hello' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });
    } catch {
      // expected
    }

    const { events } = readDurableEvents(sessionDir, {});
    expect(events.some((e) => e.type === 'context_compacted')).toBe(false);
    expect(events.some((e) => e.type === 'context_injected')).toBe(false);

    // highestFiredBreakpointAt stays at 0 (not changed by error turns)
    const state = readSessionState(sessionDir);
    expect(state.highestFiredBreakpointAt ?? 0).toBe(0);
  });
});
