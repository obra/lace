// ABOUTME: Tests for JobManager class - the unified job management service
// Tests job state management, operations, and notifications

import { describe, it, expect, vi } from 'vitest';
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
});
