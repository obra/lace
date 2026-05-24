// ABOUTME: Verifies subagent-job surfaces structured stopDetails from the child's
// ABOUTME: session/prompt response to the parent agent. When the child reports a
// ABOUTME: terminal stop with diagnostic context (refusal, context-window exceeded,
// ABOUTME: provider failure), the parent must see a [SUBAGENT STOP: ...] block in
// ABOUTME: the job output file — that block is what the job-failed notification's
// ABOUTME: trailing-line hint surfaces back to the parent's conversation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JsonRpcPeer } from '@lace/ent-protocol';
import {
  writeSessionMeta,
  writeSessionState,
  ensureSessionFiles,
} from '@lace/agent/storage/session-store';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import type { MountRegistryEntry, JobState } from '@lace/agent/server-types';
import type { SubagentProcessHandle } from '@lace/agent/jobs/subagent-spawn';
import type { LaceStopDetails } from '@lace/agent/providers/base-provider';

const spawnMock = vi.hoisted(() => ({
  current: undefined as ((options: unknown) => Promise<SubagentProcessHandle>) | undefined,
}));

vi.mock('@lace/agent/jobs/subagent-spawn', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    spawnSubagent: vi.fn((opts: unknown) => spawnMock.current!(opts)),
  };
});

import { runSubagentJobProcess } from '@lace/agent/jobs/subagent-job';

interface FakeSubagentHandle extends SubagentProcessHandle {
  resolveExit(): void;
}

function makeFakeSubagent(): FakeSubagentHandle {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let exitCode: number | null = null;
  const exitListeners: Array<
    (info: { code: number | null; signal: NodeJS.Signals | null }) => void
  > = [];
  let resolveWait: (info: { exitCode: number | null }) => void = () => undefined;
  const waitPromise = new Promise<{ exitCode: number | null }>((resolve) => {
    resolveWait = resolve;
  });

  return {
    stdin,
    stdout,
    stderr,
    get exitCode() {
      return exitCode;
    },
    kill() {},
    onExit(cb) {
      exitListeners.push(cb);
    },
    onSpawnError() {},
    wait() {
      return waitPromise;
    },
    nativeProcess: null,
    containerExec: null,
    resolveExit() {
      if (exitCode !== null) return;
      exitCode = 0;
      stdout.end();
      stderr.end();
      resolveWait({ exitCode: 0 });
      for (const cb of exitListeners) cb({ code: 0, signal: null });
    },
  };
}

describe('runSubagentJobProcess — surfaces stopDetails from session/prompt', () => {
  let sessionRootDir: string;
  let parentSessionId: string;
  let parentSessionDir: string;
  let parentWorkDir: string;
  let fakeHandle: FakeSubagentHandle;
  let requestSpy: ReturnType<typeof vi.spyOn>;
  const previousLaceSessionDir = process.env.LACE_SESSION_DIR;

  /**
   * Build a working JobState + state object pair. The promptResponse argument
   * is what the test wants the child's session/prompt RPC to resolve with — the
   * fixture below stubs JsonRpcPeer.prototype.request to return it verbatim.
   */
  function setupJobAndState(promptResponse: {
    stopReason: string;
    stopDetails: LaceStopDetails | null;
  }) {
    const jobId = `job_${randomUUID()}`;
    const outputPath = join(parentSessionDir, 'jobs', `${jobId}.log`);

    let resolveCompletion: () => void = () => undefined;
    const completion = new Promise<void>((r) => {
      resolveCompletion = r;
    });

    const job: JobState = {
      jobId,
      type: 'delegate',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath,
      finished: false,
      completion,
      resolveCompletion,
      subagentContent: [{ type: 'text', text: 'do the thing' }],
    };

    const containerMounts: Readonly<Record<string, MountRegistryEntry>> = {};
    const state = {
      activeSession: {
        meta: { sessionId: parentSessionId, workDir: parentWorkDir },
        dir: parentSessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1, config: {} },
      },
      config: {},
      jobManager: {
        getJob: vi.fn(),
        addJob: vi.fn(),
        getStreamingMode: () => 'full' as const,
      },
      containerManager: null as unknown as ContainerManager,
      containerMounts,
      personaRegistry: {
        getUserPersonasPaths: () => [],
      },
    };

    requestSpy = vi
      .spyOn(JsonRpcPeer.prototype, 'request')
      .mockImplementation(async (method: string) => {
        if (method === 'initialize') return undefined;
        if (method === 'session/new') return { sessionId: 'sess_child' };
        if (method === 'ent/session/configure') return undefined;
        if (method === 'session/set_config_option') return undefined;
        if (method === 'session/prompt') {
          // Resolve exit on the next microtask so the surrounding finally
          // block teardown returns promptly instead of waiting on SIGTERM.
          queueMicrotask(() => fakeHandle.resolveExit());
          return promptResponse;
        }
        throw new Error(`Unexpected childPeer.request method in test: ${method}`);
      });

    return { job, state, outputPath, completion };
  }

  beforeEach(() => {
    sessionRootDir = mkdtempSync(join(tmpdir(), 'stop-details-subagent-'));
    process.env.LACE_SESSION_DIR = sessionRootDir;

    parentSessionId = `sess_${randomUUID()}`;
    parentSessionDir = join(sessionRootDir, parentSessionId);
    parentWorkDir = join(sessionRootDir, 'parent-cwd');
    mkdirSync(parentWorkDir, { recursive: true });

    writeSessionMeta(parentSessionDir, {
      sessionId: parentSessionId,
      workDir: parentWorkDir,
      created: new Date().toISOString(),
    });
    writeSessionState(parentSessionDir, { nextEventSeq: 1, nextStreamSeq: 1 });
    ensureSessionFiles(parentSessionDir);

    fakeHandle = makeFakeSubagent();
    spawnMock.current = () => Promise.resolve(fakeHandle);
  });

  afterEach(() => {
    requestSpy?.mockRestore();
    rmSync(sessionRootDir, { recursive: true, force: true });
    if (previousLaceSessionDir === undefined) {
      delete process.env.LACE_SESSION_DIR;
    } else {
      process.env.LACE_SESSION_DIR = previousLaceSessionDir;
    }
  });

  it('appends a structured refusal block to job output with category and explanation', async () => {
    // The parent must see the model's stated reason. Without this block the
    // parent only sees status='failed' with no signal — it cannot decide
    // whether to rephrase, give up, or surface the refusal to its own caller.
    const { job, state, outputPath, completion } = setupJobAndState({
      stopReason: 'refusal',
      stopDetails: {
        type: 'refusal',
        category: 'hate',
        explanation: 'the request asked for disallowed content',
        source: 'anthropic_classifier',
      },
    });

    const finalizeJob = vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });

    runSubagentJobProcess(job, {
      getState: () => state as never,
      runExclusive: async <T>(work: () => Promise<T> | T) => work(),
      emitSessionUpdate: vi.fn(),
      requestPermissionFromClient: vi.fn(),
      finalizeJob,
      runPromptInternalRef: { current: null },
      topLevelPeer: { notify: vi.fn() } as unknown as JsonRpcPeer,
    });

    await completion;

    // Subagent job status is the mapping under test in helpers — but here we
    // also assert the integrated path: a refusal-shaped response actually
    // marks the parent job 'failed'.
    expect(job.status).toBe('failed');

    expect(existsSync(outputPath)).toBe(true);
    const output = readFileSync(outputPath, 'utf8');
    expect(output).toContain('[SUBAGENT STOP: refusal]');
    expect(output).toContain('Source: anthropic_classifier');
    expect(output).toContain('Category: hate');
    expect(output).toContain('Explanation: the request asked for disallowed content');
  });

  it('appends a structured context_window_exceeded block with the source', async () => {
    // The source field identifies *where* the overflow was detected
    // (preflight estimate vs. the provider's 400 vs. Anthropic beta
    // stop_reason). The parent can use this to decide whether to compact and
    // retry or surface to its own caller.
    const { job, state, outputPath, completion } = setupJobAndState({
      stopReason: 'context_window_exceeded',
      stopDetails: {
        type: 'context_window_exceeded',
        source: 'preflight_token_estimate',
        estimatedExcessTokens: 4321,
      },
    });

    const finalizeJob = vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });

    runSubagentJobProcess(job, {
      getState: () => state as never,
      runExclusive: async <T>(work: () => Promise<T> | T) => work(),
      emitSessionUpdate: vi.fn(),
      requestPermissionFromClient: vi.fn(),
      finalizeJob,
      runPromptInternalRef: { current: null },
      topLevelPeer: { notify: vi.fn() } as unknown as JsonRpcPeer,
    });

    await completion;

    expect(job.status).toBe('failed');

    const output = readFileSync(outputPath, 'utf8');
    expect(output).toContain('[SUBAGENT STOP: context_window_exceeded]');
    expect(output).toContain('Source: preflight_token_estimate');
    expect(output).toContain('Estimated excess tokens: 4321');
  });

  it('does NOT append a stop block when stopDetails is null (clean end_turn)', async () => {
    // For the common-case clean completion the job output should NOT carry a
    // synthetic [SUBAGENT STOP: ...] block — that would be noise on every
    // successful delegate call.
    const { job, state, outputPath, completion } = setupJobAndState({
      stopReason: 'end_turn',
      stopDetails: null,
    });

    const finalizeJob = vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });

    runSubagentJobProcess(job, {
      getState: () => state as never,
      runExclusive: async <T>(work: () => Promise<T> | T) => work(),
      emitSessionUpdate: vi.fn(),
      requestPermissionFromClient: vi.fn(),
      finalizeJob,
      runPromptInternalRef: { current: null },
      topLevelPeer: { notify: vi.fn() } as unknown as JsonRpcPeer,
    });

    await completion;

    expect(job.status).toBe('completed');

    // The job log file may be empty (no subagent stdout was driven through
    // the fake handle), but must not contain a synthetic stop block.
    if (existsSync(outputPath)) {
      const output = readFileSync(outputPath, 'utf8');
      expect(output).not.toContain('[SUBAGENT STOP:');
    }
  });
});
