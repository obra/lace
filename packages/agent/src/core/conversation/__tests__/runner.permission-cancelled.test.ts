// ABOUTME: Pins kata #37 Layer C — runner cancels a tool call when the permission
// ABOUTME: request throws, but the cancelled-permission path never updated stopReason
// ABOUTME: away from the default 'end_turn'. Parent subagent-job then mapped the
// ABOUTME: turn to job.status='completed' — a silent loss of the subagent's writes.

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

function fakeTool(name: string): CoreTool {
  // annotations.destructiveHint forces the runner to ask permission even
  // when annotations are otherwise absent — without it the runner may short
  // circuit on 'read' kind tools (file_read is 'read'). For this test we
  // need permission to actually be requested so we can have it throw.
  return {
    name,
    annotations: { destructiveHint: true },
  } as unknown as CoreTool;
}

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

describe('ConversationRunner — permission cancelled stopReason (kata #37 Layer C)', () => {
  let sessionDir: string;
  let cwd: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-perm-cancel-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-perm-cancel-cwd-${testId}`);
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

  function makeConfig(approvalMode: RunnerConfig['approvalMode'] = 'ask'): RunnerConfig {
    return {
      sessionDir,
      sessionId: 'sess_perm_cancel',
      cwd,
      executionMode: 'execute',
      approvalMode,
    };
  }

  function runOnce(
    provider: AIProvider,
    toolExecutor: ReturnType<typeof makeToolExecutor>,
    deps: RunnerDependencies,
    approvalMode: RunnerConfig['approvalMode'] = 'ask'
  ) {
    const runner = new ConversationRunner(makeConfig(approvalMode), deps);
    return runner.run({
      content: [{ type: 'text', text: 'prompt under test' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * Production parallel:
   *   • Parent runs in 'dangerouslySkipPermissions' but kata #37 Layer A bug
   *     caused the child to be spawned in 'ask'.
   *   • Subagent's first turn requests file_edit on persona/persona.md.
   *   • Supervisor has no session/request_permission handler → cancels in
   *     ~15ms (requestPermission throws).
   *   • Runner currently returns shouldContinue=false but leaves stopReason
   *     at its initial 'end_turn'. subagent-job.ts then logs
   *     job.status='completed' for a turn whose writes were silently lost.
   *
   * Pinned behaviour: when the only reason the turn ended is that the
   * permission request was cancelled (not denied — *cancelled*), the runner
   * MUST surface a distinct stopReason so the parent can tell this apart
   * from a clean end_turn. We use 'permission_cancelled'.
   */
  it('FAILING — permission cancelled mid-turn must NOT report stopReason=end_turn', async () => {
    const provider = new ScriptedProvider([
      // Turn 1: tool_use(file_edit) — needs permission.
      {
        content: 'Editing the persona file.',
        toolCalls: [
          {
            id: 'call_1',
            name: 'file_edit',
            arguments: { path: 'persona/persona.md', old_string: '', new_string: 'note' },
          },
        ],
        stopReason: 'tool_use',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
    ]);

    const toolExecutor = makeToolExecutor([]);

    // requestPermission throws — simulates the supervisor cancelling because
    // it has no handler registered (kata #37 production trace, ~15ms cancel).
    const deps = createMockDeps(provider, toolExecutor, {
      requestPermission: vi.fn().mockRejectedValue(new Error('cancelled')),
    });

    const result = await runOnce(provider, toolExecutor, deps, 'ask');

    expect(result.stopReason).not.toBe('end_turn');
    expect(result.stopReason).toBe('permission_cancelled');
  });

  /**
   * Negative — a clean end_turn must still report 'end_turn'. Guards against
   * over-correcting (e.g. marking every short turn as cancelled).
   */
  it('PASSING — clean text-only response still reports stopReason=end_turn', async () => {
    const provider = new ScriptedProvider([
      {
        content: 'The file is fine; no changes needed.',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
      },
    ]);

    const toolExecutor = makeToolExecutor([]);
    const deps = createMockDeps(provider, toolExecutor);

    const result = await runOnce(provider, toolExecutor, deps);
    expect(result.stopReason).toBe('end_turn');
  });

  /**
   * Negative — a tool that was denied (user said no, not cancelled) must
   * surface as something other than 'permission_cancelled'. Today the runner
   * also breaks the loop on denied with stopReason='end_turn'; that's a
   * known separate issue (the parent at least sees an explicit denied tool
   * result in the durable event log). What we MUST avoid is collapsing
   * denied and cancelled into the same stopReason — they have different
   * meanings to the parent.
   */
  it('PASSING — explicit deny is NOT classified as permission_cancelled', async () => {
    const provider = new ScriptedProvider([
      {
        content: 'Trying to edit.',
        toolCalls: [
          {
            id: 'call_1',
            name: 'file_edit',
            arguments: { path: 'x.md', old_string: '', new_string: 'y' },
          },
        ],
        stopReason: 'tool_use',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
    ]);

    const toolExecutor = makeToolExecutor([]);
    const deps = createMockDeps(provider, toolExecutor, {
      requestPermission: vi.fn().mockResolvedValue({ decision: 'deny' }),
    });

    const result = await runOnce(provider, toolExecutor, deps, 'ask');
    expect(result.stopReason).not.toBe('permission_cancelled');
  });
});
