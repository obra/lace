// ABOUTME: Tests for job control functions (killJob, killAllRunningJobs)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { JobState } from '../../server-types';
import { killJob, killAllRunningJobs } from '../job-control';

// Helper to create a mock JobState
function createMockJob(overrides?: Partial<JobState>): JobState {
  let resolveCompletion: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });

  return {
    jobId: 'job_test',
    type: 'bash',
    status: 'running',
    command: 'sleep 100',
    startedAt: new Date().toISOString(),
    outputPath: '/tmp/test-output',
    finished: false,
    completion,
    resolveCompletion: resolveCompletion!,
    ...overrides,
  };
}

// Helper to create a mock ChildProcess
function createMockProc(overrides?: Partial<ChildProcess>): ChildProcess {
  return {
    pid: 12345,
    exitCode: null,
    kill: vi.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as ChildProcess;
}

describe('killJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  it('should do nothing for non-running jobs', async () => {
    const job = createMockJob({ status: 'completed' });
    await killJob(job);
    expect(job.status).toBe('completed');
  });

  it('should set status to cancelled for running jobs', async () => {
    const job = createMockJob({ status: 'running' });
    await killJob(job);
    expect(job.status).toBe('cancelled');
  });

  it('should abort permissionAbortController if present', async () => {
    const abortController = new AbortController();
    const job = createMockJob({
      status: 'running',
      permissionAbortController: abortController,
    });

    await killJob(job);
    expect(abortController.signal.aborted).toBe(true);
  });

  it('should kill process group on POSIX systems', async () => {
    const mockProc = createMockProc({ pid: 12345, exitCode: null });
    const job = createMockJob({ status: 'running', proc: mockProc });

    // Simulate process exiting after SIGTERM
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    // Resolve completion after a brief delay to simulate process exit
    setTimeout(() => {
      job.resolveCompletion();
    }, 10);

    await killJob(job);

    expect(process.kill).toHaveBeenCalledWith(-12345, 'SIGTERM');
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('should use proc.kill on Windows', async () => {
    const mockProc = createMockProc({ pid: 12345, exitCode: null });
    const job = createMockJob({ status: 'running', proc: mockProc });

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    // Resolve completion after a brief delay
    setTimeout(() => {
      job.resolveCompletion();
    }, 10);

    await killJob(job);

    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('should wait for graceful shutdown', async () => {
    const mockProc = createMockProc({ pid: 12345, exitCode: null });
    const job = createMockJob({ status: 'running', proc: mockProc });

    // Resolve completion after 50ms (within wait time)
    setTimeout(() => {
      job.resolveCompletion();
    }, 50);

    const startTime = Date.now();
    await killJob(job, { waitMs: 200 });
    const elapsed = Date.now() - startTime;

    // Should have waited for completion, not the full wait time
    expect(elapsed).toBeLessThan(150);
  });

  it('should handle process.kill errors gracefully', async () => {
    const mockProc = createMockProc({ pid: 12345, exitCode: null });
    const job = createMockJob({ status: 'running', proc: mockProc });

    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('No such process');
    });

    // Should not throw
    await expect(killJob(job)).resolves.toBeUndefined();
    expect(job.status).toBe('cancelled');
  });
});

describe('killAllRunningJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  it('should kill all running jobs in a map', async () => {
    const jobs = new Map<string, JobState>();

    const runningJob1 = createMockJob({ jobId: 'job_1', status: 'running' });
    const runningJob2 = createMockJob({ jobId: 'job_2', status: 'running' });
    const completedJob = createMockJob({ jobId: 'job_3', status: 'completed' });

    jobs.set('job_1', runningJob1);
    jobs.set('job_2', runningJob2);
    jobs.set('job_3', completedJob);

    await killAllRunningJobs(jobs);

    expect(runningJob1.status).toBe('cancelled');
    expect(runningJob2.status).toBe('cancelled');
    expect(completedJob.status).toBe('completed'); // Should remain unchanged
  });

  it('should handle empty job maps', async () => {
    const jobs = new Map<string, JobState>();
    await expect(killAllRunningJobs(jobs)).resolves.toBeUndefined();
  });

  it('should pass options to individual killJob calls', async () => {
    const jobs = new Map<string, JobState>();
    const mockProc = createMockProc({ pid: 12345, exitCode: null });
    const job = createMockJob({ jobId: 'job_1', status: 'running', proc: mockProc });
    jobs.set('job_1', job);

    // Resolve completion after a brief delay
    setTimeout(() => {
      job.resolveCompletion();
    }, 10);

    await killAllRunningJobs(jobs, { waitMs: 100 });

    expect(job.status).toBe('cancelled');
    expect(process.kill).toHaveBeenCalled();
  });
});
