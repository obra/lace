// ABOUTME: Tests for ConversationRunner per-iteration re-read of context_injected events
// Verifies PRI-1691: injections with priority='immediate' arriving mid-turn appear
// in the next provider call's messages, not after the turn ends.
// Also verifies PRI-1744: context_injected events written between turns (after
// turn_end but before run()) are picked up via findLastTurnEndEventSeq watermark.

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
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
} from '@lace/agent/providers/base-provider';
import type { Tool } from '@lace/agent/tools/tool';

function createMockDeps(overrides: Partial<RunnerDependencies> = {}): RunnerDependencies {
  const mockTool = { name: 'mock', description: 'mock', schema: {} } as unknown as Tool;
  const mockToolExecutor = {
    getTool: vi.fn().mockImplementation((name: string) => {
      if (['bash', 'file_read', 'file_write'].includes(name)) return mockTool;
      return null;
    }),
    execute: vi.fn().mockResolvedValue({
      status: 'completed',
      content: [{ type: 'text', text: 'mock result' }],
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

/**
 * Provider that runs a scripted sequence of responses, capturing the messages
 * received on each call. Optionally invokes a side-effect callback before
 * returning each scripted response (used to inject events between iterations).
 */
class ScriptedProvider extends AIProvider {
  callCount = 0;
  receivedMessages: ProviderMessage[][] = [];

  constructor(
    private readonly script: Array<{
      response: ProviderResponse;
      beforeReturn?: () => void;
    }>
  ) {
    super();
  }

  get providerName(): string {
    return 'scripted-test';
  }
  getProviderInfo() {
    return { name: 'scripted-test', displayName: 'Scripted', requiresApiKey: false };
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

  async createStreamingResponse(
    messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    _signal?: AbortSignal,
    _conversationState?: ConversationState,
    _options?: RequestOptions
  ): Promise<ProviderResponse> {
    // Snapshot the messages we received (deep enough for assertions)
    this.receivedMessages.push(messages.map((m) => ({ ...m })));

    const step = this.script[this.callCount];
    this.callCount++;
    if (!step) {
      return {
        content: 'fallback',
        toolCalls: [],
        stopReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    }

    step.beforeReturn?.();
    return step.response;
  }
}

/**
 * Helper: write a context_injected event directly to the session log,
 * simulating an in-flight ent/session/inject RPC.
 */
function injectContextEvent(
  sessionDir: string,
  text: string,
  priority: 'immediate' | 'normal' | 'deferred' = 'immediate'
): void {
  const state = readSessionState(sessionDir);
  const { nextState } = appendDurableEvent(sessionDir, state, {
    type: 'context_injected',
    data: { content: [{ type: 'text', text }], priority },
  });
  writeSessionState(sessionDir, nextState);
}

describe('ConversationRunner - mid-turn context_injected re-read (PRI-1691)', () => {
  let laceDir: string;
  let sessionDir: string;
  let sessionId: string;
  let cwd: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-runner-inject-test-'));
    sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    cwd = join(tmpdir(), `lace-runner-inject-test-cwd-${randomUUID().substring(0, 8)}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    // Seed system_prompt_set at eventSeq 1 so the runner's invariant check passes.
    // All real sessions must have one; nextEventSeq: 2 so appendDurableEvent starts at 2.
    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({
        sessionId,
        workDir: cwd,
        created: new Date().toISOString(),
        persona: 'test',
      })
    );
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
    savedLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
  });

  afterEach(() => {
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    if (existsSync(laceDir)) rmSync(laceDir, { recursive: true, force: true });
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  it("appends a mid-turn priority='immediate' injection as role: 'user' on the next provider call", async () => {
    // Script: call 1 returns a tool call; just BEFORE returning, an inject lands.
    // Call 2 should see the injected message as role: 'user' in providerMessages.
    // Call 2 also returns a tool call (avoids the bare-text retry path).
    // Call 3 ends the turn.
    const provider = new ScriptedProvider([
      {
        beforeReturn: () => injectContextEvent(sessionDir, 'URGENT: stop and report'),
        response: {
          content: '',
          toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'echo hi' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
        },
      },
      {
        response: {
          content: '',
          toolCalls: [{ id: 'tc_2', name: 'bash', arguments: { command: 'echo bye' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 110, completionTokens: 5, totalTokens: 115 },
        },
      },
      {
        response: {
          content: 'OK, reporting.',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 120, completionTokens: 5, totalTokens: 125 },
        },
      },
    ]);

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
      content: [{ type: 'text', text: 'do work' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(provider.callCount).toBeGreaterThanOrEqual(2);

    const secondCallMessages = provider.receivedMessages[1]!;
    const injectedUserMsg = secondCallMessages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('URGENT')
    );
    expect(injectedUserMsg).toBeDefined();
    expect(injectedUserMsg!.role).toBe('user');
    expect(injectedUserMsg!.content).toContain('URGENT: stop and report');
  });

  it('appends multiple immediate injections in eventSeq order', async () => {
    const provider = new ScriptedProvider([
      {
        beforeReturn: () => {
          injectContextEvent(sessionDir, 'INJECT-A');
          injectContextEvent(sessionDir, 'INJECT-B');
          injectContextEvent(sessionDir, 'INJECT-C');
        },
        response: {
          content: '',
          toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'echo hi' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
        },
      },
      {
        response: {
          content: '',
          toolCalls: [{ id: 'tc_2', name: 'bash', arguments: { command: 'echo bye' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 110, completionTokens: 5, totalTokens: 115 },
        },
      },
      {
        response: {
          content: 'ack',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 120, completionTokens: 5, totalTokens: 125 },
        },
      },
    ]);

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
      content: [{ type: 'text', text: 'do work' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const secondCallMessages = provider.receivedMessages[1]!;
    // All three injections are consecutive role:'user' entries and get merged via
    // appendOrMergeUser into a single message joined by newlines.
    const allUserContent = secondCallMessages
      .filter((m) => m.role === 'user' && typeof m.content === 'string')
      .map((m) => m.content as string)
      .join('\n');

    // All three labels must appear, and in insertion (eventSeq) order.
    const posA = allUserContent.indexOf('INJECT-A');
    const posB = allUserContent.indexOf('INJECT-B');
    const posC = allUserContent.indexOf('INJECT-C');
    expect(posA).toBeGreaterThanOrEqual(0);
    expect(posB).toBeGreaterThan(posA);
    expect(posC).toBeGreaterThan(posB);
  });

  it('does NOT append non-immediate priority injections mid-turn', async () => {
    const provider = new ScriptedProvider([
      {
        beforeReturn: () => {
          injectContextEvent(sessionDir, 'DEFERRED-INJECT', 'deferred');
          injectContextEvent(sessionDir, 'NORMAL-INJECT', 'normal');
        },
        response: {
          content: '',
          toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'echo hi' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
        },
      },
      {
        response: {
          content: '',
          toolCalls: [{ id: 'tc_2', name: 'bash', arguments: { command: 'echo bye' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 110, completionTokens: 5, totalTokens: 115 },
        },
      },
      {
        response: {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 120, completionTokens: 5, totalTokens: 125 },
        },
      },
    ]);

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
      content: [{ type: 'text', text: 'work' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const secondCallMessages = provider.receivedMessages[1]!;
    const sawDeferred = secondCallMessages.some(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('DEFERRED-INJECT')
    );
    const sawNormal = secondCallMessages.some(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('NORMAL-INJECT')
    );
    expect(sawDeferred).toBe(false);
    expect(sawNormal).toBe(false);
  });

  it('does not duplicate injections appended in a previous iteration', async () => {
    // Two tool-call iterations + final text. We inject before the first call
    // (which seeds via buildProviderMessagesFromDurableEvents already including
    // it as a system message) -- ensure we don't see it ALSO as a user message,
    // and that an inject between iter 1 and iter 2 only appears once.
    const provider = new ScriptedProvider([
      {
        beforeReturn: () => injectContextEvent(sessionDir, 'INJECT-MID-1'),
        response: {
          content: '',
          toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'echo a' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
        },
      },
      {
        response: {
          content: '',
          toolCalls: [{ id: 'tc_2', name: 'bash', arguments: { command: 'echo b' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 110, completionTokens: 10, totalTokens: 120 },
        },
      },
      {
        response: {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 120, completionTokens: 5, totalTokens: 125 },
        },
      },
    ]);

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
      content: [{ type: 'text', text: 'work' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const thirdCallMessages = provider.receivedMessages[2]!;
    const occurrences = thirdCallMessages.filter(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('INJECT-MID-1')
    );
    expect(occurrences).toHaveLength(1);
  });

  it('persists the context_injected event to disk so the next turn picks it up', async () => {
    // Inject during the only iteration. The event must remain in events.jsonl
    // so the next turn's buildProviderMessagesFromDurableEvents sees it.
    const provider = new ScriptedProvider([
      {
        beforeReturn: () => injectContextEvent(sessionDir, 'LATE-INJECT'),
        response: {
          content: 'done',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
        },
      },
    ]);

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
      content: [{ type: 'text', text: 'work' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const { events } = readDurableEvents(sessionDir, {});
    const lateInject = events.find(
      (e) =>
        e.type === 'context_injected' && (e.data as { priority?: string }).priority === 'immediate'
    );
    expect(lateInject).toBeDefined();
  });
});

describe('ConversationRunner - between-turn context_injected watermark (PRI-1744)', () => {
  let laceDir: string;
  let sessionDir: string;
  let sessionId: string;
  let cwd: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-runner-between-turn-test-'));
    sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    cwd = join(tmpdir(), `lace-runner-between-turn-test-cwd-${randomUUID().substring(0, 8)}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    // Seed system_prompt_set at eventSeq 1 so the runner's invariant check passes.
    // All real sessions must have one; nextEventSeq: 2 so appendDurableEvent starts at 2.
    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({
        sessionId,
        workDir: cwd,
        created: new Date().toISOString(),
        persona: 'test',
      })
    );
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
    savedLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
  });

  afterEach(() => {
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    if (existsSync(laceDir)) rmSync(laceDir, { recursive: true, force: true });
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  /**
   * Helper: append a durable event to the session log directly (simulates
   * events written by the RPC layer or a peer process before run() starts).
   */
  function appendEvent(
    type: string,
    data: Record<string, unknown>,
    extraFields?: { turnId?: string; turnSeq?: number }
  ): void {
    const state = readSessionState(sessionDir);
    const { nextState } = appendDurableEvent(sessionDir, state, {
      type,
      data,
      ...extraFields,
    });
    writeSessionState(sessionDir, nextState);
  }

  it('picks up a context_injected event written between turns as role:user on the first provider call', async () => {
    // Build a completed prior turn: prompt → turn_start → message → turn_end
    const priorTurnId = `turn_${randomUUID()}`;
    appendEvent('prompt', { content: [{ type: 'text', text: 'first prompt' }] });
    appendEvent('turn_start', {}, { turnId: priorTurnId, turnSeq: 0 });
    appendEvent(
      'message',
      { content: [{ type: 'text', text: 'first response' }] },
      { turnId: priorTurnId, turnSeq: 1 }
    );
    appendEvent(
      'turn_end',
      { stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0 } },
      { turnId: priorTurnId, turnSeq: 2 }
    );

    // Between-turn injection written AFTER turn_end but BEFORE run()
    appendEvent('context_injected', {
      content: [{ type: 'text', text: 'BETWEEN-TURN-INJECT' }],
      priority: 'immediate',
    });

    // New prompt for the second turn (written by RPC layer before calling run())
    appendEvent('prompt', { content: [{ type: 'text', text: 'second prompt' }] });

    // Provider responds with a simple end_turn (no tool calls) on first call
    const provider = new ScriptedProvider([
      {
        response: {
          content: 'understood',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 },
        },
      },
    ]);

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
      content: [{ type: 'text', text: 'second prompt' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    // The first (and only) provider call should include the between-turn injection
    // as a role:'user' message (added by readImmediateInjectsSince at watermark=turn_end seq).
    expect(provider.callCount).toBe(1);
    const firstCallMessages = provider.receivedMessages[0]!;
    const injectedUserMsg = firstCallMessages.find(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('BETWEEN-TURN-INJECT')
    );
    expect(injectedUserMsg).toBeDefined();
    expect(injectedUserMsg!.role).toBe('user');
  });
});
