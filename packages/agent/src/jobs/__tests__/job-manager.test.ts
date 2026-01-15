// ABOUTME: Tests for JobManager class - the unified job management service
// Tests job state management, operations, and notifications

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JobManager } from '../job-manager';
import type { JobState } from '../../server-types';

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
});
