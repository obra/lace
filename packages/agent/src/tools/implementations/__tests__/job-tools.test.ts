// ABOUTME: Tests for job management tools using JobManager

import { describe, it, expect, vi } from 'vitest';
import { JobOutputTool } from '../job_output';
import { JobsListTool } from '../jobs_list';
import { JobKillTool } from '../job_kill';
import type { JobManager, JobRecord } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';

describe('JobOutputTool', () => {
  it('returns error when jobManager not in context', async () => {
    const tool = new JobOutputTool();
    const result = await tool.execute(
      { jobId: 'job_123' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('jobManager');
  });

  it('returns job status and output for completed job', async () => {
    const tool = new JobOutputTool();

    const mockJob = {
      jobId: 'job_123',
      status: 'completed' as const,
      exitCode: 0,
      completion: Promise.resolve(),
    } as unknown as JobState;

    const jobManager = {
      getJob: vi.fn().mockReturnValue(mockJob),
      getJobOutput: vi.fn().mockReturnValue('hello world'),
    } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_123' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('completed');
    expect(result.content[0].text).toContain('hello world');
    expect(result.content[0].text).toContain('exitCode');
  });

  it('returns a snapshot for a running job without waiting', async () => {
    const tool = new JobOutputTool();

    const completion = new Promise<void>(() => {
      /* never resolves */
    });

    const mockJob = {
      jobId: 'job_running',
      status: 'running' as const,
      completion,
    } as unknown as JobState;

    const jobManager = {
      getJob: vi.fn().mockReturnValue(mockJob),
      getJobOutput: vi.fn().mockReturnValue('partial output'),
    } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_running' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('running');
    expect(result.content[0].text).toContain('partial output');
  });

  it('returns not found for unknown job', async () => {
    const tool = new JobOutputTool();

    const jobManager = {
      getJob: vi.fn().mockReturnValue(undefined),
      getJobOutput: vi.fn().mockReturnValue(''),
    } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_unknown' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('not found');
  });
});

describe('JobsListTool', () => {
  it('returns error when jobManager not in context', async () => {
    const tool = new JobsListTool();
    const result = await tool.execute({}, { signal: new AbortController().signal });

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('jobManager');
  });

  it('lists all jobs without filters', async () => {
    const tool = new JobsListTool();

    const jobs: JobRecord[] = [
      {
        jobId: 'job_1',
        type: 'bash',
        status: 'completed',
        startTime: '2025-01-15T10:00:00Z',
      },
      {
        jobId: 'job_2',
        type: 'delegate',
        status: 'running',
        startTime: '2025-01-15T10:01:00Z',
      },
    ];

    const jobManager = {
      listJobs: vi.fn().mockReturnValue(jobs),
    } as unknown as JobManager;

    const result = await tool.execute({}, { signal: new AbortController().signal, jobManager });

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('job_1');
    expect(result.content[0].text).toContain('job_2');
    expect(jobManager.listJobs).toHaveBeenCalled();
  });

  it('filters by status', async () => {
    const tool = new JobsListTool();

    const jobs: JobRecord[] = [
      { jobId: 'job_1', type: 'bash', status: 'completed', startTime: '2025-01-15T10:00:00Z' },
      { jobId: 'job_2', type: 'bash', status: 'running', startTime: '2025-01-15T10:01:00Z' },
      { jobId: 'job_3', type: 'bash', status: 'failed', startTime: '2025-01-15T10:02:00Z' },
    ];

    const jobManager = {
      listJobs: vi.fn().mockReturnValue(jobs),
    } as unknown as JobManager;

    const result = await tool.execute(
      { status: ['running', 'completed'] },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('job_1');
    expect(result.content[0].text).toContain('job_2');
    expect(result.content[0].text).not.toContain('job_3'); // failed, not in filter
  });

  it('filters by type', async () => {
    const tool = new JobsListTool();

    const jobs: JobRecord[] = [
      { jobId: 'job_bash', type: 'bash', status: 'completed', startTime: '2025-01-15T10:00:00Z' },
      {
        jobId: 'job_delegate',
        type: 'delegate',
        status: 'completed',
        startTime: '2025-01-15T10:01:00Z',
      },
    ];

    const jobManager = {
      listJobs: vi.fn().mockReturnValue(jobs),
    } as unknown as JobManager;

    const result = await tool.execute(
      { type: ['delegate'] },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('job_delegate');
    expect(result.content[0].text).not.toContain('job_bash');
  });

  it('respects limit', async () => {
    const tool = new JobsListTool();

    const jobs: JobRecord[] = Array.from({ length: 10 }, (_, i) => ({
      jobId: `job_${i}`,
      type: 'bash' as const,
      status: 'completed' as const,
      startTime: '2025-01-15T10:00:00Z',
    }));

    const jobManager = {
      listJobs: vi.fn().mockReturnValue(jobs),
    } as unknown as JobManager;

    const result = await tool.execute(
      { limit: 3 },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    // Should only contain first 3 jobs
    const text = result.content[0].text ?? '';
    expect(text).toContain('job_0');
    expect(text).toContain('job_1');
    expect(text).toContain('job_2');
    expect(text).not.toContain('job_3');
  });
});

describe('JobKillTool', () => {
  it('returns error when jobManager not in context', async () => {
    const tool = new JobKillTool();
    const result = await tool.execute(
      { jobId: 'job_123' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('jobManager');
  });

  it('cancels a running job', async () => {
    const tool = new JobKillTool();

    const mockJob = {
      jobId: 'job_running',
      status: 'running' as const,
    } as unknown as JobState;

    const jobManager = {
      getJob: vi.fn().mockReturnValue(mockJob),
      cancelJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_running' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(jobManager.cancelJob).toHaveBeenCalledWith('job_running');
    expect(result.content[0].text).toContain('cancelled');
  });

  it('returns error for non-running job', async () => {
    const tool = new JobKillTool();

    const mockJob = {
      jobId: 'job_completed',
      status: 'completed' as const,
    } as unknown as JobState;

    const jobManager = {
      getJob: vi.fn().mockReturnValue(mockJob),
      cancelJob: vi.fn(),
    } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_completed' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('not running');
    expect(jobManager.cancelJob).not.toHaveBeenCalled();
  });

  it('returns error for unknown job', async () => {
    const tool = new JobKillTool();

    const jobManager = {
      getJob: vi.fn().mockReturnValue(undefined),
      cancelJob: vi.fn(),
    } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_unknown' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('not found');
  });
});
