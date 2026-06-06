// ABOUTME: Ephemeral $TMPDIR for subagents (#5 Part 5)
// ABOUTME: host subagent gets an isolated $TMPDIR removed on exit; /work is NOT removed; container temp is /tmp not /work

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JsonRpcPeer } from '@lace/ent-protocol';
import {
  writeSessionMeta,
  writeSessionState,
  ensureSessionFiles,
} from '@lace/agent/storage/session-store';
import { invalidatePersonaCache } from '@lace/agent/storage/event-log';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import type { JobState } from '@lace/agent/server-types';
import type { SubagentProcessHandle } from '@lace/agent/jobs/subagent-spawn';
import {
  buildPersonaContainerSpec,
  type PersonaContainerRuntime,
} from '@lace/agent/jobs/persona-container-spec';

const spawnMock = vi.hoisted(() => ({
  current: undefined as ((options: unknown) => Promise<SubagentProcessHandle>) | undefined,
}));

vi.mock('@lace/agent/jobs/subagent-spawn', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, spawnSubagent: vi.fn((opts: unknown) => spawnMock.current!(opts)) };
});

import { runSubagentJobProcess } from '@lace/agent/jobs/subagent-job';

interface FakeHandle extends SubagentProcessHandle {
  resolveExit(): void;
}
function makeFakeSubagent(): FakeHandle {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let exitCode: number | null = null;
  const exitListeners: Array<(i: { code: number | null; signal: NodeJS.Signals | null }) => void> =
    [];
  let resolveWait: (i: { exitCode: number | null }) => void = () => undefined;
  const waitPromise = new Promise<{ exitCode: number | null }>((r) => {
    resolveWait = r;
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

describe('subagent $TMPDIR (host)', () => {
  let laceDir: string;
  let sessionRootDir: string;
  let parentSessionId: string;
  let parentSessionDir: string;
  let parentWorkDir: string;
  let fakeHandle: FakeHandle;
  const spawnRequests: Array<{ executionEnv?: Record<string, string> }> = [];
  let tmpdirAtSpawn: string | undefined;
  let existedAtSpawn = false;
  let requestSpy: ReturnType<typeof vi.spyOn>;
  let onRequestSpy: ReturnType<typeof vi.spyOn>;
  const prevSessionDir = process.env.LACE_SESSION_DIR;
  const prevLaceDir = process.env.LACE_DIR;

  beforeEach(() => {
    spawnRequests.length = 0;
    tmpdirAtSpawn = undefined;
    existedAtSpawn = false;
    laceDir = mkdtempSync(join(tmpdir(), 'tmpdir-subagent-'));
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
      const o = opts as { executionEnv?: Record<string, string> };
      spawnRequests.push(o);
      tmpdirAtSpawn = o.executionEnv?.TMPDIR;
      existedAtSpawn = tmpdirAtSpawn ? existsSync(tmpdirAtSpawn) : false;
      return Promise.resolve(fakeHandle);
    };

    onRequestSpy = vi.spyOn(JsonRpcPeer.prototype, 'onRequest').mockImplementation(function (
      this: JsonRpcPeer
    ) {
      return this;
    });
    requestSpy = vi
      .spyOn(JsonRpcPeer.prototype, 'request')
      .mockImplementation(async (method: string) => {
        if (method === 'session/new') return { sessionId: 'sess_child_tmptest' };
        if (method === 'session/prompt') {
          queueMicrotask(() => fakeHandle.resolveExit());
          return { stopReason: 'completed' };
        }
        return undefined;
      });
  });

  afterEach(() => {
    requestSpy.mockRestore();
    onRequestSpy.mockRestore();
    rmSync(laceDir, { recursive: true, force: true });
    if (prevSessionDir === undefined) delete process.env.LACE_SESSION_DIR;
    else process.env.LACE_SESSION_DIR = prevSessionDir;
    if (prevLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = prevLaceDir;
  });

  it('injects an isolated, opaque $TMPDIR and removes it on exit; never removes /work', async () => {
    // A pre-existing "workspace" the subagent's result lives in — must survive.
    const workspace = mkdtempSync(join(tmpdir(), 'lace-ws-'));
    writeFileSync(join(workspace, 'result.txt'), 'deliverable');

    let resolveCompletion: () => void = () => undefined;
    const completion = new Promise<void>((r) => {
      resolveCompletion = r;
    });
    const job: JobState = {
      jobId: 'job_tmptest',
      type: 'delegate',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath: join(parentSessionDir, 'jobs', 'job_tmptest.log'),
      finished: false,
      completion,
      resolveCompletion,
      subagentContent: [{ type: 'text', text: 'noop' }],
      scratchDirHostPath: workspace,
    };

    const state = {
      activeSession: {
        meta: { sessionId: parentSessionId, workDir: parentWorkDir },
        dir: parentSessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1, config: {} },
      },
      config: {},
      jobManager: { getJob: vi.fn(), addJob: vi.fn(), getStreamingMode: () => 'full' as const },
      containerManager: null as unknown as ContainerManager,
      containerMounts: {},
      personaRegistry: { getUserPersonasPaths: () => [], getMcpBaseDir: () => undefined },
    };

    runSubagentJobProcess(job, {
      getState: () => state as never,
      runExclusive: async <T>(work: () => Promise<T> | T) => work(),
      emitSessionUpdate: vi.fn(),
      requestPermissionFromClient: vi.fn(),
      finalizeJob: vi.fn(async (j: JobState) => {
        j.finished = true;
        j.resolveCompletion();
      }),
      runPromptInternalRef: { current: null },
      topLevelPeer: { notify: vi.fn() } as unknown as JsonRpcPeer,
    });

    await completion;
    // Let the finally block (TMPDIR cleanup) run.
    await new Promise((r) => setTimeout(r, 0));

    expect(tmpdirAtSpawn).toBeDefined();
    // Opaque prefix, under the OS temp root, NOT a session id.
    expect(tmpdirAtSpawn!).toContain('lace-tmp-');
    expect(tmpdirAtSpawn!).not.toContain(parentSessionId);
    expect(existedAtSpawn).toBe(true); // existed during the run
    expect(existsSync(tmpdirAtSpawn!)).toBe(false); // removed on exit

    // The workspace (result) is never removed on exit.
    expect(existsSync(join(workspace, 'result.txt'))).toBe(true);
    rmSync(workspace, { recursive: true, force: true });
  });
});

describe('subagent $TMPDIR (container)', () => {
  const perInvocation: PersonaContainerRuntime = {
    type: 'container',
    containerSharing: 'per_invocation',
    image: 'x:latest',
    workingDirectory: '/work',
    mounts: [],
    env: { TMPDIR: '/work/tmp', FOO: 'bar' },
  };

  it('sets the container $TMPDIR to /tmp (not /work), overriding a persona that points it at /work', () => {
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess_pppppppp00000000',
      personaName: 'shell',
      childSessionId: 'sess_cccccccc00000000',
      scratchDirHostPath: '/work/p/c',
      runtime: perInvocation,
      containerMounts: {},
    });
    expect(spec.env?.TMPDIR).toBe('/tmp');
    expect(spec.env?.FOO).toBe('bar'); // other persona env preserved
  });

  it('does not force $TMPDIR on a persistent box (it manages its own /tmp)', () => {
    const persistent: PersonaContainerRuntime = {
      type: 'container',
      containerSharing: 'persistent',
      image: 'box:latest',
      workingDirectory: '/home/agent',
      mounts: [],
      env: { FOO: 'bar' },
    };
    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess_pppppppp00000000',
      personaName: 'box',
      runtime: persistent,
      containerMounts: {},
    });
    expect(spec.env?.TMPDIR).toBeUndefined();
  });
});
