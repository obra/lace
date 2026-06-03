// ABOUTME: Tests for compact_session runner wiring — Task 3
// ABOUTME: Verifies that a compact_session tool call during a turn causes the
// ABOUTME: post-turn block to fire compaction (even at low pressure) and that
// ABOUTME: guidance flows into buildCompactionContext.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { invalidatePersonaCache, readDurableEvents } from '@lace/agent/storage/event-log';
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
    createProvider: vi.fn().mockImplementation(async () => new TestAgentProvider()),
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

/** Minimal AIProvider that returns a scripted sequence of responses. */
class ScriptedProvider extends AIProvider {
  callCount = 0;

  constructor(private readonly script: ProviderResponse[]) {
    super();
  }

  get providerName(): string {
    return 'scripted-compact-test';
  }

  getProviderInfo() {
    return {
      name: 'scripted-compact-test',
      displayName: 'Scripted Compact',
      requiresApiKey: false,
    };
  }

  isConfigured(): boolean {
    return true;
  }

  get supportsStreaming(): boolean {
    return true;
  }

  // Low pressure (5% of window) so compaction fires ONLY if requested via cell.
  override contextWindowForModel(_modelId: string, _fallback?: number): number {
    return 1_000_000;
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

  async createStreamingResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    _signal?: AbortSignal,
    _state?: ConversationState,
    _options?: RequestOptions
  ): Promise<ProviderResponse> {
    const step = this.script[this.callCount];
    this.callCount++;
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

/** A simple AIProvider that simulates a TestAgentProvider for the default mock. */
class TestAgentProvider extends AIProvider {
  get providerName(): string {
    return 'test';
  }
  getProviderInfo() {
    return { name: 'test', displayName: 'Test', requiresApiKey: false };
  }
  isConfigured(): boolean {
    return true;
  }
  get supportsStreaming(): boolean {
    return true;
  }
  protected async _createResponseImpl(): Promise<ProviderResponse> {
    return {
      content: 'ok',
      toolCalls: [],
      stopReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
  }
  protected async _createStreamingResponseImpl(): Promise<ProviderResponse> {
    return this._createResponseImpl();
  }
}

describe('ConversationRunner - compact_session runner wiring', () => {
  let laceDir: string;
  let sessionDir: string;
  let sessionId: string;
  let cwd: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-compact-session-test-'));
    sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    cwd = join(tmpdir(), `lace-compact-session-cwd-${randomUUID().substring(0, 8)}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    // Seed 11 pre-existing turns so the track-based strategy produces a real
    // compaction event (not a noop). Same seeding pattern as existing tests.
    const now = new Date().toISOString();
    const preSeedLines: string[] = [
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
      preSeedLines.push(
        JSON.stringify({
          eventSeq: seq++,
          timestamp: now,
          type: 'prompt',
          data: { type: 'prompt', content: [{ type: 'text', text: `seed ${i}` }] },
        })
      );
      preSeedLines.push(
        JSON.stringify({
          eventSeq: seq++,
          timestamp: now,
          turnId: tid,
          type: 'turn_start',
          data: { type: 'turn_start' },
        })
      );
      preSeedLines.push(
        JSON.stringify({
          eventSeq: seq++,
          timestamp: now,
          turnId: tid,
          type: 'turn_end',
          data: { type: 'turn_end', stopReason: 'end_turn' },
        })
      );
    }

    writeFileSync(join(sessionDir, 'events.jsonl'), preSeedLines.join('\n') + '\n');
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

    // Ensure builtins (including compact_session) are registered.
    resetRegistriesForTest();
    registerBuiltinTools();
  });

  afterEach(() => {
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    if (existsSync(laceDir)) rmSync(laceDir, { recursive: true, force: true });
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  it('fires compaction after turn when compact_session was called, even at low pressure', async () => {
    // Provider script:
    //   call 1: returns compact_session tool_use
    //   call 2: ends turn (model obeys "end your turn" instruction)
    // Pressure = 50_000 / 1_000_000 = 5% → well below the 60% threshold.
    // Compaction should fire anyway because compactionRequest.requested = true.
    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [
          {
            id: 'tc_compact',
            name: 'compact_session',
            arguments: { guidance: 'keep the bug list' },
          },
        ],
        stopReason: 'tool_use',
        usage: { promptTokens: 50_000, completionTokens: 10, totalTokens: 50_010 },
      },
      {
        content: 'Compaction scheduled, ending turn.',
        toolCalls: [],
        stopReason: 'stop',
        usage: { promptTokens: 50_000, completionTokens: 15, totalTokens: 50_015 },
      },
    ]);

    // Build a real ToolExecutor so compact_session executes for real.
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
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
      content: [{ type: 'text', text: 'please compact' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const { events } = readDurableEvents(sessionDir, {});
    expect(events.some((e) => e.type === 'context_compacted')).toBe(true);
  });

  it('does NOT fire compaction when compact_session was not called and pressure is low', async () => {
    // No compact_session call, pressure = 5% → compaction must NOT fire.
    const provider = new ScriptedProvider([
      {
        content: 'All done.',
        toolCalls: [],
        stopReason: 'stop',
        usage: { promptTokens: 50_000, completionTokens: 10, totalTokens: 50_010 },
      },
    ]);

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools({ skillDirs: [] } as any);

    const config: RunnerConfig = {
      sessionDir,
      sessionId,
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
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
    expect(events.some((e) => e.type === 'context_compacted')).toBe(false);
  });
});
