// ABOUTME: Tests for shell job state access pattern

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRunShellJobProcess } from '../shell-job';
import type { JobState } from '../../server-types';
import type { LoadedSession } from '../../storage/session-store';

// Use vi.hoisted to ensure mock objects are available when vi.mock factories run
const { mockProc, mockSpawn } = vi.hoisted(() => {
  // Create a simple event emitter-like object
  type Listener = (...args: unknown[]) => void;
  const createEmitter = () => {
    const listeners: Map<string, Listener[]> = new Map();
    return {
      on: vi.fn((event: string, fn: Listener) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(fn);
      }),
      emit: (event: string, ...args: unknown[]) => {
        const fns = listeners.get(event) || [];
        fns.forEach((fn) => fn(...args));
      },
      removeAllListeners: () => listeners.clear(),
      setEncoding: vi.fn(),
    };
  };

  const mockStdout = createEmitter();
  const mockStderr = createEmitter();
  const mockProc = {
    ...createEmitter(),
    stdout: mockStdout,
    stderr: mockStderr,
    pid: 12345,
    kill: vi.fn(),
  };
  const mockSpawn = vi.fn().mockReturnValue(mockProc);
  return { mockProc, mockSpawn };
});

// Mock session-store to avoid file system dependencies
vi.mock('../../storage/session-store', () => ({
  readSessionState: vi.fn().mockReturnValue({ config: null }),
}));

// Mock child_process to avoid actual spawning
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: mockSpawn,
}));

// Mock fs functions
vi.mock('node:fs', () => ({
  appendFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  statSync: vi.fn().mockReturnValue({ size: 0 }),
}));

describe('createRunShellJobProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProc.removeAllListeners();
    mockProc.stdout.removeAllListeners();
    mockProc.stderr.removeAllListeners();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should use current activeSession state, not captured value', async () => {
    // Simulate the pattern where activeSession starts null
    // and is later populated (this mirrors server.ts behavior)
    const mutableState = {
      activeSession: null as LoadedSession | null,
      config: { approvalMode: 'dangerouslySkipPermissions' as const },
      jobStreaming: 'none' as const,
    };

    const mockEmitSessionUpdate = vi.fn().mockResolvedValue(undefined);
    const mockFinalizeJob = vi.fn().mockResolvedValue(undefined);
    const mockRequestPermission = vi.fn().mockResolvedValue({ decision: 'allow' });
    const mockRunExclusive = vi.fn().mockImplementation(<T>(fn: () => T) => fn());

    // Create the runner with null activeSession (like server.ts does at startup)
    // The key fix: use getState() function that returns current state,
    // not a snapshot captured at creation time
    const runShellJobProcess = createRunShellJobProcess({
      getState: () => mutableState,
      runExclusive: mockRunExclusive,
      emitSessionUpdate: mockEmitSessionUpdate,
      requestPermissionFromClient: mockRequestPermission,
      finalizeJob: mockFinalizeJob,
    });

    // Simulate session being loaded AFTER runner creation
    // This is exactly what happens in server.ts when session/load is called
    mutableState.activeSession = {
      dir: '/tmp/test-session',
      meta: {
        sessionId: 'test-session',
        workDir: '/tmp',
        projectId: 'test-project',
        rootDir: '/tmp',
        personaId: 'default',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as LoadedSession;

    const job: JobState = {
      jobId: 'job_test',
      type: 'bash',
      status: 'running',
      command: 'echo hello',
      startedAt: new Date().toISOString(),
      outputPath: '/tmp/test-output',
      finished: false,
      completion: Promise.resolve(),
      resolveCompletion: vi.fn(),
      runtimeBinding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_test' },
        toolRuntime: { type: 'boundedHost', root: '/tmp', cwd: '/tmp' },
      },
    };

    // Run the job - if the bug exists, this will silently return
    // because activeSession was null at creation time
    runShellJobProcess(job);

    // Wait a tick for async execution to start
    await new Promise((r) => setTimeout(r, 50));

    // Simulate process completion
    mockProc.emit('close', 0);

    // Wait for async handlers
    await new Promise((r) => setTimeout(r, 50));

    // If the bug exists (state captured at creation), the job was silently
    // skipped and spawn was never called. The fix is to use getState()
    // to get current state each time the job runs.
    expect(mockSpawn).toHaveBeenCalledWith('/bin/bash', ['-c', 'echo hello'], {
      cwd: '/tmp',
      env: expect.any(Object),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      signal: undefined,
    });

    // And finalizeJob should have been called when process completed
    expect(mockFinalizeJob).toHaveBeenCalled();
  });

  it('starts legacy jobs without runtimeBinding in the active session workDir', async () => {
    const mutableState = {
      activeSession: {
        dir: '/tmp/test-session',
        meta: {
          sessionId: 'sess_legacy',
          workDir: '/tmp',
          projectId: 'test-project',
          rootDir: '/tmp',
          personaId: 'default',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      } as LoadedSession,
      config: { approvalMode: 'dangerouslySkipPermissions' as const },
      jobStreaming: 'none' as const,
    };

    const mockEmitSessionUpdate = vi.fn().mockResolvedValue(undefined);
    const mockFinalizeJob = vi.fn().mockResolvedValue(undefined);
    const mockRequestPermission = vi.fn().mockResolvedValue({ decision: 'allow' });
    const mockRunExclusive = vi.fn().mockImplementation(<T>(fn: () => T) => fn());

    const runShellJobProcess = createRunShellJobProcess({
      getState: () => mutableState,
      runExclusive: mockRunExclusive,
      emitSessionUpdate: mockEmitSessionUpdate,
      requestPermissionFromClient: mockRequestPermission,
      finalizeJob: mockFinalizeJob,
    });

    const job: JobState = {
      jobId: 'job_legacy',
      type: 'bash',
      status: 'running',
      command: 'pwd',
      startedAt: new Date().toISOString(),
      outputPath: '/tmp/test-output',
      finished: false,
      completion: Promise.resolve(),
      resolveCompletion: vi.fn(),
    };

    runShellJobProcess(job);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSpawn).toHaveBeenCalledWith('/bin/bash', ['-c', 'pwd'], {
      cwd: '/tmp',
      env: expect.any(Object),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      signal: undefined,
    });
  });

  it('starts bounded-host runtime jobs in the runtime cwd', async () => {
    const mutableState = {
      activeSession: {
        dir: '/tmp/test-session',
        meta: {
          sessionId: 'sess_workspace',
          workDir: '/project/pkg',
          projectId: 'test-project',
          rootDir: '/tmp',
          personaId: 'default',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      } as LoadedSession,
      config: { approvalMode: 'dangerouslySkipPermissions' as const },
      jobStreaming: 'none' as const,
    };

    const mockEmitSessionUpdate = vi.fn().mockResolvedValue(undefined);
    const mockFinalizeJob = vi.fn().mockResolvedValue(undefined);
    const mockRequestPermission = vi.fn().mockResolvedValue({ decision: 'allow' });
    const mockRunExclusive = vi.fn().mockImplementation(<T>(fn: () => T) => fn());

    const runShellJobProcess = createRunShellJobProcess({
      getState: () => mutableState,
      runExclusive: mockRunExclusive,
      emitSessionUpdate: mockEmitSessionUpdate,
      requestPermissionFromClient: mockRequestPermission,
      finalizeJob: mockFinalizeJob,
    });

    const job: JobState = {
      jobId: 'job_workspace',
      type: 'bash',
      status: 'running',
      command: 'pwd',
      startedAt: new Date().toISOString(),
      outputPath: '/tmp/test-output',
      finished: false,
      completion: Promise.resolve(),
      resolveCompletion: vi.fn(),
      runtimeBinding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_bounded_host_job' },
        toolRuntime: {
          type: 'boundedHost',
          root: process.cwd(),
          cwd: process.cwd(),
        },
      },
    };

    runShellJobProcess(job);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSpawn).toHaveBeenCalledWith('/bin/bash', ['-c', 'pwd'], {
      cwd: process.cwd(),
      env: expect.any(Object),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      signal: undefined,
    });
  });
});
