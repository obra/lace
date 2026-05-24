// ABOUTME: Cache-diagnosis-2026-04-07 beta — request payload + response capture + persistence
// ABOUTME: Covers K.6 (diagnostics request), K.8 (cache_miss_reason capture + INFO log),
// ABOUTME: K.10 (turn_end persistence) for the cache diagnostics observability feature.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockBetaCreate = vi.fn();
const mockBetaStream = vi.fn();
const mockBetaCountTokens = vi.fn().mockResolvedValue({ input_tokens: 100 });

vi.mock('@anthropic-ai/sdk', async () => {
  const { anthropicBaseMessagesTrap } = await import(
    '@lace/agent/test-utils/anthropic-base-namespace-trap'
  );
  return {
    default: class MockAnthropic {
      messages = anthropicBaseMessagesTrap();
      beta = {
        messages: {
          create: mockBetaCreate,
          stream: mockBetaStream,
          countTokens: mockBetaCountTokens,
        },
      };
    },
  };
});

vi.mock('@lace/agent/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@lace/agent/utils/provider-logging', () => ({
  logProviderRequest: vi.fn(),
  logProviderResponse: vi.fn(),
}));

import { AnthropicProvider } from '@lace/agent/providers/anthropic-provider';
import { ConversationRunner } from '@lace/agent/core/conversation/runner';
import type { RunnerConfig, RunnerDependencies } from '@lace/agent/core/conversation/types';
import type { CatalogProvider } from '@lace/agent/providers/catalog/types';
import type { AIProvider } from '@lace/agent/providers/base-provider';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { ToolCall, ToolContext, ToolResult as CoreToolResult } from '@lace/agent/tools/types';
import { readDurableEvents } from '@lace/agent/storage/event-log';
import { logger as loggerMock } from '@lace/agent/utils/logger';

const plainCatalog: CatalogProvider = {
  name: 'Anthropic',
  id: 'anthropic',
  type: 'anthropic',
  default_large_model_id: 'claude-opus-4-7',
  default_small_model_id: 'claude-opus-4-7',
  models: [
    {
      id: 'claude-opus-4-7',
      name: 'Claude Opus 4.7',
      context_window: 200_000,
      default_max_tokens: 32_000,
    },
  ],
};

function makeStreamStub(finalMessage: Record<string, unknown>) {
  return {
    on: vi.fn(),
    finalMessage: vi.fn().mockResolvedValue(finalMessage),
  };
}

describe('AnthropicProvider cache-diagnosis-2026-04-07 beta', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider({
      apiKey: 'test-key',
      catalogProvider: plainCatalog,
    });
    provider.setSystemPrompt('test sys');
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  describe('K.6 — request payload includes diagnostics when beta enabled', () => {
    it('sends diagnostics.previous_message_id when previousResponseId is set', async () => {
      mockBetaCreate.mockResolvedValue({
        id: 'msg_xyz',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
        diagnostics: { cache_miss_reason: null },
      });

      await provider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-opus-4-7',
        undefined,
        { previousResponseId: 'msg_prev_123' }
      );

      const payload = mockBetaCreate.mock.calls[0]![0] as {
        diagnostics?: { previous_message_id: string | null };
      };
      expect(payload.diagnostics).toEqual({ previous_message_id: 'msg_prev_123' });
    });

    it('sends diagnostics.previous_message_id: null when previousResponseId is unset (first turn)', async () => {
      mockBetaCreate.mockResolvedValue({
        id: 'msg_xyz',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
        diagnostics: { cache_miss_reason: null },
      });

      await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-7');

      const payload = mockBetaCreate.mock.calls[0]![0] as {
        diagnostics?: { previous_message_id: string | null };
      };
      expect(payload.diagnostics).toEqual({ previous_message_id: null });
    });

    it('omits the diagnostics field entirely when observability_betas_enabled is false', async () => {
      const optedOutProvider = new AnthropicProvider({
        apiKey: 'test-key',
        catalogProvider: plainCatalog,
        observability_betas_enabled: false,
      });
      optedOutProvider.setSystemPrompt('test sys');

      mockBetaCreate.mockResolvedValue({
        id: 'msg_xyz',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await optedOutProvider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-opus-4-7',
        undefined,
        { previousResponseId: 'msg_prev_123' }
      );

      const payload = mockBetaCreate.mock.calls[0]![0] as { diagnostics?: unknown };
      expect(payload.diagnostics).toBeUndefined();

      optedOutProvider.removeAllListeners();
    });

    it('sends diagnostics on streaming requests too', async () => {
      mockBetaStream.mockReturnValue(
        makeStreamStub({
          id: 'msg_xyz',
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
          diagnostics: { cache_miss_reason: null },
        })
      );

      await provider.createStreamingResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-opus-4-7',
        undefined,
        { previousResponseId: 'msg_prev_999' }
      );

      const payload = mockBetaStream.mock.calls[0]![0] as {
        diagnostics?: { previous_message_id: string | null };
      };
      expect(payload.diagnostics).toEqual({ previous_message_id: 'msg_prev_999' });
    });
  });

  describe('K.8 — cache_miss_reason captured from final message', () => {
    it('captures diagnostics.cache_miss_reason on ProviderResponse (non-streaming)', async () => {
      const cacheMissReason = {
        type: 'system_changed' as const,
        cache_missed_input_tokens: 12345,
      };
      mockBetaCreate.mockResolvedValue({
        id: 'msg_xyz',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
        diagnostics: { cache_miss_reason: cacheMissReason },
      });

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-opus-4-7'
      );

      expect(response.cacheMissReason).toEqual(cacheMissReason);
    });

    it('captures diagnostics.cache_miss_reason on ProviderResponse (streaming)', async () => {
      const cacheMissReason = {
        type: 'system_changed' as const,
        cache_missed_input_tokens: 12345,
      };
      mockBetaStream.mockReturnValue(
        makeStreamStub({
          id: 'msg_xyz',
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
          diagnostics: { cache_miss_reason: cacheMissReason },
        })
      );

      const response = await provider.createStreamingResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-opus-4-7'
      );

      expect(response.cacheMissReason).toEqual(cacheMissReason);
    });

    it('emits an INFO log with cache miss details (including model + response-id pair for PRI-1796 pivots)', async () => {
      const cacheMissReason = {
        type: 'system_changed' as const,
        cache_missed_input_tokens: 12345,
      };
      mockBetaCreate.mockResolvedValue({
        id: 'msg_xyz',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
        diagnostics: { cache_miss_reason: cacheMissReason },
      });

      await provider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-opus-4-7',
        undefined,
        { previousResponseId: 'msg_prev_abc' }
      );

      expect(loggerMock.info).toHaveBeenCalledWith('Anthropic cache miss', {
        type: 'system_changed',
        missedTokens: 12345,
        model: 'claude-opus-4-7',
        previousResponseId: 'msg_prev_abc',
        currentResponseId: 'msg_xyz',
      });
    });

    it('emits an INFO log with previousResponseId=null on first turn', async () => {
      const cacheMissReason = {
        type: 'system_changed' as const,
        cache_missed_input_tokens: 12345,
      };
      mockBetaCreate.mockResolvedValue({
        id: 'msg_xyz',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
        diagnostics: { cache_miss_reason: cacheMissReason },
      });

      await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-7');

      expect(loggerMock.info).toHaveBeenCalledWith('Anthropic cache miss', {
        type: 'system_changed',
        missedTokens: 12345,
        model: 'claude-opus-4-7',
        previousResponseId: null,
        currentResponseId: 'msg_xyz',
      });
    });

    it('handles miss variants without cache_missed_input_tokens (unavailable)', async () => {
      const cacheMissReason = { type: 'unavailable' as const };
      mockBetaCreate.mockResolvedValue({
        id: 'msg_xyz',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
        diagnostics: { cache_miss_reason: cacheMissReason },
      });

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-opus-4-7'
      );

      expect(response.cacheMissReason).toEqual(cacheMissReason);
      expect(loggerMock.info).toHaveBeenCalledWith('Anthropic cache miss', {
        type: 'unavailable',
        missedTokens: undefined,
        model: 'claude-opus-4-7',
        previousResponseId: null,
        currentResponseId: 'msg_xyz',
      });
    });

    it('returns cacheMissReason=null when diagnostics.cache_miss_reason is null (cache hit)', async () => {
      mockBetaCreate.mockResolvedValue({
        id: 'msg_xyz',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
        diagnostics: { cache_miss_reason: null },
      });

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-opus-4-7'
      );

      expect(response.cacheMissReason).toBeNull();
      expect(loggerMock.info).not.toHaveBeenCalledWith('Anthropic cache miss', expect.anything());
    });

    it('returns cacheMissReason=null when response has no diagnostics field', async () => {
      mockBetaCreate.mockResolvedValue({
        id: 'msg_xyz',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-opus-4-7'
      );

      expect(response.cacheMissReason).toBeNull();
    });
  });
});

// K.10 — turn_end persists cacheMissReason. Driven through the runner end-to-end
// so we exercise the production write path, not a direct stubbed Anthropic call.

interface ToolExecutorStub {
  getTool: (name: string) => CoreTool | undefined;
  execute: ReturnType<
    typeof vi.fn<(toolCall: ToolCall, ctx: ToolContext) => Promise<CoreToolResult>>
  >;
}

function makeToolExecutor(): ToolExecutorStub {
  return {
    getTool: () => undefined,
    execute: vi.fn().mockResolvedValue({
      id: 'noop',
      status: 'completed',
      content: [{ type: 'text', text: 'noop' }],
    }),
  };
}

function makeRunnerDeps(provider: AIProvider, toolExecutor: ToolExecutorStub): RunnerDependencies {
  const jobManager = {
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
    jobManager: jobManager as unknown as RunnerDependencies['jobManager'],
    mcpServerManager: undefined,
    setActiveTurnStatus: vi.fn(),
    getSessionCostUsd: vi.fn().mockReturnValue(0),
    updateSessionUsage: vi.fn(),
  };
}

describe('K.10 — turn_end durable event persists cacheMissReason', () => {
  let sessionDir: string;
  let cwd: string;
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-cache-diag-session-${testId}`);
    cwd = join(tmpdir(), `lace-cache-diag-cwd-${testId}`);
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

    provider = new AnthropicProvider({
      apiKey: 'test-key',
      catalogProvider: plainCatalog,
    });
    provider.setSystemPrompt('You are a test assistant.');
  });

  afterEach(() => {
    provider.removeAllListeners();
    if (existsSync(sessionDir)) rmSync(sessionDir, { recursive: true, force: true });
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  function makeRunnerConfig(): RunnerConfig {
    return {
      sessionDir,
      sessionId: 'sess_cache_diag',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      modelId: 'claude-opus-4-7',
    };
  }

  it('writes turn_end.data.cacheMissReason from the final provider response on cache miss', async () => {
    const cacheMissReason = {
      type: 'system_changed' as const,
      cache_missed_input_tokens: 9001,
    };

    mockBetaStream.mockReturnValue(
      makeStreamStub({
        id: 'msg_cache_miss',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'response after a cache miss' }],
        stop_reason: 'end_turn',
        stop_details: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 10 },
        diagnostics: { cache_miss_reason: cacheMissReason },
      })
    );

    const toolExecutor = makeToolExecutor();
    const deps = makeRunnerDeps(provider, toolExecutor);
    const runner = new ConversationRunner(makeRunnerConfig(), deps);

    await runner.run({
      content: [{ type: 'text', text: 'hi' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const turnEnd = events.find((e) => e.type === 'turn_end');
    expect(turnEnd).toBeDefined();
    const data = turnEnd!.data as { cacheMissReason?: unknown };
    expect(data.cacheMissReason).toEqual(cacheMissReason);
  });

  it('writes turn_end.data.cacheMissReason as null on cache hit', async () => {
    mockBetaStream.mockReturnValue(
      makeStreamStub({
        id: 'msg_cache_hit',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'response after a cache hit' }],
        stop_reason: 'end_turn',
        stop_details: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 10 },
        diagnostics: { cache_miss_reason: null },
      })
    );

    const toolExecutor = makeToolExecutor();
    const deps = makeRunnerDeps(provider, toolExecutor);
    const runner = new ConversationRunner(makeRunnerConfig(), deps);

    await runner.run({
      content: [{ type: 'text', text: 'hi' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const turnEnd = events.find((e) => e.type === 'turn_end');
    expect(turnEnd).toBeDefined();
    const data = turnEnd!.data as { cacheMissReason?: unknown };
    expect(data.cacheMissReason).toBeNull();
  });
});
