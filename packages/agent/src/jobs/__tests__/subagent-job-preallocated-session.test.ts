// ABOUTME: Tests for preallocated subagent sessionId plumbing through subagent-job (PRI-1796 Chunk D.2)
// When job.subagentSessionPreallocated is true, session/new must receive the preallocated
// sessionId. When resumeSessionId is used, session/resume must be called instead.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
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
import type { PersonaContainerRuntime } from '@lace/agent/jobs/persona-container-spec';

// Mock spawnSubagent so we don't exec a real child process
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

function makeSubagentJobDeps(overrides: {
  state: unknown;
  finalizeJob?: ReturnType<typeof vi.fn>;
}) {
  const finalizeJob =
    overrides.finalizeJob ??
    vi.fn(async (j: JobState) => {
      j.finished = true;
      j.resolveCompletion();
    });

  const containerMounts: Readonly<Record<string, MountRegistryEntry>> = {};
  const topLevelPeer = { notify: vi.fn() } as unknown as JsonRpcPeer;

  return {
    getState: () => overrides.state as never,
    runExclusive: async <T>(work: () => Promise<T> | T) => work(),
    emitSessionUpdate: vi.fn(),
    requestPermissionFromClient: vi.fn(),
    finalizeJob,
    runPromptInternalRef: { current: null },
    topLevelPeer,
    containerMounts,
  };
}

describe('runSubagentJobProcess — preallocated sessionId (PRI-1796)', () => {
  let sessionRootDir: string;
  let parentSessionId: string;
  let parentSessionDir: string;
  let parentWorkDir: string;
  let fakeHandle: FakeSubagentHandle;
  let requestSpy: ReturnType<typeof vi.spyOn>;
  const spawnOptions: unknown[] = [];
  const initializeRequests: Array<Record<string, unknown>> = [];
  const sessionNewRequests: Array<Record<string, unknown>> = [];
  const sessionResumeRequests: Array<Record<string, unknown>> = [];
  const previousLaceSessionDir = process.env.LACE_SESSION_DIR;

  beforeEach(() => {
    spawnOptions.length = 0;
    initializeRequests.length = 0;
    sessionNewRequests.length = 0;
    sessionResumeRequests.length = 0;
    sessionRootDir = mkdtempSync(join(tmpdir(), 'preallocated-subagent-'));
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
    spawnMock.current = (options: unknown) => {
      spawnOptions.push(options);
      return Promise.resolve(fakeHandle);
    };

    requestSpy = vi
      .spyOn(JsonRpcPeer.prototype, 'request')
      .mockImplementation(async (method: string, params?: unknown) => {
        if (method === 'initialize') {
          initializeRequests.push(params as Record<string, unknown>);
          return undefined;
        }
        if (method === 'session/new') {
          sessionNewRequests.push(params as Record<string, unknown>);
          // Return the sessionId passed in, or a default
          const p = params as Record<string, unknown> | undefined;
          return { sessionId: p?.sessionId ?? 'sess_child_default' };
        }
        if (method === 'session/resume') {
          sessionResumeRequests.push(params as Record<string, unknown>);
          return undefined;
        }
        if (method === 'ent/session/configure') return undefined;
        if (method === 'session/set_config_option') return undefined;
        if (method === 'session/prompt') {
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

  it('sends preallocated sessionId in session/new when subagentSessionPreallocated is true', async () => {
    const preallocatedId = `sess_${randomUUID()}`;
    const jobId = 'job_preallocated_test';
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
      subagentContent: [{ type: 'text', text: 'noop' }],
      subagentSessionId: preallocatedId,
      subagentSessionPreallocated: true,
    };

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
      containerMounts: {} as Readonly<Record<string, MountRegistryEntry>>,
      personaRegistry: { getUserPersonasPaths: () => [] },
    };

    runSubagentJobProcess(job, makeSubagentJobDeps({ state }));

    await completion;

    // session/new must have been called with the preallocated id
    expect(sessionNewRequests).toHaveLength(1);
    expect(sessionNewRequests[0].sessionId).toBe(preallocatedId);
    // session/resume must NOT have been called
    expect(sessionResumeRequests).toHaveLength(0);
    // The job's subagentSessionId must still equal the preallocated id
    expect(job.subagentSessionId).toBe(preallocatedId);
  });

  it('passes parent skillDirs through child initialize', async () => {
    const jobId = 'job_skill_dirs_test';
    const outputPath = join(parentSessionDir, 'jobs', `${jobId}.log`);
    const skillDirs = ['/host/sen-core/skills/innate', '/host/instance/user/skills/learned'];

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
      subagentContent: [{ type: 'text', text: 'noop' }],
    };

    const state = {
      initialized: true,
      activeSession: {
        meta: { sessionId: parentSessionId, workDir: parentWorkDir },
        dir: parentSessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1, config: {} },
      },
      config: {},
      skillDirs,
      jobManager: {
        getJob: vi.fn(),
        addJob: vi.fn(),
        getStreamingMode: () => 'full' as const,
      },
      containerManager: null as unknown as ContainerManager,
      containerMounts: {} as Readonly<Record<string, MountRegistryEntry>>,
      personaRegistry: { getUserPersonasPaths: () => [] },
    };

    runSubagentJobProcess(job, makeSubagentJobDeps({ state }));

    await completion;

    expect(initializeRequests).toHaveLength(1);
    expect(initializeRequests[0]).toMatchObject({ skillDirs });
  });

  it('remaps parent skillDirs for containerized child initialize', async () => {
    const jobId = 'job_container_skill_dirs_test';
    const outputPath = join(parentSessionDir, 'jobs', `${jobId}.log`);
    const skillDirs = [
      join(sessionRootDir, 'sen-core', 'skills', 'innate'),
      join(sessionRootDir, 'instance', 'user', 'skills', 'learned'),
    ];
    for (const dir of skillDirs) {
      mkdirSync(dir, { recursive: true });
    }
    const personaContainerRuntime: PersonaContainerRuntime = {
      type: 'container',
      image: 'node:24-bookworm',
      workingDirectory: '/work',
      mounts: {},
      containerSharing: 'persistent',
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
      subagentContent: [{ type: 'text', text: 'noop' }],
      persona: 'shell',
      personaContainerRuntime,
    };

    const state = {
      initialized: true,
      activeSession: {
        meta: { sessionId: parentSessionId, workDir: parentWorkDir },
        dir: parentSessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1, config: {} },
      },
      config: {},
      skillDirs,
      jobManager: {
        getJob: vi.fn(),
        addJob: vi.fn(),
        getStreamingMode: () => 'full' as const,
      },
      containerManager: {} as ContainerManager,
      containerMounts: {} as Readonly<Record<string, MountRegistryEntry>>,
      personaRegistry: { getUserPersonasPaths: () => [] },
    };

    runSubagentJobProcess(job, makeSubagentJobDeps({ state }));

    await completion;

    expect(spawnOptions[0]).toMatchObject({ skillDirs });
    expect(initializeRequests).toHaveLength(1);
    expect(initializeRequests[0]).toMatchObject({
      skillDirs: ['/var/lace/skills/0', '/var/lace/skills/1'],
    });
  });

  it('preserves explicit container skillDirs even when the host path does not exist yet', async () => {
    const jobId = 'job_container_explicit_missing_skill_dirs_test';
    const outputPath = join(parentSessionDir, 'jobs', `${jobId}.log`);
    const skillDirs = [join(sessionRootDir, 'configured-later', 'skills')];
    const personaContainerRuntime: PersonaContainerRuntime = {
      type: 'container',
      image: 'node:24-bookworm',
      workingDirectory: '/work',
      mounts: {},
      containerSharing: 'persistent',
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
      subagentContent: [{ type: 'text', text: 'noop' }],
      persona: 'shell',
      personaContainerRuntime,
    };

    const state = {
      initialized: true,
      activeSession: {
        meta: { sessionId: parentSessionId, workDir: parentWorkDir },
        dir: parentSessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1, config: {} },
      },
      config: {},
      skillDirs,
      jobManager: {
        getJob: vi.fn(),
        addJob: vi.fn(),
        getStreamingMode: () => 'full' as const,
      },
      containerManager: {} as ContainerManager,
      containerMounts: {} as Readonly<Record<string, MountRegistryEntry>>,
      personaRegistry: { getUserPersonasPaths: () => [] },
    };

    runSubagentJobProcess(job, makeSubagentJobDeps({ state }));

    await completion;

    expect(existsSync(skillDirs[0])).toBe(false);
    expect(spawnOptions[0]).toMatchObject({ skillDirs });
    expect(initializeRequests[0]).toMatchObject({
      skillDirs: ['/var/lace/skills/0'],
    });
  });

  it('uses existing default parent skillDirs for containerized child initialize', async () => {
    const jobId = 'job_container_default_skill_dirs_test';
    const outputPath = join(parentSessionDir, 'jobs', `${jobId}.log`);
    const defaultSkillDirs = [
      join(parentWorkDir, '.lace', 'skills') + '/',
      join(parentWorkDir, '.claude', 'skills') + '/',
      join(homedir(), '.lace', 'skills') + '/',
      join(homedir(), '.claude', 'skills') + '/',
    ];
    const mountedSkillDirs = defaultSkillDirs.filter((dir) => existsSync(dir));
    const personaContainerRuntime: PersonaContainerRuntime = {
      type: 'container',
      image: 'node:24-bookworm',
      workingDirectory: '/work',
      mounts: {},
      containerSharing: 'persistent',
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
      subagentContent: [{ type: 'text', text: 'noop' }],
      persona: 'shell',
      personaContainerRuntime,
    };

    const state = {
      initialized: true,
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
      containerManager: {} as ContainerManager,
      containerMounts: {} as Readonly<Record<string, MountRegistryEntry>>,
      personaRegistry: { getUserPersonasPaths: () => [] },
    };

    runSubagentJobProcess(job, makeSubagentJobDeps({ state }));

    await completion;

    expect(spawnOptions[0]).toMatchObject({ skillDirs: mountedSkillDirs });
    expect(initializeRequests).toHaveLength(1);
    expect(initializeRequests[0]).toMatchObject({
      skillDirs: mountedSkillDirs.map((_, index) => `/var/lace/skills/${index}`),
    });
  });

  it('uses the same container skillDirs for spawn and initialize when defaults change during spawn', async () => {
    const jobId = 'job_container_stable_skill_dirs_test';
    const outputPath = join(parentSessionDir, 'jobs', `${jobId}.log`);
    const projectLaceSkills = join(parentWorkDir, '.lace', 'skills');
    const defaultSkillDirsAtSpawn = [
      projectLaceSkills + '/',
      join(parentWorkDir, '.claude', 'skills') + '/',
      join(homedir(), '.lace', 'skills') + '/',
      join(homedir(), '.claude', 'skills') + '/',
    ].filter((dir) => existsSync(dir));
    const personaContainerRuntime: PersonaContainerRuntime = {
      type: 'container',
      image: 'node:24-bookworm',
      workingDirectory: '/work',
      mounts: {},
      containerSharing: 'persistent',
    };

    spawnMock.current = (options: unknown) => {
      spawnOptions.push(options);
      mkdirSync(projectLaceSkills, { recursive: true });
      return Promise.resolve(fakeHandle);
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
      subagentContent: [{ type: 'text', text: 'noop' }],
      persona: 'shell',
      personaContainerRuntime,
    };

    const state = {
      initialized: true,
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
      containerManager: {} as ContainerManager,
      containerMounts: {} as Readonly<Record<string, MountRegistryEntry>>,
      personaRegistry: { getUserPersonasPaths: () => [] },
    };

    runSubagentJobProcess(job, makeSubagentJobDeps({ state }));

    await completion;

    expect(spawnOptions[0]).toMatchObject({ skillDirs: defaultSkillDirsAtSpawn });
    expect(initializeRequests[0]).toMatchObject({
      skillDirs: defaultSkillDirsAtSpawn.map((_, index) => `/var/lace/skills/${index}`),
    });
  });

  it('calls session/resume (not session/new) when subagentSessionPreallocated is absent', async () => {
    const existingSessionId = `sess_${randomUUID()}`;
    const jobId = 'job_resume_test';
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
      subagentContent: [{ type: 'text', text: 'noop' }],
      subagentSessionId: existingSessionId,
      // subagentSessionPreallocated intentionally absent → resume path
    };

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
      containerMounts: {} as Readonly<Record<string, MountRegistryEntry>>,
      personaRegistry: { getUserPersonasPaths: () => [] },
    };

    runSubagentJobProcess(job, makeSubagentJobDeps({ state }));

    await completion;

    // session/resume must have been called with the existing session id
    expect(sessionResumeRequests).toHaveLength(1);
    expect(sessionResumeRequests[0].sessionId).toBe(existingSessionId);
    // session/new must NOT have been called
    expect(sessionNewRequests).toHaveLength(0);
  });
});
