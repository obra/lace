// ABOUTME: Tests the runner chokepoint that caps oversized tool results — digesting
// ABOUTME: them in the live + durable transcript and spilling the full payload to a sidecar.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { invalidatePersonaCache, readDurableEvents } from '@lace/agent/storage/event-log';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { ToolExecutor } from '@lace/agent/tools/executor';
import { Tool } from '@lace/agent/tools/tool';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
} from '@lace/agent/providers/base-provider';
import type { Tool as ToolType } from '@lace/agent/tools/tool';
import type { ToolContext, ToolResult } from '@lace/agent/tools/types';
import { TOOL_RESULT_RIDE_WHOLE_BYTES } from '@lace/agent/tools/result-digest';

/** A tool that returns a caller-supplied text payload, so a test can control its size. */
class PayloadTool extends Tool {
  name = 'emit_payload';
  description = 'Emits a fixed payload for testing.';
  schema = z.object({}).strict();
  constructor(private readonly payload: string) {
    super();
  }
  protected async executeValidated(_args: unknown, _context: ToolContext): Promise<ToolResult> {
    return { status: 'completed', content: [{ type: 'text', text: this.payload }] };
  }
}

/** Emits a single tool_use for `toolName`, then stops on the next call. */
class SingleToolProvider extends AIProvider {
  private callCount = 0;
  constructor(private readonly toolName: string) {
    super();
  }
  get providerName(): string {
    return 'single-tool-test';
  }
  getProviderInfo() {
    return { name: 'single-tool-test', displayName: 'Single Tool Test', requiresApiKey: false };
  }
  isConfigured(): boolean {
    return true;
  }
  get supportsStreaming(): boolean {
    return true;
  }
  async createResponse(
    _messages: ProviderMessage[],
    _tools: ToolType[],
    _model: string,
    _signal?: AbortSignal,
    _state?: ConversationState,
    _options?: RequestOptions
  ): Promise<ProviderResponse> {
    return this.createStreamingResponse();
  }
  async createStreamingResponse(): Promise<ProviderResponse> {
    this.callCount++;
    if (this.callCount === 1) {
      return {
        content: '',
        toolCalls: [{ id: 'tc_payload', name: this.toolName, arguments: {} }],
        stopReason: 'tool_use',
      };
    }
    return { content: '', toolCalls: [], stopReason: 'stop' };
  }
}

function createMockDeps(overrides: Partial<RunnerDependencies> = {}): RunnerDependencies {
  return {
    onUpdate: vi.fn().mockResolvedValue(undefined),
    runExclusive: vi
      .fn()
      .mockImplementation(<T>(fn: () => T | Promise<T>) => Promise.resolve(fn())),
    requestPermission: vi.fn().mockResolvedValue({ decision: 'allow' }),
    createToolExecutor: vi.fn(),
    createProvider: vi.fn(),
    getModelPricing: vi.fn().mockResolvedValue(null),
    startShellJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    startSubagentJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    deriveJobs: vi.fn().mockReturnValue([]),
    finalizeJob: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockReturnValue(undefined),
    jobManager: undefined,
    mcpServerManager: undefined,
    setActiveTurnStatus: vi.fn(),
    getSessionCostUsd: vi.fn().mockReturnValue(0),
    updateSessionUsage: vi.fn(),
    ...overrides,
  };
}

function durableToolResultText(sessionDir: string, toolCallId: string): string {
  const { events } = readDurableEvents(sessionDir, { types: ['tool_use'] });
  for (const ev of events) {
    if (ev.type !== 'tool_use') continue;
    const data = ev.data as {
      toolCallId?: string;
      result?: { content?: Array<{ text?: string }> };
    };
    if (data.toolCallId !== toolCallId) continue;
    return (data.result?.content ?? []).map((b) => b.text ?? '').join('');
  }
  throw new Error(`no durable tool_use event for ${toolCallId}`);
}

describe('runner tool-result capping', () => {
  let laceDir: string;
  let sessionDir: string;
  let sessionId: string;
  let cwd: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-runner-cap-'));
    sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    cwd = join(tmpdir(), `lace-runner-cap-cwd-${randomUUID().substring(0, 8)}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
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

  function runWithPayload(payload: string) {
    const provider = new SingleToolProvider('emit_payload');
    const executor = new ToolExecutor();
    executor.registerTools([new PayloadTool(payload)]);
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
    return runner.run({
      content: [{ type: 'text', text: 'go' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns: 2,
    });
  }

  it('digests an oversized result and spills the full payload to a sidecar', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 4000; i++) lines.push(`payload line ${i} with extra padding text here`);
    const payload = lines.join('\n') + '\n';
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThan(TOOL_RESULT_RIDE_WHOLE_BYTES);

    await runWithPayload(payload);

    // Durable tool_use event carries the digest, not the full payload.
    const durable = durableToolResultText(sessionDir, 'tc_payload');
    expect(Buffer.byteLength(durable, 'utf8')).toBeLessThan(Buffer.byteLength(payload, 'utf8'));
    expect(durable).toContain('bytes elided');
    expect(durable).toContain('read_tool_result');
    expect(durable).toContain('payload line 0 ');

    // The sidecar holds the full payload.
    const sidecar = join(sessionDir, 'tool-results', 'tc_payload.txt');
    expect(existsSync(sidecar)).toBe(true);
    expect(readFileSync(sidecar, 'utf8')).toBe(payload);
  });

  it('passes a small result through unchanged and writes no sidecar', async () => {
    const payload = 'small result\nsecond line\n';
    await runWithPayload(payload);

    const durable = durableToolResultText(sessionDir, 'tc_payload');
    expect(durable).toBe(payload);

    const sidecar = join(sessionDir, 'tool-results', 'tc_payload.txt');
    expect(existsSync(sidecar)).toBe(false);
  });
});
