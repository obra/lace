// ABOUTME: Regression test for PRI-1786 Task 5B — when a delegate job carries
// ABOUTME: a projected container runtimeBinding, the subagent must spawn
// ABOUTME: natively, pass the parent host workDir as cwd to
// ABOUTME: session/new, forward config.runtimeBinding, and write a
// ABOUTME: job_session_assigned event into the parent host session event log.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { appendFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { JsonRpcPeer } from '@lace/ent-protocol';
import {
  writeSessionMeta,
  writeSessionState,
  ensureSessionFiles,
} from '@lace/agent/storage/session-store';
import { invalidatePersonaCache, readDurableEvents } from '@lace/agent/storage/event-log';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import type { MountRegistryEntry, JobState } from '@lace/agent/server-types';
import type { SubagentProcessHandle } from '@lace/agent/jobs/subagent-spawn';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';
import { JobManager } from '@lace/agent/jobs/job-manager';

function fingerprintToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

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

function appendTestDurableEvent(
  sessionDir: string,
  event: { type: string; data: Record<string, unknown> },
  eventSeq: number
): void {
  appendFileSync(
    join(sessionDir, 'events.jsonl'),
    `${JSON.stringify({ ...event, eventSeq, timestamp: new Date().toISOString() })}\n`
  );
}

describe('runSubagentJobProcess — host-projected runtimeBinding (PRI-1786)', () => {
  let laceDir: string;
  let sessionRootDir: string;
  let parentSessionId: string;
  let parentSessionDir: string;
  let parentWorkDir: string;
  let fakeHandle: FakeSubagentHandle;
  let requestSpy: ReturnType<typeof vi.spyOn>;
  let onRequestSpy: ReturnType<typeof vi.spyOn>;
  let sessionUpdateHandler: ((params: unknown) => unknown | Promise<unknown>) | undefined;
  const sessionNewRequests: Array<Record<string, unknown>> = [];
  const spawnRequests: unknown[] = [];
  const previousLaceSessionDir = process.env.LACE_SESSION_DIR;
  const previousLaceDir = process.env.LACE_DIR;

  beforeEach(() => {
    sessionNewRequests.length = 0;
    spawnRequests.length = 0;
    sessionUpdateHandler = undefined;
    laceDir = mkdtempSync(join(tmpdir(), 'projected-subagent-'));
    // Keep LACE_SESSION_DIR pointing at the laceDir's agent-sessions root so
    // session-store and the new transcript layout agree on the laceDir base.
    sessionRootDir = join(laceDir, 'agent-sessions');
    mkdirSync(sessionRootDir, { recursive: true });
    process.env.LACE_DIR = laceDir;
    process.env.LACE_SESSION_DIR = sessionRootDir;
    invalidatePersonaCache();

    parentSessionId = `sess_${randomUUID()}`;
    parentSessionDir = join(sessionRootDir, parentSessionId);
    parentWorkDir = join(laceDir, 'parent-cwd');
    mkdirSync(parentWorkDir, { recursive: true });

    writeSessionMeta(parentSessionDir, {
      sessionId: parentSessionId,
      workDir: parentWorkDir,
      created: new Date().toISOString(),
      persona: 'test',
    });
    writeSessionState(parentSessionDir, { nextEventSeq: 1, nextStreamSeq: 1 });
    ensureSessionFiles(parentSessionDir);

    fakeHandle = makeFakeSubagent();
    spawnMock.current = (opts: unknown) => {
      spawnRequests.push(opts);
      return Promise.resolve(fakeHandle);
    };

    // Intercept all childPeer.request(...) calls. The topLevelPeer passed via
    // deps below is a hand-rolled stub (not a JsonRpcPeer) so this spy only
    // catches the childPeer constructed inside runSubagentJobProcess.
    onRequestSpy = vi.spyOn(JsonRpcPeer.prototype, 'onRequest').mockImplementation(function (
      _method: string,
      handler: (params: unknown) => unknown
    ) {
      if (_method === 'session/update') {
        sessionUpdateHandler = handler;
      }
      return this;
    });
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
    onRequestSpy.mockRestore();
    rmSync(laceDir, { recursive: true, force: true });
    if (previousLaceSessionDir === undefined) {
      delete process.env.LACE_SESSION_DIR;
    } else {
      process.env.LACE_SESSION_DIR = previousLaceSessionDir;
    }
    if (previousLaceDir === undefined) {
      delete process.env.LACE_DIR;
    } else {
      process.env.LACE_DIR = previousLaceDir;
    }
  });

  it('passes runtimeBinding through session/new and writes job_session_assigned to the parent host events log', async () => {
    const jobId = 'job_projected_test';
    const outputPath = join(parentSessionDir, 'jobs', `${jobId}.log`);

    const runtimeBinding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_projected_subagent' },
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
        getMcpBaseDir: () => undefined,
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
    const { events } = readDurableEvents(parentSessionDir, {});

    expect(events).toContainEqual(
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

  it('emits container execution metadata for host-placed container persona before prompt delivery', async () => {
    const runtimeBinding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_projected_identity' },
      toolRuntime: {
        type: 'container',
        cwd: '/work',
        spec: {
          name: 'parent-browser-child',
          image: 'node:24-bookworm',
          workingDirectory: '/work',
          mounts: [],
          env: { EXISTING: '1' },
        },
        helper: {
          mode: 'image',
          containerPath: '/usr/local/bin/lace-runtime-helper.js',
          command: ['node', '/usr/local/bin/lace-runtime-helper.js'],
        },
      },
    };

    const emittedUpdates: unknown[] = [];
    const emitSessionUpdate = vi.fn(async (update: unknown) => {
      emittedUpdates.push(update);
    });
    const finalizeJob = vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });
    const state = {
      activeSession: {
        meta: { sessionId: parentSessionId, workDir: parentWorkDir },
        dir: parentSessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1, config: {} },
      },
      config: {},
      jobManager: undefined as unknown as JobManager,
      containerManager: null as unknown as ContainerManager,
      containerMounts: {},
      containerExecutionIdentity: { tokenEnvName: 'SEN_AGENT_TOKEN' },
      personaRegistry: {
        getUserPersonasPaths: () => [],
        getMcpBaseDir: () => undefined,
      },
    };

    const runCreatedSubagent = (createdJob: JobState) => {
      runSubagentJobProcess(createdJob, {
        getState: () => state as never,
        runExclusive: async <T>(work: () => Promise<T> | T) => work(),
        emitSessionUpdate,
        requestPermissionFromClient: vi.fn(),
        finalizeJob,
        runPromptInternalRef: { current: null },
        topLevelPeer: { notify: vi.fn() } as unknown as JsonRpcPeer,
      });
    };

    let nextEventSeq = 1;
    state.jobManager = new JobManager({
      getActiveSession: () => ({ sessionId: parentSessionId, dir: parentSessionDir }),
      persistEvent: async (event) => {
        appendTestDurableEvent(parentSessionDir, event, nextEventSeq++);
      },
      emitUpdate: emitSessionUpdate,
      runShellProcess: vi.fn(),
      runSubagentProcess: runCreatedSubagent,
    });

    const { job } = await state.jobManager.createJob('delegate', {
      prompt: 'noop',
      persona: 'browser-driver',
      runtimeBinding,
      containerSpecName: 'parent-browser-child',
      containerExecutionIdentity: { tokenEnvName: 'SEN_AGENT_TOKEN' },
    });

    await job.completion;

    const initializeRequest = requestSpy.mock.calls.find(
      ([method]) => method === 'initialize'
    )?.[1];
    expect(initializeRequest).toMatchObject({
      containerExecutionIdentity: { tokenEnvName: 'SEN_AGENT_TOKEN' },
    });

    const promptIndex = requestSpy.mock.calls.findIndex(([method]) => method === 'session/prompt');
    const metadataUpdateIndex = emittedUpdates.findIndex(
      (update) =>
        (update as { type?: string; containerExecutionMetadata?: unknown }).type ===
          'job_started' &&
        (update as { containerExecutionMetadata?: unknown }).containerExecutionMetadata
    );
    expect(metadataUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    expect(emitSessionUpdate.mock.invocationCallOrder[metadataUpdateIndex]).toBeLessThan(
      requestSpy.mock.invocationCallOrder[promptIndex]
    );

    const metadata = (
      emittedUpdates[metadataUpdateIndex] as {
        containerExecutionMetadata: Record<string, unknown>;
      }
    ).containerExecutionMetadata;
    expect(metadata).toMatchObject({
      tokenEnvName: 'SEN_AGENT_TOKEN',
      personaName: 'browser-driver',
      parentSessionId,
      jobId: job.jobId,
      runtimeId: 'rt_projected_identity',
      containerSpecName: 'parent-browser-child',
      containerId: 'lace-parent-browser-child',
    });
    expect(metadata).not.toHaveProperty('token');
    expect(typeof metadata.tokenFingerprint).toBe('string');
    expect(metadata.tokenFingerprint).not.toBe('');

    const executionToken = (
      sessionNewRequests[0] as {
        config?: {
          runtimeBinding?: {
            toolRuntime?: {
              spec?: { env?: Record<string, string> };
            };
          };
        };
      }
    ).config?.runtimeBinding?.toolRuntime?.spec?.env?.SEN_AGENT_TOKEN;
    expect(typeof executionToken).toBe('string');
    expect(executionToken).not.toBe('');
    expect(metadata.tokenFingerprint).toBe(fingerprintToken(executionToken));

    expect(sessionNewRequests[0]).toMatchObject({
      config: {
        runtimeBinding: {
          toolRuntime: {
            spec: {
              env: {
                EXISTING: '1',
                SEN_AGENT_TOKEN: executionToken,
              },
            },
          },
        },
      },
    });

    const { events } = readDurableEvents(parentSessionDir, {});
    const startedEvents = events.filter((event) => event.type === 'job_started');
    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0]).toMatchObject({
      data: expect.objectContaining({
        jobId: job.jobId,
        containerExecutionMetadata: metadata,
      }),
    });

    const startedUpdates = emittedUpdates.filter(
      (update) => (update as { type?: string }).type === 'job_started'
    );
    expect(startedUpdates).toHaveLength(1);
    expect(startedUpdates[0]).toMatchObject({
      jobId: job.jobId,
      containerExecutionMetadata: metadata,
    });
    expect(job.executionEnv).toBeUndefined();
    expect(job.runtimeBinding?.toolRuntime.type).toBe('container');
    expect(job.runtimeBinding?.toolRuntime.spec.env).toEqual({ EXISTING: '1' });
  });

  it('does not mint container execution metadata for native persona delegates', async () => {
    const emittedUpdates: unknown[] = [];
    const emitSessionUpdate = vi.fn(async (update: unknown) => {
      emittedUpdates.push(update);
    });
    const finalizeJob = vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });
    const state = {
      activeSession: {
        meta: { sessionId: parentSessionId, workDir: parentWorkDir },
        dir: parentSessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1, config: {} },
      },
      config: {},
      jobManager: undefined as unknown as JobManager,
      containerManager: null as unknown as ContainerManager,
      containerMounts: {},
      containerExecutionIdentity: { tokenEnvName: 'SEN_AGENT_TOKEN' },
      personaRegistry: {
        getUserPersonasPaths: () => [],
        getMcpBaseDir: () => undefined,
      },
    };

    const runCreatedSubagent = (createdJob: JobState) => {
      runSubagentJobProcess(createdJob, {
        getState: () => state as never,
        runExclusive: async <T>(work: () => Promise<T> | T) => work(),
        emitSessionUpdate,
        requestPermissionFromClient: vi.fn(),
        finalizeJob,
        runPromptInternalRef: { current: null },
        topLevelPeer: { notify: vi.fn() } as unknown as JsonRpcPeer,
      });
    };

    let nextEventSeq = 1;
    state.jobManager = new JobManager({
      getActiveSession: () => ({ sessionId: parentSessionId, dir: parentSessionDir }),
      persistEvent: async (event) => {
        appendTestDurableEvent(parentSessionDir, event, nextEventSeq++);
      },
      emitUpdate: emitSessionUpdate,
      runShellProcess: vi.fn(),
      runSubagentProcess: runCreatedSubagent,
    });

    const { job } = await state.jobManager.createJob('delegate', {
      prompt: 'noop',
      persona: 'shell',
      containerExecutionIdentity: { tokenEnvName: 'SEN_AGENT_TOKEN' },
    });

    await job.completion;

    expect(job.executionEnv).toBeUndefined();
    expect(job.containerExecutionMetadata).toBeUndefined();
    expect(spawnRequests[0]).not.toMatchObject({
      executionEnv: expect.anything(),
    });

    const { events } = readDurableEvents(parentSessionDir, {});
    const startedEvents = events.filter((event) => event.type === 'job_started');
    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0]).not.toMatchObject({
      data: { containerExecutionMetadata: expect.anything() },
    });

    const startedUpdates = emittedUpdates.filter(
      (update) => (update as { type?: string }).type === 'job_started'
    );
    expect(startedUpdates).toHaveLength(1);
    expect(startedUpdates[0]).not.toMatchObject({
      containerExecutionMetadata: expect.anything(),
    });
  });

  it('preserves forwarded child job_started metadata with mapped job id', async () => {
    const emittedUpdates: unknown[] = [];
    const emitSessionUpdate = vi.fn(async (update: unknown) => {
      emittedUpdates.push(update);
    });
    const finalizeJob = vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });
    const state = {
      activeSession: {
        meta: { sessionId: parentSessionId, workDir: parentWorkDir },
        dir: parentSessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1, config: {} },
      },
      config: {},
      jobManager: undefined as unknown as JobManager,
      containerManager: null as unknown as ContainerManager,
      containerMounts: {},
      personaRegistry: {
        getUserPersonasPaths: () => [],
        getMcpBaseDir: () => undefined,
      },
    };

    let nextEventSeq = 1;
    state.jobManager = new JobManager({
      getActiveSession: () => ({ sessionId: parentSessionId, dir: parentSessionDir }),
      persistEvent: async (event) => {
        appendTestDurableEvent(parentSessionDir, event, nextEventSeq++);
      },
      emitUpdate: vi.fn(),
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    });

    requestSpy.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'initialize') return undefined;
      if (method === 'session/new') {
        sessionNewRequests.push(params as Record<string, unknown>);
        return { sessionId: 'sess_child_projected' };
      }
      if (method === 'ent/session/configure') return undefined;
      if (method === 'session/set_config_option') return undefined;
      if (method === 'session/prompt') {
        await sessionUpdateHandler?.({
          type: 'job_started',
          jobId: 'job_child_container',
          jobType: 'delegate',
          description: 'nested container job',
          containerExecutionMetadata: {
            tokenEnvName: 'SEN_AGENT_TOKEN',
            tokenFingerprint: fingerprintToken('child-token'),
            personaName: 'browser-driver',
            parentSessionId,
            jobId: 'job_child_container',
            runtimeId: 'rt_child',
            containerSpecName: 'child-container',
          },
        });
        queueMicrotask(() => fakeHandle.resolveExit());
        return { stopReason: 'completed' };
      }
      throw new Error(`Unexpected childPeer.request method in test: ${method}`);
    });

    let resolveCompletion: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const parentJob: JobState = {
      jobId: 'job_parent_delegate',
      type: 'delegate',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath: join(parentSessionDir, 'jobs', 'job_parent_delegate.log'),
      finished: false,
      completion,
      resolveCompletion,
      subagentContent: [{ type: 'text', text: 'noop' }],
    };

    runSubagentJobProcess(parentJob, {
      getState: () => state as never,
      runExclusive: async <T>(work: () => Promise<T> | T) => work(),
      emitSessionUpdate,
      requestPermissionFromClient: vi.fn(),
      finalizeJob,
      runPromptInternalRef: { current: null },
      topLevelPeer: { notify: vi.fn() } as unknown as JsonRpcPeer,
    });

    await completion;

    const mappedJobId = 'job_parent_delegate_job_child_container';
    const expectedMetadata = {
      tokenEnvName: 'SEN_AGENT_TOKEN',
      tokenFingerprint: fingerprintToken('child-token'),
      personaName: 'browser-driver',
      parentSessionId,
      jobId: mappedJobId,
      runtimeId: 'rt_child',
      containerSpecName: 'child-container',
    };

    const { events } = readDurableEvents(parentSessionDir, {});
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'job_started',
        data: expect.objectContaining({
          jobId: mappedJobId,
          parentJobId: parentJob.jobId,
          containerExecutionMetadata: expectedMetadata,
        }),
      })
    );

    expect(emittedUpdates).toContainEqual(
      expect.objectContaining({
        type: 'job_started',
        jobId: mappedJobId,
        parentJobId: parentJob.jobId,
        containerExecutionMetadata: expectedMetadata,
      })
    );

    expect(state.jobManager.getJob(mappedJobId)?.containerExecutionMetadata).toEqual(
      expectedMetadata
    );
  });

  it('ignores raw token in forwarded child job_started metadata', async () => {
    const emittedUpdates: unknown[] = [];
    const emitSessionUpdate = vi.fn(async (update: unknown) => {
      emittedUpdates.push(update);
    });
    const finalizeJob = vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });
    const state = {
      activeSession: {
        meta: { sessionId: parentSessionId, workDir: parentWorkDir },
        dir: parentSessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1, config: {} },
      },
      config: {},
      jobManager: undefined as unknown as JobManager,
      containerManager: null as unknown as ContainerManager,
      containerMounts: {},
      personaRegistry: {
        getUserPersonasPaths: () => [],
        getMcpBaseDir: () => undefined,
      },
    };

    let nextEventSeq = 1;
    state.jobManager = new JobManager({
      getActiveSession: () => ({ sessionId: parentSessionId, dir: parentSessionDir }),
      persistEvent: async (event) => {
        appendTestDurableEvent(parentSessionDir, event, nextEventSeq++);
      },
      emitUpdate: vi.fn(),
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    });

    requestSpy.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'initialize') return undefined;
      if (method === 'session/new') {
        sessionNewRequests.push(params as Record<string, unknown>);
        return { sessionId: 'sess_child_projected' };
      }
      if (method === 'ent/session/configure') return undefined;
      if (method === 'session/set_config_option') return undefined;
      if (method === 'session/prompt') {
        await sessionUpdateHandler?.({
          type: 'job_started',
          jobId: 'job_child_container',
          jobType: 'delegate',
          description: 'nested container job',
          containerExecutionMetadata: {
            tokenEnvName: 'SEN_AGENT_TOKEN',
            token: 'child-token',
            personaName: 'browser-driver',
            parentSessionId,
            jobId: 'job_child_container',
            runtimeId: 'rt_child',
            containerSpecName: 'child-container',
          },
        });
        queueMicrotask(() => fakeHandle.resolveExit());
        return { stopReason: 'completed' };
      }
      throw new Error(`Unexpected childPeer.request method in test: ${method}`);
    });

    let resolveCompletion: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const parentJob: JobState = {
      jobId: 'job_parent_delegate',
      type: 'delegate',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath: join(parentSessionDir, 'jobs', 'job_parent_delegate.log'),
      finished: false,
      completion,
      resolveCompletion,
      subagentContent: [{ type: 'text', text: 'noop' }],
    };

    runSubagentJobProcess(parentJob, {
      getState: () => state as never,
      runExclusive: async <T>(work: () => Promise<T> | T) => work(),
      emitSessionUpdate,
      requestPermissionFromClient: vi.fn(),
      finalizeJob,
      runPromptInternalRef: { current: null },
      topLevelPeer: { notify: vi.fn() } as unknown as JsonRpcPeer,
    });

    await completion;

    const mappedJobId = 'job_parent_delegate_job_child_container';
    const { events } = readDurableEvents(parentSessionDir, {});
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'job_started',
        data: expect.objectContaining({
          jobId: mappedJobId,
          parentJobId: parentJob.jobId,
        }),
      })
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'job_started',
        data: expect.objectContaining({
          jobId: mappedJobId,
          containerExecutionMetadata: expect.anything(),
        }),
      })
    );

    expect(emittedUpdates).toContainEqual(
      expect.objectContaining({
        type: 'job_started',
        jobId: mappedJobId,
        parentJobId: parentJob.jobId,
      })
    );
    expect(emittedUpdates).not.toContainEqual(
      expect.objectContaining({
        type: 'job_started',
        jobId: mappedJobId,
        containerExecutionMetadata: expect.anything(),
      })
    );

    expect(state.jobManager.getJob(mappedJobId)?.containerExecutionMetadata).toBeUndefined();
  });

  it('forwards child container_network_attached/detached updates to the parent (PRI-1919)', async () => {
    const emittedUpdates: unknown[] = [];
    const emitSessionUpdate = vi.fn(async (update: unknown) => {
      emittedUpdates.push(update);
    });
    const finalizeJob = vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });
    const state = {
      activeSession: {
        meta: { sessionId: parentSessionId, workDir: parentWorkDir },
        dir: parentSessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1, config: {} },
      },
      config: {},
      jobManager: undefined as unknown as JobManager,
      containerManager: null as unknown as ContainerManager,
      containerMounts: {},
      personaRegistry: {
        getUserPersonasPaths: () => [],
        getMcpBaseDir: () => undefined,
      },
    };

    let nextEventSeq = 1;
    state.jobManager = new JobManager({
      getActiveSession: () => ({ sessionId: parentSessionId, dir: parentSessionDir }),
      persistEvent: async (event) => {
        appendTestDurableEvent(parentSessionDir, event, nextEventSeq++);
      },
      emitUpdate: vi.fn(),
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    });

    requestSpy.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'initialize') return undefined;
      if (method === 'session/new') {
        sessionNewRequests.push(params as Record<string, unknown>);
        return { sessionId: 'sess_child_projected' };
      }
      if (method === 'ent/session/configure') return undefined;
      if (method === 'session/set_config_option') return undefined;
      if (method === 'session/prompt') {
        // The child materializes its persona container and emits the network
        // lifecycle updates into its own session; the parent relay must forward
        // them up unchanged so the embedder can register the source-IP mapping.
        await sessionUpdateHandler?.({
          type: 'container_network_attached',
          containerName: 'sen-persistent-box',
          containerId: 'sen-persistent-box',
          sourceIp: '172.31.250.3',
          networkName: 'quarantine',
          browserCdpSocketPath: '/sen-browser-cdp/sen-persistent-box.sock',
        });
        await sessionUpdateHandler?.({
          type: 'container_network_detached',
          containerName: 'sen-persistent-box',
          containerId: 'sen-persistent-box',
        });
        queueMicrotask(() => fakeHandle.resolveExit());
        return { stopReason: 'completed' };
      }
      throw new Error(`Unexpected childPeer.request method in test: ${method}`);
    });

    let resolveCompletion: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const parentJob: JobState = {
      jobId: 'job_parent_delegate',
      type: 'delegate',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath: join(parentSessionDir, 'jobs', 'job_parent_delegate.log'),
      finished: false,
      completion,
      resolveCompletion,
      subagentContent: [{ type: 'text', text: 'noop' }],
    };

    runSubagentJobProcess(parentJob, {
      getState: () => state as never,
      runExclusive: async <T>(work: () => Promise<T> | T) => work(),
      emitSessionUpdate,
      requestPermissionFromClient: vi.fn(),
      finalizeJob,
      runPromptInternalRef: { current: null },
      topLevelPeer: { notify: vi.fn() } as unknown as JsonRpcPeer,
    });

    await completion;

    expect(emittedUpdates).toContainEqual(
      expect.objectContaining({
        type: 'container_network_attached',
        containerName: 'sen-persistent-box',
        containerId: 'sen-persistent-box',
        sourceIp: '172.31.250.3',
        networkName: 'quarantine',
        browserCdpSocketPath: '/sen-browser-cdp/sen-persistent-box.sock',
      })
    );
    expect(emittedUpdates).toContainEqual(
      expect.objectContaining({
        type: 'container_network_detached',
        containerName: 'sen-persistent-box',
        containerId: 'sen-persistent-box',
      })
    );
  });
});
