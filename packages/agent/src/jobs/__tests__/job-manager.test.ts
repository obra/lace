// ABOUTME: Tests for JobManager class - the unified job management service
// Tests job state management, operations, and notifications

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JobManager, JobCreationError } from '../job-manager';
import type { JobState } from '../../server-types';
import type { JobManagerDeps } from '../job-manager';

describe('JobManager', () => {
  describe('construction', () => {
    it('initializes with empty state', () => {
      const deps = {
        getActiveSession: vi.fn().mockReturnValue(null),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };

      const manager = new JobManager(deps);

      expect(manager.listJobs()).toEqual([]);
      expect(manager.getStreamingMode()).toBe('full');
    });
  });

  describe('job state', () => {
    it('can add and retrieve a job', () => {
      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      const job: JobState = {
        jobId: 'job_123',
        type: 'bash',
        status: 'running',
        startedAt: new Date().toISOString(),
        outputPath: '/tmp/job.log',
        finished: false,
        completion: Promise.resolve(),
        resolveCompletion: () => {},
      };

      manager.addJob(job);

      expect(manager.getJob('job_123')).toBe(job);
      expect(manager.getRunningJobs().get('job_123')).toBe(job);
    });

    it('can remove a job', () => {
      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      const job: JobState = {
        jobId: 'job_123',
        type: 'bash',
        status: 'running',
        startedAt: new Date().toISOString(),
        outputPath: '/tmp/job.log',
        finished: false,
        completion: Promise.resolve(),
        resolveCompletion: () => {},
      };

      manager.addJob(job);
      manager.removeJob('job_123');

      expect(manager.getJob('job_123')).toBeUndefined();
    });

    it('streaming mode can be changed', () => {
      const deps = {
        getActiveSession: vi.fn().mockReturnValue(null),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      manager.setStreamingMode('coalesced');
      expect(manager.getStreamingMode()).toBe('coalesced');
    });
  });

  describe('listJobs', () => {
    let testDir: string | null = null;

    afterEach(() => {
      if (testDir) {
        rmSync(testDir, { recursive: true });
        testDir = null;
      }
    });

    it('returns empty array when no session', () => {
      const deps = {
        getActiveSession: vi.fn().mockReturnValue(null),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      expect(manager.listJobs()).toEqual([]);
    });

    it('returns empty array when events.jsonl does not exist', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      // No events.jsonl file

      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      expect(manager.listJobs()).toEqual([]);
    });

    it('reconstructs jobs from events.jsonl', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const events = [
        {
          type: 'job_started',
          timestamp: '2025-01-15T10:00:00Z',
          data: { jobId: 'job_1', jobType: 'bash', description: 'test job', command: 'echo hello' },
        },
        {
          type: 'job_finished',
          timestamp: '2025-01-15T10:01:00Z',
          data: { jobId: 'job_1', outcome: 'completed', exitCode: 0 },
        },
      ];
      writeFileSync(join(testDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));

      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      const jobs = manager.listJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe('job_1');
      expect(jobs[0].status).toBe('completed');
      expect(jobs[0].type).toBe('bash');
      expect(jobs[0].description).toBe('test job');
      expect(jobs[0].command).toBe('echo hello');
      expect(jobs[0].exitCode).toBe(0);
    });

    it('includes subagentSessionId from job_session_assigned events', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const events = [
        {
          type: 'job_started',
          timestamp: '2025-01-15T10:00:00Z',
          data: { jobId: 'job_1', jobType: 'delegate', description: 'subagent' },
        },
        {
          type: 'job_session_assigned',
          timestamp: '2025-01-15T10:00:01Z',
          data: { jobId: 'job_1', subagentSessionId: 'sess_sub_123' },
        },
        {
          type: 'job_finished',
          timestamp: '2025-01-15T10:01:00Z',
          data: { jobId: 'job_1', outcome: 'completed' },
        },
      ];
      writeFileSync(join(testDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));

      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      const jobs = manager.listJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe('delegate');
      expect(jobs[0].subagentSessionId).toBe('sess_sub_123');
    });

    it('marks running jobs as failed if not in memory', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      // Only job_started, no job_finished - job should appear as "running" in events
      const events = [
        {
          type: 'job_started',
          timestamp: '2025-01-15T10:00:00Z',
          data: { jobId: 'job_orphan', jobType: 'bash', description: 'orphaned job' },
        },
      ];
      writeFileSync(join(testDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));

      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      // Job is not in memory, so it should be marked as failed
      const jobs = manager.listJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe('job_orphan');
      expect(jobs[0].status).toBe('failed');
    });

    it('keeps running status if job is in memory', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const events = [
        {
          type: 'job_started',
          timestamp: '2025-01-15T10:00:00Z',
          data: { jobId: 'job_active', jobType: 'bash', description: 'active job' },
        },
      ];
      writeFileSync(join(testDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));

      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      // Add job to memory so it's considered actually running
      const runningJob: JobState = {
        jobId: 'job_active',
        type: 'bash',
        status: 'running',
        startedAt: new Date().toISOString(),
        outputPath: '/tmp/job.log',
        finished: false,
        completion: Promise.resolve(),
        resolveCompletion: () => {},
      };
      manager.addJob(runningJob);

      const jobs = manager.listJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe('job_active');
      expect(jobs[0].status).toBe('running');
    });

    it('caches results and reuses them on subsequent calls', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const events = [
        {
          type: 'job_started',
          timestamp: '2025-01-15T10:00:00Z',
          data: { jobId: 'job_1', jobType: 'bash', description: 'test job' },
        },
        {
          type: 'job_finished',
          timestamp: '2025-01-15T10:01:00Z',
          data: { jobId: 'job_1', outcome: 'completed' },
        },
      ];
      writeFileSync(join(testDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));

      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      // First call parses the file
      const jobs1 = manager.listJobs();
      // Second call should use cache (same result)
      const jobs2 = manager.listJobs();

      expect(jobs1).toEqual(jobs2);
      expect(jobs1).toHaveLength(1);
    });

    it('invalidates cache when file changes', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const events1 = [
        {
          type: 'job_started',
          timestamp: '2025-01-15T10:00:00Z',
          data: { jobId: 'job_1', jobType: 'bash', description: 'first job' },
        },
        {
          type: 'job_finished',
          timestamp: '2025-01-15T10:01:00Z',
          data: { jobId: 'job_1', outcome: 'completed' },
        },
      ];
      writeFileSync(
        join(testDir, 'events.jsonl'),
        events1.map((e) => JSON.stringify(e)).join('\n')
      );

      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      // First call
      const jobs1 = manager.listJobs();
      expect(jobs1).toHaveLength(1);

      // Append new job to file
      const events2 = [
        ...events1,
        {
          type: 'job_started',
          timestamp: '2025-01-15T10:02:00Z',
          data: { jobId: 'job_2', jobType: 'bash', description: 'second job' },
        },
        {
          type: 'job_finished',
          timestamp: '2025-01-15T10:03:00Z',
          data: { jobId: 'job_2', outcome: 'completed' },
        },
      ];
      writeFileSync(
        join(testDir, 'events.jsonl'),
        events2.map((e) => JSON.stringify(e)).join('\n')
      );

      // Second call should detect file change and re-parse
      const jobs2 = manager.listJobs();
      expect(jobs2).toHaveLength(2);
    });

    it('handles parentJobId', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const events = [
        {
          type: 'job_started',
          timestamp: '2025-01-15T10:00:00Z',
          data: {
            jobId: 'job_child',
            parentJobId: 'job_parent',
            jobType: 'bash',
            description: 'child job',
          },
        },
        {
          type: 'job_finished',
          timestamp: '2025-01-15T10:01:00Z',
          data: { jobId: 'job_child', outcome: 'completed' },
        },
      ];
      writeFileSync(join(testDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));

      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      const jobs = manager.listJobs();

      expect(jobs[0].parentJobId).toBe('job_parent');
    });

    it('ignores non-job events', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const events = [
        { type: 'session_started', timestamp: '2025-01-15T10:00:00Z', data: {} },
        {
          type: 'job_started',
          timestamp: '2025-01-15T10:00:00Z',
          data: { jobId: 'job_1', jobType: 'bash' },
        },
        { type: 'message_sent', timestamp: '2025-01-15T10:00:01Z', data: { text: 'hello' } },
        {
          type: 'job_finished',
          timestamp: '2025-01-15T10:01:00Z',
          data: { jobId: 'job_1', outcome: 'completed' },
        },
        { type: 'session_ended', timestamp: '2025-01-15T10:02:00Z', data: {} },
      ];
      writeFileSync(join(testDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));

      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      const jobs = manager.listJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe('job_1');
    });

    it('handles malformed lines gracefully', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const content = [
        JSON.stringify({
          type: 'job_started',
          timestamp: '2025-01-15T10:00:00Z',
          data: { jobId: 'job_1', jobType: 'bash' },
        }),
        'this is not valid JSON',
        JSON.stringify({
          type: 'job_finished',
          timestamp: '2025-01-15T10:01:00Z',
          data: { jobId: 'job_1', outcome: 'completed' },
        }),
      ].join('\n');
      writeFileSync(join(testDir, 'events.jsonl'), content);

      const deps = {
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
        persistEvent: vi.fn(),
        emitUpdate: vi.fn(),
      };
      const manager = new JobManager(deps);

      const jobs = manager.listJobs();

      // Should still parse the valid job
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe('job_1');
    });
  });

  function createDeps(overrides: Partial<JobManagerDeps> = {}): JobManagerDeps {
    return {
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/test-session' }),
      persistEvent: vi.fn().mockResolvedValue(undefined),
      emitUpdate: vi.fn().mockResolvedValue(undefined),
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
      ...overrides,
    };
  }

  describe('finalizeJob', () => {
    it('persists job_finished event and removes from running jobs', async () => {
      const persistEvent = vi.fn().mockResolvedValue(undefined);
      const emitUpdate = vi.fn().mockResolvedValue(undefined);
      const deps = createDeps({ persistEvent, emitUpdate });
      const manager = new JobManager(deps);

      const job: JobState = {
        jobId: 'job_123',
        type: 'bash',
        status: 'completed',
        exitCode: 0,
        startedAt: new Date().toISOString(),
        outputPath: '/tmp/job.log',
        finished: false,
        completion: Promise.resolve(),
        resolveCompletion: vi.fn(),
      };

      manager.addJob(job);
      await manager.finalizeJob(job);

      // Verify: persistEvent called with job_finished
      expect(persistEvent).toHaveBeenCalledOnce();
      const eventArg = persistEvent.mock.calls[0][0] as {
        type: string;
        data: Record<string, unknown>;
      };
      expect(eventArg.type).toBe('job_finished');
      expect(eventArg.data.jobId).toBe('job_123');
      expect(eventArg.data.outcome).toBe('completed');
      expect(eventArg.data.exitCode).toBe(0);

      // Verify: job removed from map
      expect(manager.getJob('job_123')).toBeUndefined();
    });

    it('does nothing if job already finished', async () => {
      const persistEvent = vi.fn().mockResolvedValue(undefined);
      const deps = createDeps({ persistEvent });
      const manager = new JobManager(deps);

      const job: JobState = {
        jobId: 'job_123',
        type: 'bash',
        status: 'completed',
        startedAt: new Date().toISOString(),
        outputPath: '/tmp/job.log',
        finished: true, // Already finished
        completion: Promise.resolve(),
        resolveCompletion: vi.fn(),
      };

      manager.addJob(job);
      await manager.finalizeJob(job);

      // Verify: persistEvent not called
      expect(persistEvent).not.toHaveBeenCalled();
    });

    it('emits job_finished update', async () => {
      const emitUpdate = vi.fn().mockResolvedValue(undefined);
      const deps = createDeps({ emitUpdate });
      const manager = new JobManager(deps);

      const job: JobState = {
        jobId: 'job_456',
        type: 'delegate',
        status: 'failed',
        exitCode: 1,
        startedAt: new Date().toISOString(),
        outputPath: '/tmp/job.log',
        finished: false,
        completion: Promise.resolve(),
        resolveCompletion: vi.fn(),
      };

      manager.addJob(job);
      await manager.finalizeJob(job);

      // Verify emitUpdate called with type: job_finished
      expect(emitUpdate).toHaveBeenCalledOnce();
      const updateArg = emitUpdate.mock.calls[0][0] as {
        type: string;
        jobId: string;
        outcome: string;
        exitCode?: number;
      };
      expect(updateArg.type).toBe('job_finished');
      expect(updateArg.jobId).toBe('job_456');
      expect(updateArg.outcome).toBe('failed');
      expect(updateArg.exitCode).toBe(1);
    });

    it('resolves completion promise', async () => {
      const deps = createDeps();
      const manager = new JobManager(deps);

      const resolveCompletion = vi.fn();
      const job: JobState = {
        jobId: 'job_789',
        type: 'bash',
        status: 'completed',
        startedAt: new Date().toISOString(),
        outputPath: '/tmp/job.log',
        finished: false,
        completion: Promise.resolve(),
        resolveCompletion,
      };

      manager.addJob(job);
      await manager.finalizeJob(job);

      // Verify job.resolveCompletion() is called
      expect(resolveCompletion).toHaveBeenCalledOnce();
    });

    it('includes parentJobId when present', async () => {
      const persistEvent = vi.fn().mockResolvedValue(undefined);
      const emitUpdate = vi.fn().mockResolvedValue(undefined);
      const deps = createDeps({ persistEvent, emitUpdate });
      const manager = new JobManager(deps);

      const job: JobState = {
        jobId: 'job_child',
        parentJobId: 'job_parent',
        type: 'bash',
        status: 'completed',
        startedAt: new Date().toISOString(),
        outputPath: '/tmp/job.log',
        finished: false,
        completion: Promise.resolve(),
        resolveCompletion: vi.fn(),
      };

      manager.addJob(job);
      await manager.finalizeJob(job);

      // Verify parentJobId is included in event
      const eventArg = persistEvent.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(eventArg.data.parentJobId).toBe('job_parent');

      // Verify parentJobId is included in update
      const updateArg = emitUpdate.mock.calls[0][0] as { parentJobId?: string };
      expect(updateArg.parentJobId).toBe('job_parent');
    });
  });

  describe('cancelJob', () => {
    it('sets job status to cancelled and finalizes', async () => {
      const persistEvent = vi.fn().mockResolvedValue(undefined);
      const emitUpdate = vi.fn().mockResolvedValue(undefined);
      const deps = createDeps({ persistEvent, emitUpdate });
      const manager = new JobManager(deps);

      const job: JobState = {
        jobId: 'job_running',
        type: 'bash',
        status: 'running',
        startedAt: new Date().toISOString(),
        outputPath: '/tmp/job.log',
        finished: false,
        completion: Promise.resolve(),
        resolveCompletion: vi.fn(),
      };

      manager.addJob(job);
      await manager.cancelJob('job_running');

      // Verify: status changed to cancelled
      expect(job.status).toBe('cancelled');

      // Verify: finalizeJob was called (persistEvent should have been called)
      expect(persistEvent).toHaveBeenCalledOnce();
      const eventArg = persistEvent.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(eventArg.data.outcome).toBe('cancelled');

      // Job should be removed from map
      expect(manager.getJob('job_running')).toBeUndefined();
    });

    it('does nothing for non-existent job', async () => {
      const persistEvent = vi.fn().mockResolvedValue(undefined);
      const deps = createDeps({ persistEvent });
      const manager = new JobManager(deps);

      // Call cancelJob with unknown jobId - should not throw
      await manager.cancelJob('job_nonexistent');

      // No persistEvent call
      expect(persistEvent).not.toHaveBeenCalled();
    });
  });

  describe('createJob', () => {
    it('throws JobCreationError when no active session', async () => {
      const deps = createDeps({
        getActiveSession: vi.fn().mockReturnValue(null),
      });
      const manager = new JobManager(deps);

      await expect(manager.createJob('shell', { command: 'echo hello' })).rejects.toThrow(
        JobCreationError
      );

      await expect(manager.createJob('shell', { command: 'echo hello' })).rejects.toMatchObject({
        code: -32001,
        category: 'session',
      });
    });

    it('creates shell job with correct type', async () => {
      const deps = createDeps();
      const manager = new JobManager(deps);

      const result = await manager.createJob('shell', {
        command: 'echo hello',
        description: 'Test shell job',
      });

      expect(result.jobId).toMatch(/^job_/);
      const job = manager.getJob(result.jobId);
      expect(job).toBeDefined();
      expect(job!.type).toBe('bash');
      expect(job!.command).toBe('echo hello');
      expect(job!.description).toBe('Test shell job');
      expect(job!.status).toBe('running');
    });

    it('creates delegate job with correct type', async () => {
      const deps = createDeps();
      const manager = new JobManager(deps);

      const result = await manager.createJob('delegate', {
        prompt: 'Do something helpful',
        description: 'Test delegate job',
      });

      expect(result.jobId).toMatch(/^job_/);
      const job = manager.getJob(result.jobId);
      expect(job).toBeDefined();
      expect(job!.type).toBe('delegate');
      expect(job!.command).toBe('Do something helpful');
      expect(job!.description).toBe('Test delegate job');
      expect(job!.status).toBe('running');
    });

    it('persists job_started event', async () => {
      const persistEvent = vi.fn().mockResolvedValue(undefined);
      const deps = createDeps({ persistEvent });
      const manager = new JobManager(deps);

      await manager.createJob('shell', { command: 'echo hello', description: 'Test' });

      expect(persistEvent).toHaveBeenCalledOnce();
      const eventArg = persistEvent.mock.calls[0][0] as {
        type: string;
        data: Record<string, unknown>;
      };
      expect(eventArg.type).toBe('job_started');
      expect(eventArg.data.jobType).toBe('bash');
      expect(eventArg.data.command).toBe('echo hello');
      expect(eventArg.data.description).toBe('Test');
      expect(eventArg.data.jobId).toMatch(/^job_/);
    });

    it('emits job_started update', async () => {
      const emitUpdate = vi.fn().mockResolvedValue(undefined);
      const deps = createDeps({ emitUpdate });
      const manager = new JobManager(deps);

      await manager.createJob('shell', { command: 'echo hello' });

      expect(emitUpdate).toHaveBeenCalledOnce();
      const updateArg = emitUpdate.mock.calls[0][0] as {
        type: string;
        jobId: string;
        jobType: string;
      };
      expect(updateArg.type).toBe('job_started');
      expect(updateArg.jobType).toBe('bash');
      expect(updateArg.jobId).toMatch(/^job_/);
    });

    it('calls runShellProcess for shell jobs', async () => {
      const runShellProcess = vi.fn();
      const deps = createDeps({ runShellProcess });
      const manager = new JobManager(deps);

      await manager.createJob('shell', { command: 'echo hello' });

      expect(runShellProcess).toHaveBeenCalledOnce();
      const jobArg = runShellProcess.mock.calls[0][0] as JobState;
      expect(jobArg.type).toBe('bash');
      expect(jobArg.command).toBe('echo hello');
    });

    it('calls runSubagentProcess for delegate jobs', async () => {
      const runSubagentProcess = vi.fn();
      const deps = createDeps({ runSubagentProcess });
      const manager = new JobManager(deps);

      await manager.createJob('delegate', { prompt: 'Do something' });

      expect(runSubagentProcess).toHaveBeenCalledOnce();
      const jobArg = runSubagentProcess.mock.calls[0][0] as JobState;
      expect(jobArg.type).toBe('delegate');
    });

    it('throws when max concurrent jobs exceeded', async () => {
      const deps = createDeps();
      const manager = new JobManager(deps);

      // Add 10 running jobs (MAX_CONCURRENT_JOBS)
      for (let i = 0; i < 10; i++) {
        manager.addJob({
          jobId: `job_existing_${i}`,
          type: 'bash',
          status: 'running',
          startedAt: new Date().toISOString(),
          outputPath: '/tmp/job.log',
          finished: false,
          completion: Promise.resolve(),
          resolveCompletion: () => {},
        });
      }

      await expect(manager.createJob('shell', { command: 'echo hello' })).rejects.toThrow(
        JobCreationError
      );

      await expect(manager.createJob('shell', { command: 'echo hello' })).rejects.toMatchObject({
        code: -32003,
        category: 'session',
      });
    });

    it('includes parentJobId in job state', async () => {
      const deps = createDeps();
      const manager = new JobManager(deps);

      const result = await manager.createJob('shell', {
        command: 'echo hello',
        parentJobId: 'job_parent_123',
      });

      const job = manager.getJob(result.jobId);
      expect(job!.parentJobId).toBe('job_parent_123');
    });

    it('includes turnContext in job state', async () => {
      const persistEvent = vi.fn().mockResolvedValue(undefined);
      const deps = createDeps({ persistEvent });
      const manager = new JobManager(deps);

      await manager.createJob('shell', {
        command: 'echo hello',
        turnContext: { turnId: 'turn_abc', turnSeq: 5 },
      });

      const eventArg = persistEvent.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(eventArg.data.turnContext).toEqual({ turnId: 'turn_abc', turnSeq: 5 });
    });

    it('includes resumeSessionId for delegate jobs', async () => {
      const deps = createDeps();
      const manager = new JobManager(deps);

      const result = await manager.createJob('delegate', {
        prompt: 'Resume work',
        resumeSessionId: 'sess_resume_123',
      });

      const job = manager.getJob(result.jobId);
      expect(job!.subagentSessionId).toBe('sess_resume_123');
    });

    it('includes connectionId and modelId for delegate jobs', async () => {
      const deps = createDeps();
      const manager = new JobManager(deps);

      const result = await manager.createJob('delegate', {
        prompt: 'Use specific model',
        connectionId: 'conn_123',
        modelId: 'gpt-4',
      });

      const job = manager.getJob(result.jobId);
      expect(job!.connectionId).toBe('conn_123');
      expect(job!.modelId).toBe('gpt-4');
    });

    it('sets subagentContent for delegate jobs', async () => {
      const deps = createDeps();
      const manager = new JobManager(deps);

      const result = await manager.createJob('delegate', {
        prompt: 'The task prompt',
      });

      const job = manager.getJob(result.jobId);
      expect(job!.subagentContent).toEqual([{ type: 'text', text: 'The task prompt' }]);
    });

    it('defaults description to "Subagent" for delegate jobs without description', async () => {
      const deps = createDeps();
      const manager = new JobManager(deps);

      const result = await manager.createJob('delegate', {
        prompt: 'Some task',
      });

      const job = manager.getJob(result.jobId);
      expect(job!.description).toBe('Subagent');
    });

    it('includes progressIntervalMs in job state', async () => {
      const deps = createDeps();
      const manager = new JobManager(deps);

      const result = await manager.createJob('shell', {
        command: 'echo hello',
        progressIntervalMs: 60000,
      });

      const job = manager.getJob(result.jobId);
      expect(job!.progressIntervalMs).toBe(60000);
    });

    it('calls setupProgressTimer when an explicit progressIntervalMs is provided', async () => {
      const setupProgressTimer = vi.fn();
      const deps = createDeps({ setupProgressTimer });
      const manager = new JobManager(deps);

      await manager.createJob('shell', { command: 'echo hello', progressIntervalMs: 60000 });

      expect(setupProgressTimer).toHaveBeenCalledOnce();
      const jobArg = setupProgressTimer.mock.calls[0][0] as JobState;
      expect(jobArg.type).toBe('bash');
    });

    it('does not call setupProgressTimer when no explicit progressIntervalMs is provided (PRI-1707)', async () => {
      const setupProgressTimer = vi.fn();
      const deps = createDeps({ setupProgressTimer });
      const manager = new JobManager(deps);

      await manager.createJob('shell', { command: 'echo hello' });

      expect(setupProgressTimer).not.toHaveBeenCalled();
    });

    it('works without setupProgressTimer even when progressIntervalMs is set', async () => {
      // Deps without setupProgressTimer - should not throw. We deliberately
      // pass progressIntervalMs so the opt-in branch actually exercises the
      // `?.()` optional-chain on the missing dep (PRI-1707). Without the
      // explicit interval the branch would short-circuit before reaching
      // setupProgressTimer at all, and this test would silently lie.
      const deps = createDeps();
      delete (deps as Partial<JobManagerDeps>).setupProgressTimer;
      const manager = new JobManager(deps);

      const result = await manager.createJob('shell', {
        command: 'echo hello',
        progressIntervalMs: 60000,
      });

      expect(result.jobId).toMatch(/^job_/);
    });
  });

  describe('getJobOutput', () => {
    let testDir: string | null = null;

    afterEach(() => {
      if (testDir) {
        rmSync(testDir, { recursive: true });
        testDir = null;
      }
    });

    it('reads output from job file', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      const jobsDir = join(testDir, 'jobs');
      mkdirSync(jobsDir, { recursive: true });
      writeFileSync(join(jobsDir, 'job_123.log'), 'hello world\nline 2');

      const deps = createDeps({
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
      });
      const manager = new JobManager(deps);

      const output = manager.getJobOutput('job_123');

      expect(output).toBe('hello world\nline 2');
    });

    it('returns empty string when no session', () => {
      const deps = createDeps({
        getActiveSession: vi.fn().mockReturnValue(null),
      });
      const manager = new JobManager(deps);

      const output = manager.getJobOutput('job_123');

      expect(output).toBe('');
    });

    it('returns empty string when file does not exist', () => {
      testDir = join(tmpdir(), `job-manager-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      // No jobs directory or log file

      const deps = createDeps({
        getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
      });
      const manager = new JobManager(deps);

      const output = manager.getJobOutput('job_nonexistent');

      expect(output).toBe('');
    });
  });
});
