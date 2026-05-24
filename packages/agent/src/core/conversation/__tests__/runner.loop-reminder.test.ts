// ABOUTME: Behavioral regression test for PRI-1804 #4 — the loop-check
// reminder must appear in providerMessages at the right interval and must
// NOT be persisted as a durable context_injected event.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
} from '@lace/agent/providers/base-provider';
import type { Tool } from '@lace/agent/tools/tool';

// LOOP_CHECK_INTERVAL is a private static with value 50 (confirmed from runner.ts).
// To observe the reminder injection, we need completedTurns to reach exactly 50.
// Each turn with tool calls increments completedTurns by 1.
// completedTurns=0..49 → tool calls (50 turns)
// completedTurns=50 → reminder is injected BEFORE provider call, provider captures messages
const LOOP_CHECK_INTERVAL = 50;

/**
 * Provider that:
 * - Returns a tool call for the first LOOP_CHECK_INTERVAL calls (turns 0..49)
 * - On call LOOP_CHECK_INTERVAL+1 (turn 50, after reminder injection), captures
 *   providerMessages and returns bare text to end the run.
 *
 * The mock tool executor must be set to return success+shouldContinue=true so
 * the loop keeps going after each tool call.
 */
class ReminderCaptureProvider extends AIProvider {
  callCount = 0;
  capturedMessages: ProviderMessage[] | null = null;
  readonly toolCallsBefore: number;

  constructor(toolCallsBefore: number) {
    super();
    this.toolCallsBefore = toolCallsBefore;
  }

  get providerName(): string {
    return 'reminder-capture';
  }

  getProviderInfo() {
    return { name: 'reminder-capture', displayName: 'Reminder Capture', requiresApiKey: false };
  }

  isConfigured(): boolean {
    return true;
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    conversationState?: ConversationState,
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    return this.createStreamingResponse(messages, tools, model, signal, conversationState, options);
  }

  async createStreamingResponse(messages: ProviderMessage[]): Promise<ProviderResponse> {
    this.callCount++;

    if (this.callCount <= this.toolCallsBefore) {
      // Return a tool call so the loop keeps going
      return {
        content: '',
        toolCalls: [
          { id: `tc_${this.callCount}`, name: 'bash', arguments: { command: 'echo hi' } },
        ],
        stopReason: 'tool_use',
      };
    }

    // First call after the tool-call phase: capture messages and end.
    // At this point completedTurns === LOOP_CHECK_INTERVAL and the reminder
    // was injected into providerMessages before this call.
    if (this.capturedMessages === null) {
      this.capturedMessages = messages;
    }
    return { content: 'Done.', toolCalls: [], stopReason: 'end_turn' };
  }
}

function createMockDeps(overrides: Partial<RunnerDependencies> = {}): RunnerDependencies {
  const mockTool = { name: 'bash', description: 'mock bash', schema: {} } as unknown as Tool;
  const mockToolExecutor = {
    getTool: vi.fn().mockImplementation((name: string) => {
      if (name === 'bash') return mockTool;
      return null;
    }),
    execute: vi.fn().mockResolvedValue({
      status: 'completed',
      content: [{ type: 'text', text: 'ok' }],
    }),
  };

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
      executor: mockToolExecutor,
      toolsForProvider: [],
    }),
    createProvider: vi.fn(),
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

describe('PRI-1804 #4 regression — loop reminder must not double-inject', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-loop-reminder-test-${testId}`);
    cwd = join(tmpdir(), `lace-loop-reminder-cwd-${testId}`);
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

  it('injects <system-reminder> into providerMessages exactly once at LOOP_CHECK_INTERVAL turns', async () => {
    // The provider calls a tool for the first LOOP_CHECK_INTERVAL turns (0..49).
    // On the LOOP_CHECK_INTERVAL+1'th call (completedTurns=50), the reminder
    // was already injected and the provider captures the messages.
    const provider = new ReminderCaptureProvider(LOOP_CHECK_INTERVAL);

    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
    });
    const runner = new ConversationRunner(config, deps);

    await runner.run({
      content: [{ type: 'text', text: 'Start' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns: LOOP_CHECK_INTERVAL + 5,
    });

    // Provider was called LOOP_CHECK_INTERVAL times (tool calls) + 1 (bare text) = 51 times.
    // After the bare text on turn 50, retriedWithToolChoice triggers one more call.
    expect(provider.callCount).toBeGreaterThanOrEqual(LOOP_CHECK_INTERVAL + 1);

    // The captured messages (from call 51) must contain the <system-reminder>.
    expect(provider.capturedMessages).not.toBeNull();
    const allContent = provider
      .capturedMessages!.map((m) =>
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      )
      .join('\n');

    expect(allContent).toContain('system-reminder');
    expect(allContent).toContain('stuck in a loop');

    // The reminder must appear exactly ONCE in the captured messages.
    const reminderCount = (allContent.match(/stuck in a loop/g) || []).length;
    expect(reminderCount).toBe(1);
  });

  it('does NOT persist the loop reminder as a durable context_injected event', async () => {
    const provider = new ReminderCaptureProvider(LOOP_CHECK_INTERVAL);

    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps({
      createProvider: vi.fn().mockImplementation(async () => provider),
    });
    const runner = new ConversationRunner(config, deps);

    await runner.run({
      content: [{ type: 'text', text: 'Start' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns: LOOP_CHECK_INTERVAL + 5,
    });

    // Read durable events and assert no context_injected event contains the reminder text.
    const eventsRaw = readFileSync(join(sessionDir, 'events.jsonl'), 'utf8');
    const events = eventsRaw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as { type: string; data: unknown });

    const injectedEvents = events.filter((e) => e.type === 'context_injected');
    const reminderPersisted = injectedEvents.some((e) =>
      JSON.stringify(e.data).includes('stuck in a loop')
    );

    // Persisting the reminder would cause it to be re-read and doubled on the
    // next iteration. It must only be pushed in-memory.
    expect(reminderPersisted).toBe(false);
  });
});
