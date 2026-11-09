// ABOUTME: Tests the memory-only credential env overlay (PRI-3672) reaching
// ABOUTME: both tool-call env paths, on both host and container runtimes.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invalidatePersonaCache } from '@lace/agent/storage/event-log';
import { ConversationRunner } from '../runner';
import type { RunnerDependencies } from '../types';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
} from '@lace/agent/providers/base-provider';
import type { Tool } from '@lace/agent/tools/tool';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

/**
 * A provider that emits one tool call per prompt turn, then stops — enough
 * to drive the runner's tool-call loop exactly once without a real model.
 */
class SingleToolCallProvider extends AIProvider {
  constructor(
    private readonly toolCallId: string,
    private readonly toolName: string
  ) {
    super();
  }

  get providerName(): string {
    return 'env-overlay-test';
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

  async createStreamingResponse(): Promise<ProviderResponse> {
    return {
      content: '',
      toolCalls: [{ id: this.toolCallId, name: this.toolName, arguments: { command: 'true' } }],
      stopReason: 'tool_use',
    };
  }
}

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
    createProvider: vi.fn(),
    createToolExecutor: vi.fn(),
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

/** A fake ProjectedContainerManager — no real docker involved. */
function createFakeContainerManager() {
  return {
    materialize: vi.fn().mockResolvedValue({
      spec: { name: 'projected-runtime', containerId: 'container_123' },
      containerId: 'container_123',
      state: 'running' as const,
    }),
    execStream: vi.fn().mockImplementation(() =>
      Promise.resolve({
        stdin: new PassThrough(),
        stdout: Readable.from(['']),
        stderr: Readable.from([]),
        wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
        kill: vi.fn(),
      })
    ),
  };
}

describe('ConversationRunner env overlay (PRI-3672)', () => {
  let laceDir: string;
  let sessionDir: string;
  let cwd: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-env-overlay-test-'));
    const sessionId = `sess_${randomUUID()}`;
    sessionDir = join(laceDir, 'agent-sessions', sessionId);
    cwd = join(tmpdir(), `lace-env-overlay-test-cwd-${randomUUID().slice(0, 8)}`);
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

  it('reaches ToolContext.processEnv on a host runtime', async () => {
    const mockTool = { name: 'bash', description: 'mock bash', schema: {} } as unknown as Tool;
    const execute = vi
      .fn()
      .mockResolvedValue({ status: 'completed', content: [{ type: 'text', text: 'ok' }] });

    const deps = createMockDeps({
      createProvider: vi
        .fn()
        .mockImplementation(async () => new SingleToolCallProvider('tc_1', 'bash')),
      createToolExecutor: vi.fn().mockReturnValue({
        executor: { getTool: vi.fn().mockReturnValue(mockTool), execute },
        toolsForProvider: [mockTool],
      }),
      getEnvOverlay: () => ({ MINTED_CRED: 'test-placeholder-xyz' }),
    });

    const runner = new ConversationRunner(
      {
        sessionDir,
        sessionId: 'sess_test',
        cwd,
        executionMode: 'execute',
        approvalMode: 'approve',
      },
      deps
    );

    await runner.run({
      content: [{ type: 'text', text: 'go' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns: 1,
    });

    expect(execute).toHaveBeenCalledOnce();
    const context = execute.mock.calls[0][1] as { processEnv?: Record<string, string> };
    expect(context.processEnv).toMatchObject({ MINTED_CRED: 'test-placeholder-xyz' });
  });

  it('reaches both env paths on the container runtime: createRuntime(env) and processEnv', async () => {
    const mockTool = { name: 'bash', description: 'mock bash', schema: {} } as unknown as Tool;
    const execute = vi
      .fn()
      .mockResolvedValue({ status: 'completed', content: [{ type: 'text', text: 'ok' }] });
    const containerManager = createFakeContainerManager();

    const runtimeBinding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_container_env_overlay' },
      toolRuntime: {
        type: 'container',
        cwd: '/workspace',
        spec: {
          name: 'projected-runtime',
          containerId: 'container_123',
          image: 'example/app@sha256:' + 'b'.repeat(64),
          workingDirectory: '/workspace',
          mounts: [],
        },
      },
    } as unknown as RuntimeExecutionBinding;

    const deps = createMockDeps({
      createProvider: vi
        .fn()
        .mockImplementation(async () => new SingleToolCallProvider('tc_container', 'bash')),
      createToolExecutor: vi.fn().mockReturnValue({
        executor: { getTool: vi.fn().mockReturnValue(mockTool), execute },
        toolsForProvider: [mockTool],
      }),
      getEnvOverlay: () => ({ MINTED_CRED: 'test-placeholder-xyz' }),
      containerManager: containerManager as unknown as RunnerDependencies['containerManager'],
    });

    const runner = new ConversationRunner(
      {
        sessionDir,
        sessionId: 'sess_test',
        cwd: '/workspace',
        runtimeBinding,
        executionMode: 'execute',
        approvalMode: 'approve',
      },
      deps
    );

    await runner.run({
      content: [{ type: 'text', text: 'go' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns: 1,
    });

    expect(execute).toHaveBeenCalledOnce();
    const context = execute.mock.calls[0][1] as {
      processEnv?: Record<string, string>;
      runtime?: { kind: string };
    };
    // The runtime ToolContext actually got back is the container runtime
    // (proves createRuntime(runtimeBinding, envOverlay) at the container
    // path succeeded rather than silently falling back to a host runtime).
    expect(context.runtime?.kind).toBe('container');
    // The SAME call also carries processEnv — the field bash.ts/ripgrep
    // actually pass to runtime.process.start, which is what ultimately
    // reaches `docker exec -e` (exec-environment.ts) for a container.
    expect(context.processEnv).toMatchObject({ MINTED_CRED: 'test-placeholder-xyz' });
  });

  it('is read fresh at EVERY tool call, not cached once per run', async () => {
    let overlay: Record<string, string> | undefined = undefined;
    const mockTool = { name: 'bash', description: 'mock bash', schema: {} } as unknown as Tool;
    const execute = vi
      .fn()
      .mockResolvedValue({ status: 'completed', content: [{ type: 'text', text: 'ok' }] });

    const deps = createMockDeps({
      createProvider: vi
        .fn()
        .mockImplementation(async () => new SingleToolCallProvider('tc_1', 'bash')),
      createToolExecutor: vi.fn().mockReturnValue({
        executor: { getTool: vi.fn().mockReturnValue(mockTool), execute },
        toolsForProvider: [mockTool],
      }),
      // Returns whatever `overlay` currently points to — mutated BETWEEN runs
      // below, simulating a credential minted mid-session via
      // ent/session/env_overlay/set after the runner was already constructed.
      getEnvOverlay: () => overlay,
    });

    const runner = new ConversationRunner(
      {
        sessionDir,
        sessionId: 'sess_test',
        cwd,
        executionMode: 'execute',
        approvalMode: 'approve',
      },
      deps
    );

    await runner.run({
      content: [{ type: 'text', text: 'first' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns: 1,
    });
    expect(
      (execute.mock.calls[0][1] as { processEnv?: Record<string, string> }).processEnv
    ).not.toMatchObject({ LATE_CRED: 'test-placeholder-xyz' });

    // "Mint" the credential mid-session, as sen-core's broker would via
    // ent/session/env_overlay/set — no new ConversationRunner is constructed.
    overlay = { LATE_CRED: 'test-placeholder-xyz' };

    await runner.run({
      content: [{ type: 'text', text: 'second' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
      maxTurns: 1,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(
      (execute.mock.calls[1][1] as { processEnv?: Record<string, string> }).processEnv
    ).toMatchObject({ LATE_CRED: 'test-placeholder-xyz' });
  });
});
