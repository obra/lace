// ABOUTME: Integration test for the model_context_window_exceeded signal flowing
// ABOUTME: through AnthropicProvider -> normalizer -> ConversationRunner. Regression
// ABOUTME: guard that chunks A (normalizer), C (runner dispatch), and I (beta endpoint
// ABOUTME: + observability betas) stay wired end-to-end without any production-code
// ABOUTME: changes required by chunk J.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '@lace/agent/providers/anthropic-provider';
import { ConversationRunner } from '@lace/agent/core/conversation/runner';
import type { RunnerConfig, RunnerDependencies } from '@lace/agent/core/conversation/types';
import type { CatalogProvider } from '@lace/agent/providers/catalog/types';
import type { AIProvider } from '@lace/agent/providers/base-provider';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { ToolCall, ToolContext, ToolResult as CoreToolResult } from '@lace/agent/tools/types';
import { anthropicBaseMessagesTrap } from '@lace/agent/test-utils/anthropic-base-namespace-trap';

// The provider routes through client.beta.messages.stream (chunk I migration).
// The base-namespace trap fires if anything regresses to client.messages.*.
const mockBetaStream = vi.fn();
const mockBetaCreate = vi.fn(() => {
  throw new Error(
    'beta.messages.create must not be called in this test — provider uses streaming path'
  );
});
const mockBetaCountTokens = vi.fn().mockResolvedValue({ input_tokens: 199_000 });

vi.mock('@anthropic-ai/sdk', () => ({
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
}));

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

const PARTIAL_TEXT = "I'll start by...";

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

/**
 * Build a thin stand-in for the SDK's MessageStream. The provider attaches
 * 'text', 'streamEvent', and 'message' listeners (see anthropic-provider.ts
 * _createStreamingResponseImpl) and then awaits finalMessage(). We don't need
 * to fire any of the listener events for this test — the provider extracts
 * text content and stop_reason from finalMessage(), so emitting a partial
 * text-delta via stream.on('text', ...) would only exercise the token-event
 * path. We keep the stub minimal and assert against the final response shape.
 */
function makeStreamStub(finalMessage: Record<string, unknown>) {
  return {
    on: vi.fn(),
    finalMessage: vi.fn().mockResolvedValue(finalMessage),
  };
}

interface ToolExecutorStub {
  getTool: (name: string) => CoreTool | undefined;
  execute: ReturnType<
    typeof vi.fn<(toolCall: ToolCall, ctx: ToolContext) => Promise<CoreToolResult>>
  >;
}

function makeToolExecutor(): ToolExecutorStub {
  const executeMock = vi
    .fn<(toolCall: ToolCall, ctx: ToolContext) => Promise<CoreToolResult>>()
    .mockImplementation((toolCall) =>
      Promise.resolve({
        id: toolCall.id,
        status: 'completed',
        content: [{ type: 'text', text: 'should-not-be-called' }],
      })
    );
  return {
    getTool: () => undefined,
    execute: executeMock,
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

describe('AnthropicProvider -> ConversationRunner integration: model_context_window_exceeded', () => {
  let sessionDir: string;
  let cwd: string;
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-ctx-window-integ-session-${testId}`);
    cwd = join(tmpdir(), `lace-ctx-window-integ-cwd-${testId}`);
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
        data: {
          type: 'system_prompt_set',
          text: 'You are a test assistant.',
        },
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
      sessionId: 'sess_ctx_window_integ',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
      modelId: 'claude-opus-4-7',
    };
  }

  it('surfaces stop_reason=model_context_window_exceeded through the full pipeline', async () => {
    // Stub the SDK's streaming endpoint to return a finalMessage with the
    // beta-introduced stop_reason. This mirrors the JSON example in the plan:
    //   { stop_reason: 'model_context_window_exceeded', stop_details: null,
    //     content: [{ type: 'text', text: "I'll start by..." }], ... }
    mockBetaStream.mockReturnValue(
      makeStreamStub({
        id: 'msg_xxx',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: PARTIAL_TEXT }],
        stop_reason: 'model_context_window_exceeded',
        stop_details: null,
        stop_sequence: null,
        usage: { input_tokens: 199_000, output_tokens: 23 },
      })
    );

    // First, drive the provider directly to verify the ProviderResponse shape.
    // The runner consumes the same provider instance immediately after, but
    // we need a clean stream stub for the runner's separate call — reset it
    // between provider call and runner call.
    const directResponse = await provider.createStreamingResponse(
      [{ role: 'user', content: 'oversized prompt' }],
      [],
      'claude-opus-4-7'
    );

    // J.2 acceptance #1: ProviderResponse.stopReason normalized to canonical name.
    expect(directResponse.stopReason).toBe('context_window_exceeded');

    // J.2 acceptance #2: stopDetails source identifies the beta as the origin.
    expect(directResponse.stopDetails).toEqual({
      type: 'context_window_exceeded',
      source: 'anthropic_beta_stop_reason',
    });

    // Sanity: betas[] on the wire includes the model-context-window-exceeded
    // beta. Without it the API wouldn't return this stop_reason at all.
    const wirePayload = mockBetaStream.mock.calls[0]![0] as { betas?: string[] };
    expect(wirePayload.betas).toContain('model-context-window-exceeded-2025-08-26');

    // Now drive the runner. Re-prime the stream stub since the runner makes
    // its own provider call (the provider re-issues stream(...) per turn).
    mockBetaStream.mockReturnValue(
      makeStreamStub({
        id: 'msg_xxx',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: PARTIAL_TEXT }],
        stop_reason: 'model_context_window_exceeded',
        stop_details: null,
        stop_sequence: null,
        usage: { input_tokens: 199_000, output_tokens: 23 },
      })
    );

    const toolExecutor = makeToolExecutor();
    const deps = makeRunnerDeps(provider, toolExecutor);
    const runner = new ConversationRunner(makeRunnerConfig(), deps);

    const result = await runner.run({
      content: [{ type: 'text', text: 'oversized prompt' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    // J.2 acceptance #3: RunResult.stopReason is the canonical name.
    expect(result.stopReason).toBe('context_window_exceeded');

    // J.2 acceptance #3a: stopDetails round-trips through the runner.
    expect(result.stopDetails).toEqual({
      type: 'context_window_exceeded',
      source: 'anthropic_beta_stop_reason',
    });

    // J.2 acceptance #4: partial assistant text is preserved.
    expect(result.content).toEqual([{ type: 'text', text: PARTIAL_TEXT }]);

    // J.2 acceptance #5: no tool calls were executed. The provider emitted no
    // tool_use blocks, so the runner should never have invoked the executor.
    expect(toolExecutor.execute).not.toHaveBeenCalled();
  });
});
