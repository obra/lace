// ABOUTME: Integration test — runSubagentJobProcess must
// ABOUTME: react to subagent child crash by transitioning the owning job to a
// ABOUTME: terminal state (failed) and invoking finalizeJob exactly once so
// ABOUTME: job_notify subscribers wake and jobs_list reflects the death.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonRpcPeer } from '@lace/ent-protocol';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import type { MountRegistryEntry, JobState } from '@lace/agent/server-types';
import type { SubagentProcessHandle } from '@lace/agent/jobs/subagent-spawn';

// Mock the spawn so we don't actually exec a process — we return a controllable
// fake handle that we can drive into the "child crashed" branch.
const spawnMock = vi.hoisted(() => ({
  // Filled in per-test via beforeEach
  current: undefined as ((options: unknown) => Promise<SubagentProcessHandle>) | undefined,
}));

vi.mock('@lace/agent/jobs/subagent-spawn', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    spawnSubagent: vi.fn((opts: unknown) => spawnMock.current!(opts)),
  };
});

// Imported AFTER vi.mock so the mock takes effect.
import { runSubagentJobProcess } from '@lace/agent/jobs/subagent-job';

interface FakeSubagentHandle extends SubagentProcessHandle {
  /** Trigger an unexpected child crash from the test. */
  simulateCrash(stderr: string, exitCode?: number): void;
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
    kill() {
      // no-op for the test
    },
    onExit(cb) {
      exitListeners.push(cb);
    },
    onSpawnError() {
      // no-op
    },
    wait() {
      return waitPromise;
    },
    nativeProcess: null,
    simulateCrash(stderrText: string, code = 1) {
      stderr.write(stderrText);
      stderr.end();
      stdout.end();
      exitCode = code;
      resolveWait({ exitCode: code });
      for (const cb of exitListeners) cb({ code, signal: null });
    },
  };
}

describe('runSubagentJobProcess — child_exit propagation', () => {
  let sessionDir: string;
  let fakeHandle: FakeSubagentHandle;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'subagent-exit-job-'));
    fakeHandle = makeFakeSubagent();
    spawnMock.current = () => Promise.resolve(fakeHandle);
  });

  it('transitions the job to failed and persists stderr when the child crashes mid-initialize', async () => {
    const jobId = 'job_test_crash';
    const outputPath = join(sessionDir, 'jobs', `${jobId}.log`);

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
      persona: 'box-shell',
      subagentContent: [{ type: 'text', text: 'echo hello' }],
    };

    const finalizeJob = vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });

    const containerMounts: Readonly<Record<string, MountRegistryEntry>> = {};
    const state = {
      activeSession: {
        meta: { sessionId: 'sess_test', workDir: '/home/agent' },
        dir: sessionDir,
        state: { config: {} },
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

    runSubagentJobProcess(job, {
      getState: () => state as never,
      runExclusive: async <T>(work: () => Promise<T> | T) => work(),
      emitSessionUpdate: vi.fn(),
      requestPermissionFromClient: vi.fn(),
      finalizeJob,
      runPromptInternalRef: { current: null },
      topLevelPeer: new JsonRpcPeer(
        { send: () => undefined, onMessage: () => () => undefined, close: () => undefined },
        { idPrefix: 'a_' }
      ),
    });

    // Give the async setup a tick to reach the await childPeer.request('initialize', ...).
    await new Promise((r) => setTimeout(r, 30));

    // Simulate the child writing stderr and dying before responding to initialize.
    const crashStderr = "Error: Cannot find module '/lace/packages/agent/dist/main.js'\n";
    fakeHandle.simulateCrash(crashStderr, 1);

    // Wait for finalize to land.
    await completion;

    expect(finalizeJob).toHaveBeenCalledOnce();
    const finalizedJob = finalizeJob.mock.calls[0][0] as JobState;
    expect(finalizedJob.status).toBe('failed');

    expect(existsSync(outputPath)).toBe(true);
    const log = readFileSync(outputPath, 'utf8');
    expect(log).toContain('[SUBAGENT CHILD EXITED]');
    expect(log).toContain('exitCode: 1');
    expect(log).toContain("Cannot find module '/lace/packages/agent/dist/main.js'");

    rmSync(sessionDir, { recursive: true, force: true });
  });
});
