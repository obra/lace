// ABOUTME: Tests that ConversationRunner threads deps.personaRegistry into
// deps.createToolExecutor, so embedder-supplied user personas reach the
// DelegateTool that ToolExecutor.registerAllAvailableTools instantiates.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { PersonaRegistry } from '@lace/agent/config/persona-registry';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import type { JobManager } from '@lace/agent/jobs/job-manager';

function makePersonaRegistry(userPersonasDir: string): PersonaRegistry {
  // bundledPersonasPath points at an empty tempdir so we can assert
  // user-only resolution without bundled noise.
  const emptyBundle = mkdtempSync(join(tmpdir(), 'lace-bundle-empty-'));
  return new PersonaRegistry({
    bundledPersonasPath: emptyBundle,
    userPersonasPaths: [userPersonasDir],
  });
}

// Single source of truth for the JobManager mock surface used by these tests.
// Confines the unsafe cast to one place; callers get a properly typed JobManager.
function makeMockJobManager(overrides: Partial<JobManager> = {}): JobManager {
  const base: Partial<JobManager> = {
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
    queueNotification: vi.fn(),
    flushNotifications: vi.fn().mockReturnValue([]),
    getNotificationQueue: vi.fn().mockReturnValue([]),
    getRunningJobs: vi.fn().mockReturnValue([]),
  };
  return { ...base, ...overrides } as JobManager;
}

// Names the positional arguments to deps.createToolExecutor so assertions
// reference them by shape, not index. Update this helper (one place) if
// the signature ever grows to an options bag.
type CreateToolExecutorParams = Parameters<RunnerDependencies['createToolExecutor']>;
function getCreateToolExecutorArgs(call: unknown[] | undefined): Partial<{
  executionMode: CreateToolExecutorParams[0];
  mcpServerManager: CreateToolExecutorParams[1];
  jobManager: CreateToolExecutorParams[2];
  skillRegistry: CreateToolExecutorParams[3];
  personaRegistry: CreateToolExecutorParams[4];
}> {
  const [executionMode, mcpServerManager, jobManager, skillRegistry, personaRegistry] = (call ??
    []) as CreateToolExecutorParams;
  return { executionMode, mcpServerManager, jobManager, skillRegistry, personaRegistry };
}

function makeMockDeps(overrides: Partial<RunnerDependencies>): RunnerDependencies {
  const mockExecutor = {
    getTool: vi.fn().mockReturnValue(undefined),
    execute: vi.fn().mockResolvedValue({ status: 'completed', content: [] }),
  };

  return {
    onUpdate: vi.fn().mockResolvedValue(undefined),
    runExclusive: vi
      .fn()
      .mockImplementation(<T>(fn: () => T | Promise<T>) => Promise.resolve(fn())),
    requestPermission: vi.fn().mockResolvedValue({ decision: 'allow' }),
    createToolExecutor: vi.fn().mockResolvedValue({
      executor: mockExecutor,
      toolsForProvider: [],
    }),
    createProvider: vi.fn().mockImplementation(async () => new TestAgentProvider()),
    getModelPricing: vi.fn().mockResolvedValue(null),
    startShellJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    jobManager: makeMockJobManager(),
    mcpServerManager: undefined,
    setActiveTurnStatus: vi.fn(),
    getSessionCostUsd: vi.fn().mockReturnValue(0),
    updateSessionUsage: vi.fn(),
    ...overrides,
  };
}

describe('ConversationRunner threads personaRegistry into deps.createToolExecutor', () => {
  let sessionDir: string;
  let cwd: string;
  let userPersonasDir: string;

  beforeEach(() => {
    const testId = randomUUID().substring(0, 8);
    sessionDir = join(tmpdir(), `lace-runner-persona-session-${testId}`);
    cwd = join(tmpdir(), `lace-runner-persona-cwd-${testId}`);
    userPersonasDir = join(tmpdir(), `lace-runner-persona-personas-${testId}`);
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    mkdirSync(userPersonasDir, { recursive: true });
    writeFileSync(join(userPersonasDir, 'test-shell.md'), 'You are a shell tester.');
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({ nextEventSeq: 1, nextStreamSeq: 1 })
    );
    writeFileSync(join(sessionDir, 'events.jsonl'), '');
  });

  afterEach(() => {
    for (const dir of [sessionDir, cwd, userPersonasDir]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes deps.personaRegistry as the 5th arg to deps.createToolExecutor', async () => {
    const personaRegistry = makePersonaRegistry(userPersonasDir);
    const createToolExecutor = vi.fn().mockResolvedValue({
      executor: {
        getTool: vi.fn().mockReturnValue(undefined),
        execute: vi.fn().mockResolvedValue({ status: 'completed', content: [] }),
      },
      toolsForProvider: [],
    });

    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = makeMockDeps({ createToolExecutor, personaRegistry });
    const runner = new ConversationRunner(config, deps);

    await runner.run({
      content: [{ type: 'text', text: 'hi' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(createToolExecutor).toHaveBeenCalledTimes(1);
    expect(getCreateToolExecutorArgs(createToolExecutor.mock.calls[0]).personaRegistry).toBe(
      personaRegistry
    );
  });

  it('passes undefined when deps.personaRegistry is omitted', async () => {
    const createToolExecutor = vi.fn().mockResolvedValue({
      executor: {
        getTool: vi.fn().mockReturnValue(undefined),
        execute: vi.fn().mockResolvedValue({ status: 'completed', content: [] }),
      },
      toolsForProvider: [],
    });

    const config: RunnerConfig = {
      sessionDir,
      sessionId: 'sess_test',
      cwd,
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = makeMockDeps({ createToolExecutor /* no personaRegistry */ });
    const runner = new ConversationRunner(config, deps);

    await runner.run({
      content: [{ type: 'text', text: 'hi' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    expect(
      getCreateToolExecutorArgs(createToolExecutor.mock.calls[0]).personaRegistry
    ).toBeUndefined();
  });

  it('createToolExecutorForMode wires personaRegistry into DelegateTool', async () => {
    // End-to-end-ish: use the real createToolExecutorForMode so we exercise
    // registerAllAvailableTools + new DelegateTool({personaRegistry}). We
    // don't actually run the runner — we just verify that wiring deps
    // .personaRegistry through the runner's createToolExecutor produces a
    // DelegateTool that sees the user persona.
    const { createToolExecutorForMode } = await import('@lace/agent/server');
    const personaRegistry = makePersonaRegistry(userPersonasDir);

    const { executor } = await createToolExecutorForMode(
      'execute',
      undefined,
      undefined,
      undefined,
      undefined,
      personaRegistry
    );

    const delegate = executor.getTool('delegate');
    expect(delegate).toBeDefined();

    // delegate runs in background to avoid waiting on job completion. If
    // wiring is broken, this falls back to defaultPersonaRegistry which
    // does not see our tempdir → status: 'failed' with PersonaNotFoundError.
    const mockJobManager = makeMockJobManager({
      createJob: vi.fn().mockResolvedValue({
        jobId: 'job_test',
        // Never-resolving completion is safe: background:true returns
        // immediately on createJob and the test never awaits this promise.
        job: { completion: new Promise(() => {}) },
      }),
    });
    const result = await delegate!.execute(
      { prompt: 'go', persona: 'test-shell', background: true },
      {
        signal: new AbortController().signal,
        jobManager: mockJobManager,
      }
    );

    expect(result.status).toBe('completed');
  });
});
