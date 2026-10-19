// ABOUTME: Verifies returned child turns join to the invoking parent and job.
// ABOUTME: Uses real job state/files with a fake child RPC transport.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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
import { logger } from '@lace/agent/utils/logger';

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

describe('runSubagentJobProcess — correlates returned child turns', () => {
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
  function setupJobAndState(promptResponse: { stopReason: string; turnId?: unknown }) {
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
        getMcpBaseDir: () => undefined,
      },
      environmentRegistry: { getEnvironmentsPaths: () => [] },
    };

    requestSpy = vi
      .spyOn(JsonRpcPeer.prototype, 'request')
      .mockImplementation(async (method: string) => {
        if (method === 'initialize') return undefined;
        if (method === 'session/resume') return undefined;
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
    sessionRootDir = mkdtempSync(join(tmpdir(), 'subagent-correlation-'));
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
    vi.restoreAllMocks();
    rmSync(sessionRootDir, { recursive: true, force: true });
    if (previousLaceSessionDir === undefined) {
      delete process.env.LACE_SESSION_DIR;
    } else {
      process.env.LACE_SESSION_DIR = previousLaceSessionDir;
    }
  });

  async function run(turnId: unknown, resume = false, changeParent = false, throwLog = false) {
    fakeHandle = makeFakeSubagent();
    const { job, state, completion } = setupJobAndState({ stopReason: 'end_turn', turnId });
    job.originTurnId = 'turn_parent';
    if (resume) job.subagentSessionId = 'sess_child';
    const original = logger.info.bind(logger);
    const info = vi.spyOn(logger, 'info').mockImplementation((name, data) => {
      if (throwLog && name === 'job.subagent.turn') throw new Error('diagnostic failure');
      original(name, data);
    });
    if (changeParent) {
      const request = requestSpy.getMockImplementation()!;
      requestSpy.mockImplementation(async function (method: string, ...args: unknown[]) {
        if (method === 'session/prompt') {
          state.activeSession.meta.sessionId = 'sess_changed_after_dispatch';
          job.originTurnId = 'turn_changed_after_dispatch';
        }
        return request(method, ...args);
      });
    }
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
    expect(job.subagentSessionId).toBe('sess_child');
    expect(finalizeJob).toHaveBeenCalledOnce();
    expect(requestSpy.mock.calls.filter(([method]) => method === 'session/prompt')).toHaveLength(1);
    const events = info.mock.calls
      .filter(([name]) => name === 'job.subagent.turn')
      .map(([, data]) => data);
    info.mockRestore();
    requestSpy.mockRestore();
    return { job, events };
  }
  it('links a fresh child to invocation identity even if the parent changes while awaiting the child', async () => {
    const { job, events } = await run('turn_child', false, true);
    expect(events).toEqual([
      {
        parentSessionId,
        parentTurnId: 'turn_parent',
        jobId: job.jobId,
        childSessionId: 'sess_child',
        childTurnId: 'turn_child',
      },
    ]);
  });
  it('distinguishes repeated resumes of the same child session', async () => {
    const a = await run('turn_resume_one', true);
    const b = await run('turn_resume_two', true);
    expect(a.job.jobId).not.toBe(b.job.jobId);
    expect(a.events).toEqual([
      {
        parentSessionId,
        parentTurnId: 'turn_parent',
        jobId: a.job.jobId,
        childSessionId: 'sess_child',
        childTurnId: 'turn_resume_one',
      },
    ]);
    expect(b.events).toEqual([
      {
        parentSessionId,
        parentTurnId: 'turn_parent',
        jobId: b.job.jobId,
        childSessionId: 'sess_child',
        childTurnId: 'turn_resume_two',
      },
    ]);
  });
  it.each([undefined, null, 42, {}, '', 'bad id', 'bad\nvalue', 'x'.repeat(129)])(
    'omits malformed child turn %j',
    async (turnId) => {
      expect((await run(turnId)).events).toEqual([]);
    }
  );
  it('preserves job completion when the diagnostic sink throws', async () => {
    await expect(run('turn_child', false, false, true)).resolves.toMatchObject({
      job: { status: 'completed' },
    });
  });
});
