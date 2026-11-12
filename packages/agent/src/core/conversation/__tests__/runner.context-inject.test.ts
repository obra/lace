// ABOUTME: Tests for ConversationRunner per-iteration re-read of context_injected events
// Verifies: injections with priority='immediate' arriving mid-turn appear
// in the next provider call's messages, not after the turn ends.
// Also verifies: context_injected events written between turns (after
// turn_end but before run()) are picked up via findLastTurnEndEventSeq watermark.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MCPToolAdapter } from '@lace/agent/mcp/tool-adapter';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import { ConversationRunner, bareTextStopReminder } from '../runner';
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
  receivedOptions: (RequestOptions | undefined)[] = [];

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
    this.receivedOptions.push(_options ? { ..._options } : undefined);
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

describe('ConversationRunner - mid-turn context_injected re-read', () => {
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

  it('coalesces clean mid-turn queries while keeping raw injected source text', async () => {
    injectContextEvent(sessionDir, 'initial topic');
    const captured: Array<
      Parameters<NonNullable<RunnerDependencies['prepareAutomaticRecall']>>[0]
    > = [];
    const provider = new ScriptedProvider([
      {
        beforeReturn: () => {
          for (const [raw, query] of [
            ['envelope one', 'TASK-271 <literal>'],
            ['envelope two', 'slack:T:C'],
          ]) {
            const state = readSessionState(sessionDir);
            const { nextState } = appendDurableEvent(sessionDir, state, {
              type: 'context_injected',
              data: {
                priority: 'immediate',
                content: [{ type: 'text', text: raw }],
                recall: { query, context: raw === 'envelope one' ? 'amber antecedent' : undefined },
              },
            });
            writeSessionState(sessionDir, nextState);
          }
        },
        response: {
          content: 'I will inspect amber.',
          toolCalls: [{ id: 'recall_inject_tool', name: 'bash', arguments: { command: 'check' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
      {
        response: {
          content: 'done',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
    ]);
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      createMockDeps({
        createProvider: async () => provider,
        prepareAutomaticRecall: async (input) => {
          captured.push(input);
          return { block: null };
        },
      })
    );
    await runner.run({
      content: [],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });
    expect(captured[1].query).toBe('TASK-271 <literal>\nslack:T:C');
    expect(captured[1].tail).toBe(
      'initial topic\namber antecedent\nTASK-271 <literal>\nslack:T:C\nI will inspect amber.'
    );
    expect(captured[2].tail).toBe(
      'amber antecedent\nTASK-271 <literal>\nslack:T:C\nI will inspect amber.\ndone'
    );
    expect(captured[2].tail).not.toContain('envelope');
    expect(captured[2].tail).not.toContain('system-reminder');

    expect(captured[1].cueIds).toHaveLength(2);
    expect(captured[1].represented).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'event', text: 'envelope one' }),
        expect.objectContaining({ kind: 'event', text: 'envelope two' }),
      ])
    );
    expect(provider.receivedMessages[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining('envelope one') }),
      ])
    );
  });

  it('keeps the query and conversational tail bounds separate from raw provider history', async () => {
    const append = (type: string, data: Record<string, unknown>) => {
      const state = readSessionState(sessionDir);
      const { nextState } = appendDurableEvent(sessionDir, state, { type, data });
      writeSessionState(sessionDir, nextState);
    };
    for (const body of ['outside-last-four', 'first', 'second', 'third']) {
      append('prompt', { content: [{ type: 'text', text: body }] });
      append('turn_end', {});
    }
    const query = 'TASK-271 <literal> '.repeat(200);
    append('prompt', {
      content: [{ type: 'text', text: 'raw transport wrapper' }],
      recall: { query, context: 'amber antecedent' },
    });
    append('context_injected', {
      content: [{ type: 'text', text: 'maintenance wake' }],
      inputKind: 'continuation',
    });
    const captured: Array<
      Parameters<NonNullable<RunnerDependencies['prepareAutomaticRecall']>>[0]
    > = [];
    const provider = new ScriptedProvider([]);
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      createMockDeps({
        createProvider: async () => provider,
        prepareAutomaticRecall: async (input) => {
          captured.push(input);
          return { block: null };
        },
      })
    );
    await runner.run({
      content: [],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });
    expect(captured[0].query).toBe(query.slice(0, 2400));
    expect(captured[0].tail).toBe(query.slice(-800));
    expect(captured[0].tail).toHaveLength(800);
    expect(provider.receivedMessages[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('maintenance wake'),
        }),
      ])
    );
  });

  it('coalesces overlong ordinary inputs identically for live lookup and cold replay', async () => {
    injectContextEvent(sessionDir, 'initial topic');
    // The RPC writes turn_start before the runner begins; it separates the prior cue from arrivals.
    const state = readSessionState(sessionDir);
    const { nextState } = appendDurableEvent(sessionDir, state, { type: 'turn_start', data: {} });
    writeSessionState(sessionDir, nextState);
    const queries = ['first-prefix '.repeat(250) + 'first-ending', 'newest-body '.repeat(130)];
    const provider = new ScriptedProvider([
      {
        beforeReturn: () => {
          for (const query of queries) {
            const state = readSessionState(sessionDir);
            const { nextState } = appendDurableEvent(sessionDir, state, {
              type: 'context_injected',
              data: {
                priority: 'immediate',
                content: [{ type: 'text', text: 'raw envelope' }],
                recall: { query },
              },
            });
            writeSessionState(sessionDir, nextState);
          }
        },
        response: {
          content: '',
          toolCalls: [{ id: 'long_query_tool', name: 'bash', arguments: { command: 'check' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
      {
        response: {
          content: 'done',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
    ]);
    const captured: string[] = [];
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      createMockDeps({
        createProvider: async () => provider,
        prepareAutomaticRecall: async (input) => {
          captured.push(input.query);
          return { block: null };
        },
      })
    );
    await runner.run({
      content: [],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });
    const expected = [queries[0].slice(0, 2400), queries[1]].join('\n').slice(-2400);
    expect(captured[1]).toBe(expected);
    expect(captured[1]).toBe(buildProviderMessagesFromDurableEvents(sessionDir).latestCue?.text);
    expect(captured[1]).toHaveLength(2400);
    expect(captured[1].endsWith(queries[1])).toBe(true);
  });

  it('waits for automatic preparation before calling the provider and composes caller context', async () => {
    injectContextEvent(sessionDir, 'Where is TASK-271?');
    let release!: (value: { block: string | null }) => void;
    const prepared = new Promise<{ block: string | null }>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const provider = new ScriptedProvider([
      {
        response: {
          content: 'done',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
    ]);
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      createMockDeps({
        createProvider: async () => provider,
        getTemporaryContext: () => 'caller sticky',
        prepareAutomaticRecall: async () => {
          entered();
          return prepared;
        },
      })
    );
    const running = runner.run({
      content: [],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });
    await Promise.race([waiting, running]);
    expect(provider.callCount).toBe(0);
    release({ block: 'automatic data' });
    await running;
    expect(provider.receivedOptions[0]?.temporaryContext).toBe('caller sticky\n\nautomatic data');
    expect(JSON.stringify(readDurableEvents(sessionDir, {}).events)).not.toContain(
      'automatic data'
    );
  });

  it.each([
    {
      action: 'set',
      initial: null,
      next: 'caller updated',
      expected: 'caller updated\n\nautomatic data',
      fits: true,
    },
    {
      action: 'clear',
      initial: 'caller before',
      next: null,
      expected: 'automatic data',
      fits: true,
    },
    {
      action: 'replace with larger text',
      initial: 'caller before',
      next: 'expanded caller context '.repeat(250),
      expected: 'expanded caller context '.repeat(250) + '\n\nautomatic data',
      fits: true,
    },
    {
      action: 'expand past the context window',
      initial: null,
      next: 'expanded caller context '.repeat(500),
      expected: undefined,
      fits: false,
    },
  ])(
    'uses caller context $action while automatic preparation is pending',
    async ({ initial, next, expected, fits }) => {
      injectContextEvent(sessionDir, 'Where is TASK-271?');
      let caller: string | null = initial;
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const provider = new ScriptedProvider([
        {
          response: {
            content: 'done',
            toolCalls: [],
            stopReason: 'end_turn',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
        },
      ]);
      provider.contextWindowForModel = () => 8192;
      provider.config.maxTokens = 1024;
      const runner = new ConversationRunner(
        { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
        createMockDeps({
          createProvider: async () => provider,
          getTemporaryContext: () => caller,
          prepareAutomaticRecall: async () => {
            entered();
            await blocked;
            return { block: 'automatic data' };
          },
        })
      );
      const running = runner.run({
        content: [],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });
      await Promise.race([waiting, running]);
      expect(provider.callCount).toBe(0);
      caller = next;
      release();
      const result = await running;
      expect(result.stopReason).toBe(fits ? 'end_turn' : 'context_window_exceeded');
      expect(provider.callCount).toBe(fits ? 1 : 0);
      expect(provider.receivedOptions[0]?.temporaryContext).toBe(expected);
    }
  );

  it('surfaces provider overflow when there is no history to compact', async () => {
    injectContextEvent(sessionDir, 'Where is TASK-271?');
    const provider = new ScriptedProvider([
      {
        response: {
          content: '',
          toolCalls: [],
          stopReason: 'context_window_exceeded',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      },
    ]);
    const outputFormat = { type: 'json_schema', schema: { type: 'object' } };
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      createMockDeps({
        createProvider: async () => provider,
        getTemporaryContext: () => 'caller sticky',
        prepareAutomaticRecall: async () => ({ block: 'automatic data' }),
      })
    );
    const result = await runner.run({
      content: [],
      outputFormat,
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });
    expect(result.stopReason).toBe('context_window_exceeded');
    expect(provider.callCount).toBe(1);
    expect(provider.receivedOptions[0]).toMatchObject({
      temporaryContext: 'caller sticky\n\nautomatic data',
      outputFormat,
    });
    expect(
      readDurableEvents(sessionDir, {}).events.some((event) => event.type === 'context_compacted')
    ).toBe(false);
  });

  it('records cancellation while automatic recall is preparing', async () => {
    injectContextEvent(sessionDir, 'Where is TASK-271?');
    const provider = new ScriptedProvider([]);
    const abortController = new AbortController();
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      createMockDeps({
        createProvider: async () => provider,
        prepareAutomaticRecall: async ({ signal }) => {
          abortController.abort();
          signal.throwIfAborted();
          return { block: null };
        },
      })
    );
    const result = await runner.run({
      content: [],
      abortController,
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(result.stopReason).toBe('cancelled');
    expect(provider.callCount).toBe(0);
    const turnEnd = readDurableEvents(sessionDir, {}).events.find(
      (event) => event.type === 'turn_end'
    );
    expect(turnEnd?.data.stopReason).toBe('cancelled');
  });

  it.each([
    { output: 1024, configured: true, recallEnabled: true, fits: true },
    { output: 6000, configured: true, recallEnabled: true, fits: false },
    { output: 6000, configured: false, recallEnabled: true, fits: false },
    { output: 6000, configured: false, recallEnabled: false, fits: true },
  ])(
    'accounts for configured or catalog response output ($output/$configured/$recallEnabled)',
    async ({ output, configured, recallEnabled, fits }) => {
      injectContextEvent(sessionDir, 'Where is TASK-271?');
      const provider = new ScriptedProvider([
        {
          response: {
            content: 'done',
            toolCalls: [],
            stopReason: 'end_turn',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
        },
      ]);
      provider.contextWindowForModel = () => 8192;
      provider.getAvailableModels = () => [
        {
          id: 'budget-model',
          displayName: 'Budget',
          contextWindow: 8192,
          maxOutputTokens: configured ? 8192 : output,
        },
      ];
      if (configured) provider.config.maxTokens = output;
      let allowance = -1;
      const runner = new ConversationRunner(
        {
          sessionDir,
          sessionId,
          cwd,
          modelId: 'budget-model',
          executionMode: 'execute',
          approvalMode: 'approve',
        },
        createMockDeps({
          createProvider: async () => provider,
          prepareAutomaticRecall: recallEnabled
            ? async (input) => {
                allowance = input.maxTokens;
                return { block: 'automatic data' };
              }
            : undefined,
        })
      );
      const result = await runner.run({
        content: [],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });
      expect(result.stopReason).toBe(fits ? 'end_turn' : 'context_window_exceeded');
      expect(provider.callCount).toBe(fits ? 1 : 0);
      expect(allowance).toBe(fits && recallEnabled ? 2000 : -1);
      if (!fits) {
        expect(result.stopDetails).toMatchObject({
          type: 'context_window_exceeded',
          source: 'preflight_token_estimate',
          estimatedExcessTokens: expect.any(Number),
        });
      }
    }
  );

  it('budgets MCP tool schemas without serializing their live clients', async () => {
    const client = new Client({ name: 'recall-budget-test', version: '1.0.0' });
    for (const [description, fits] of [
      ['query', true],
      ['query'.repeat(2500), false],
    ] as const) {
      injectContextEvent(sessionDir, 'Where is TASK-271?');
      const tool = new MCPToolAdapter(
        {
          name: 'search',
          description: 'Search retained evidence',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', description } },
            required: ['query'],
          },
        },
        'knowledge',
        client
      );
      const provider = new ScriptedProvider([
        {
          response: {
            content: 'done',
            toolCalls: [],
            stopReason: 'end_turn',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
        },
      ]);
      provider.contextWindowForModel = () => 8192;
      provider.config.maxTokens = 1024;
      const deps = createMockDeps({
        createProvider: async () => provider,
        prepareAutomaticRecall: async () => ({ block: 'automatic data' }),
      });
      const createToolExecutor = deps.createToolExecutor;
      deps.createToolExecutor = async (...args) => ({
        ...(await createToolExecutor(...args)),
        toolsForProvider: [tool],
      });
      const runner = new ConversationRunner(
        { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
        deps
      );
      const result = await runner.run({
        content: [],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });
      expect(result.stopReason).toBe(fits ? 'end_turn' : 'context_window_exceeded');
      expect(provider.callCount).toBe(fits ? 1 : 0);
    }
  });

  it('dispatches before awaiting its recall diagnostic observer', async () => {
    injectContextEvent(sessionDir, 'bicycle topic');
    let release!: () => void;
    let enter!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const provider = new ScriptedProvider([
      {
        response: {
          content: 'done',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
    ]);
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      createMockDeps({
        createProvider: async () => provider,
        prepareAutomaticRecall: async () => ({
          block: 'valid historical data',
          diagnostics: { mode: 'hybrid' },
        }),
        onUpdate: async (_seq, update) => {
          if (update.type === 'session_info') {
            enter();
            await blocked;
          }
        },
      })
    );
    const running = runner.run({
      content: [],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });
    await entered;
    const dispatchedWhileObserverHeld = provider.callCount;
    release();
    await running;
    expect(dispatchedWhileObserverHeld).toBe(1);
  });

  it('prepares an empty new cue for an ordinary image request without the preceding topic evidence', async () => {
    const append = (data: Record<string, unknown>) => {
      const state = readSessionState(sessionDir);
      const { nextState } = appendDurableEvent(sessionDir, state, { type: 'prompt', data });
      writeSessionState(sessionDir, nextState);
    };
    append({ content: [{ type: 'text', text: 'bicycle topic' }] });
    const done: ProviderResponse = {
      content: 'done',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
    const provider = new ScriptedProvider([{ response: done }, { response: done }]);
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      createMockDeps({
        createProvider: async () => provider,
        prepareAutomaticRecall: async (input) => ({
          block: input.query ? 'prior bicycle evidence' : null,
        }),
      })
    );
    const run = () =>
      runner.run({
        content: [],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });
    await run();
    const image = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
    };
    append({ content: [image], inputKind: 'message' });
    await run();
    expect(provider.receivedOptions[0]?.temporaryContext).toBe('prior bicycle evidence');
    expect(provider.receivedOptions[1]?.temporaryContext ?? '').not.toContain('prior bicycle');
    expect(provider.receivedMessages[1].at(-1)?.content).toEqual([image]);
  });

  it('extends represented originals after a current-run tool result before the next injected message', async () => {
    injectContextEvent(sessionDir, 'initial topic');
    const tool: ProviderResponse = {
      content: '',
      toolCalls: [{ id: 'complete_tool', name: 'bash', arguments: { command: 'report' } }],
      stopReason: 'tool_use',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
    const done: ProviderResponse = {
      content: 'done',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
    const provider = new ScriptedProvider([{ response: tool }, { response: done }]);
    const captured: Array<
      Parameters<NonNullable<RunnerDependencies['prepareAutomaticRecall']>>[0]
    > = [];
    const deps = createMockDeps({
      createProvider: async () => provider,
      prepareAutomaticRecall: async (input) => {
        captured.push(input);
        return { block: null };
      },
    });
    const factory = deps.createToolExecutor;
    deps.createToolExecutor = async (...args) => {
      const built = await factory(...args);
      built.executor.execute = vi.fn(async () => {
        injectContextEvent(sessionDir, 'new bicycle message');
        return { status: 'completed', content: [{ type: 'text', text: 'bicycle violet' }] };
      });
      return built;
    };
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      deps
    );
    await runner.run({
      content: [],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });
    const written = readDurableEvents(sessionDir, {}).events.find(
      (event) => event.type === 'tool_use' && event.data.toolCallId === 'complete_tool'
    )!;
    expect(
      captured[1].represented.some(
        (original) =>
          original.kind === 'event' &&
          original.eventSeq === written.eventSeq &&
          original.text.includes('tool=bash') &&
          original.text.includes('bicycle violet')
      )
    ).toBe(true);
    expect(provider.receivedMessages[1].some((message) => message.toolResults?.length === 1)).toBe(
      true
    );
  });

  it('delivers recall diagnostics after dispatch even when the provider rejects', async () => {
    injectContextEvent(sessionDir, 'bicycle topic');
    const provider = new ScriptedProvider([]);
    let dispatched = false;
    provider.createStreamingResponse = async () => {
      dispatched = true;
      throw new Error('provider rejected');
    };
    const updates: string[] = [];
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      createMockDeps({
        createProvider: async () => provider,
        prepareAutomaticRecall: async () => ({
          block: 'historical data',
          diagnostics: { mode: 'hybrid' },
        }),
        onUpdate: async (_seq, update) => {
          if (update.type === 'session_info') expect(dispatched).toBe(true);
          updates.push(update.type);
        },
      })
    );
    await expect(
      runner.run({
        content: [],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      })
    ).rejects.toBeDefined();
    expect(updates).toContain('session_info');
  });

  it('snapshots sticky temporary context each round and turn without persisting it', async () => {
    let text: string | null = 'TEMPORARY-ONE';
    const toolResponse: ProviderResponse = {
      content: '',
      toolCalls: [{ id: 'tc_temporary', name: 'bash', arguments: { command: 'echo hi' } }],
      stopReason: 'tool_use',
      usage: { promptTokens: 100, completionTokens: 1, totalTokens: 101 },
    };
    const done: ProviderResponse = {
      content: 'done',
      toolCalls: [],
      stopReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 1, totalTokens: 101 },
    };
    const provider = new ScriptedProvider([
      {
        response: toolResponse,
        beforeReturn: () => {
          text = 'TEMPORARY-TWO';
        },
      },
      {
        response: {
          ...toolResponse,
          toolCalls: [{ ...toolResponse.toolCalls![0], id: 'tc_temporary_2' }],
        },
        beforeReturn: () => {
          text = null;
        },
      },
      { response: done },
      { response: done },
      { response: done },
    ]);
    const runner = new ConversationRunner(
      { sessionDir, sessionId, cwd, executionMode: 'execute', approvalMode: 'approve' },
      createMockDeps({
        createProvider: vi.fn().mockResolvedValue(provider),
        getTemporaryContext: () => text,
      })
    );
    const run = () =>
      runner.run({
        content: [{ type: 'text', text: 'do work' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });
    await run();
    expect(provider.receivedOptions.map((o) => o?.temporaryContext)).toEqual([
      'TEMPORARY-ONE',
      'TEMPORARY-TWO',
      null,
      null,
    ]);
    expect(provider.receivedMessages[1].at(-1)?.toolResults).toHaveLength(1);
    expect(JSON.stringify(provider.receivedMessages)).not.toContain('TEMPORARY-');
    text = 'TEMPORARY-STICKY';
    await run();
    await run();
    expect(provider.receivedOptions.slice(-2).map((o) => o?.temporaryContext)).toEqual([
      'TEMPORARY-STICKY',
      'TEMPORARY-STICKY',
    ]);
    expect(JSON.stringify(readDurableEvents(sessionDir, {}).events)).not.toContain('TEMPORARY-');
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

  it('bareTextStopReminder returns the verify reminder when no injection was seen', () => {
    const reminder = bareTextStopReminder('none');
    expect(reminder).toContain('verify your work before stopping');
    expect(reminder).not.toContain('arrived mid-turn');
  });

  it('bareTextStopReminder returns a handle-the-new-message directive for a real message', () => {
    const reminder = bareTextStopReminder('message');
    expect(reminder).toContain('new message arrived mid-turn');
    expect(reminder).not.toContain('verify your work before stopping');
  });

  it('bareTextStopReminder calls a notification a notification, not a new message', () => {
    // A job-completion or fired reminder is NOT an inbound message. Announcing
    // it as one sends the agent looking for a message that does not exist —
    // it reads as a phantom, and the defensive fix is to re-fetch the thread
    // before every reply, which is a per-turn tax.
    const reminder = bareTextStopReminder('notification');
    expect(reminder).toContain('notification');
    expect(reminder).not.toContain('new message arrived');
    expect(reminder).not.toContain('verify your work before stopping');
  });

  it('bareTextStopReminder names both when a message and a notification both landed', () => {
    const reminder = bareTextStopReminder('both');
    expect(reminder).toContain('new message');
    expect(reminder).toContain('notification');
  });

  it('flips the bare-text stop reminder to a directive when a mid-turn injection was seen', async () => {
    // call 0: tool_use (completedTurns increments past 0); an inbound lands mid-call.
    // call 1: text-only standby → bare-text stop-checkpoint with completedTurns>0 and an
    //   injection seen → the forced-tool retry (call 2) must carry the DIRECTIVE reminder,
    //   not "verify your work before stopping".
    const provider = new ScriptedProvider([
      {
        beforeReturn: () =>
          injectContextEvent(sessionDir, 'NEW MESSAGE from Jesse: the answer is yes'),
        response: {
          content: 'Checking.',
          toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'echo hi' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
      {
        response: {
          content: 'Standby — still awaiting your answer.',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
        },
      },
      {
        response: {
          content: 'On it.',
          toolCalls: [{ id: 'tc_2', name: 'bash', arguments: { command: 'echo done' } }],
          stopReason: 'tool_use',
          usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
        },
      },
      {
        response: {
          content: 'Done.',
          toolCalls: [],
          stopReason: 'stop',
          usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
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

    expect(provider.callCount).toBeGreaterThanOrEqual(3);
    // The injection was picked up before call 1.
    expect(JSON.stringify(provider.receivedMessages[1])).toContain('NEW MESSAGE from Jesse');
    // The forced-tool retry (call 2) carries the directive, not the verify reminder.
    const retryMessages = JSON.stringify(provider.receivedMessages[2]);
    expect(retryMessages).toContain('new message arrived mid-turn');
    expect(retryMessages).not.toContain('verify your work before stopping');
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

describe('ConversationRunner - between-turn context_injected watermark', () => {
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

    // Exactly once: the rebuilt prefix already contains the between-turn
    // injection, so the tailer must not append it a second time. (Idle-arrival
    // notifications appearing twice in one request was a live duplicate-delivery
    // bug: job-completed and reminder notifications doubled.)
    const occurrences = firstCallMessages.reduce((count, m) => {
      const text =
        typeof m.content === 'string'
          ? m.content
          : (m.content as Array<{ type?: string; text?: string }>)
              .map((b) => (typeof b?.text === 'string' ? b.text : ''))
              .join('\n');
      return count + (text.split('BETWEEN-TURN-INJECT').length - 1);
    }, 0);
    expect(occurrences).toBe(1);
  });
});
