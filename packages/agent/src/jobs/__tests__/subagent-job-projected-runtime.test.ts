// ABOUTME: Regression test for PRI-1786 Task 5B — when a delegate job carries
// ABOUTME: a host-projected runtimeBinding (no personaContainerRuntime), the
// ABOUTME: subagent must spawn natively, pass the parent host workDir as cwd to
// ABOUTME: session/new, forward config.runtimeBinding, and write a
// ABOUTME: job_session_assigned event into the parent host session event log.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

// Mock spawnSubagent so we don't exec a real child process — return a fake
// handle whose stdout/stdin are PassThroughs we don't actually drive. The
// JSON-RPC layer above is intercepted via vi.spyOn on JsonRpcPeer.prototype.
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

// Imported after vi.mock so the mock applies.
import { runSubagentJobProcess } from '@lace/agent/jobs/subagent-job';

interface FakeSubagentHandle extends SubagentProcessHandle {
  /** Signal graceful exit so the finally block in runSubagentJobProcess unblocks. */
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
    kill() {
      // no-op — the test resolves exit explicitly via resolveExit().
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

describe('runSubagentJobProcess — host-projected runtimeBinding (PRI-1786)', () => {
  let sessionRootDir: string;
  let parentSessionId: string;
  let parentSessionDir: string;
  let parentWorkDir: string;
  let fakeHandle: FakeSubagentHandle;
  let requestSpy: ReturnType<typeof vi.spyOn>;
  const sessionNewRequests: Array<Record<string, unknown>> = [];
  const previousLaceSessionDir = process.env.LACE_SESSION_DIR;

  beforeEach(() => {
    sessionNewRequests.length = 0;
    sessionRootDir = mkdtempSync(join(tmpdir(), 'projected-subagent-'));
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

    // Intercept all childPeer.request(...) calls. The topLevelPeer passed via
    // deps below is a hand-rolled stub (not a JsonRpcPeer) so this spy only
    // catches the childPeer constructed inside runSubagentJobProcess.
    requestSpy = vi
      .spyOn(JsonRpcPeer.prototype, 'request')
      .mockImplementation(async (method: string, params?: unknown) => {
        if (method === 'initialize') return undefined;
        if (method === 'session/new') {
          sessionNewRequests.push(params as Record<string, unknown>);
          return { sessionId: 'sess_child_projected' };
        }
        if (method === 'session/resume') {
          return undefined;
        }
        if (method === 'ent/session/configure') return undefined;
        if (method === 'session/set_config_option') return undefined;
        if (method === 'session/prompt') {
          // After prompt resolves, runSubagentJobProcess proceeds to the
          // finally block. Signal graceful exit so SIGTERM teardown returns
          // immediately instead of waiting 3s.
          queueMicrotask(() => fakeHandle.resolveExit());
          return { stopReason: 'completed' };
        }
        throw new Error(`Unexpected childPeer.request method in test: ${method}`);
      });
  });

  afterEach(() => {
    requestSpy.mockRestore();
    rmSync(sessionRootDir, { recursive: true, force: true });
    if (previousLaceSessionDir === undefined) {
      delete process.env.LACE_SESSION_DIR;
    } else {
      process.env.LACE_SESSION_DIR = previousLaceSessionDir;
    }
  });

  it('passes runtimeBinding through session/new and writes job_session_assigned to the parent host events log', async () => {
    const jobId = 'job_projected_test';
    const outputPath = join(parentSessionDir, 'jobs', `${jobId}.log`);

    const runtimeBinding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_projected_subagent' },
      agentPlacement: 'host',
      toolRuntime: {
        type: 'container',
        cwd: '/work',
        spec: {
          name: 'sess_parent-shell',
          image: 'node:24-bookworm',
          workingDirectory: '/work',
          mounts: [],
        },
        helper: {
          mode: 'image',
          containerPath: '/usr/local/bin/lace-runtime-helper.js',
          command: ['node', '/usr/local/bin/lace-runtime-helper.js'],
        },
      },
    };

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
      persona: 'shell',
      subagentContent: [{ type: 'text', text: 'noop' }],
      runtimeBinding,
      // personaContainerRuntime intentionally left undefined — this is the
      // host-placed projected case under test.
    };

    const finalizeJob = vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });

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

    // Stand in for the top-level peer. subagent-job only ever invokes
    // .notify on it, and only in the pending_alarms_on_exit branch (not
    // exercised by this test).
    const topLevelPeer = {
      notify: vi.fn(),
    } as unknown as JsonRpcPeer;

    runSubagentJobProcess(job, {
      getState: () => state as never,
      runExclusive: async <T>(work: () => Promise<T> | T) => work(),
      emitSessionUpdate: vi.fn(),
      requestPermissionFromClient: vi.fn(),
      finalizeJob,
      runPromptInternalRef: { current: null },
      topLevelPeer,
    });

    await completion;

    // session/new must have been called once with the parent host workdir and
    // the projected runtime binding flowed through config.runtimeBinding.
    expect(sessionNewRequests.length).toBeGreaterThanOrEqual(1);
    const sessionNewRequest = sessionNewRequests[0];
    expect(sessionNewRequest).toMatchObject({
      cwd: parentWorkDir,
      config: { runtimeBinding },
    });

    // The subagent session id must be persisted to the parent host events log
    // via the existing runExclusive() path.
    const eventLines = readFileSync(join(parentSessionDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(eventLines).toContainEqual(
      expect.objectContaining({
        type: 'job_session_assigned',
        data: expect.objectContaining({
          jobId,
          subagentSessionId: 'sess_child_projected',
        }),
      })
    );

    // Sanity: finalizeJob was invoked exactly once and the job completed.
    expect(finalizeJob).toHaveBeenCalledOnce();
    expect(job.status).toBe('completed');
  });
});
