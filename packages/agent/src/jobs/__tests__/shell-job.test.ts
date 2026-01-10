// ABOUTME: Tests for shell job state access pattern

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRunShellJobProcess } from '../shell-job';
import type { JobState } from '../../server-types';
import type { LoadedSession } from '../../storage/session-store';

// Mock session-store to avoid file system dependencies
vi.mock('../../storage/session-store', () => ({
  readSessionState: vi.fn().mockReturnValue({ config: null }),
}));

describe('createRunShellJobProcess', () => {
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
    const runShellJobProcess = createRunShellJobProcess({
      state: mutableState,
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
        workDir: '/tmp/work',
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
    };

    // Run the job - if the bug exists, this will silently return
    // because activeSession was null at creation time
    runShellJobProcess(job);

    // Wait for async execution
    await new Promise((r) => setTimeout(r, 200));

    // If the bug exists, the job was silently skipped because
    // context.state.activeSession was captured as null at creation time.
    // The fix is to use a getState() function pattern instead of
    // passing the state object directly.
    //
    // This assertion will FAIL until we fix shell-job.ts to use getState()
    expect(mockFinalizeJob).toHaveBeenCalled();
  });
});
