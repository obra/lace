// ABOUTME: Tests for DelegateTool - subagent job creation via JobManager

import { describe, it, expect, vi } from 'vitest';
import { DelegateTool } from '../delegate';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';

describe('DelegateTool', () => {
  it('returns error when jobManager not in context', async () => {
    const tool = new DelegateTool();
    const result = await tool.execute(
      { prompt: 'test' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('jobManager');
  });

  it('creates delegate job and waits for completion (sync mode)', async () => {
    const tool = new DelegateTool();

    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });

    const mockJob = {
      jobId: 'job_123',
      type: 'delegate' as const,
      status: 'completed' as const,
      completion,
      resolveCompletion: () => resolveJob(),
    } as unknown as JobState;

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_123', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
      getJobOutput: vi.fn().mockReturnValue('subagent output here'),
      finalizeJob: vi.fn(),
    } as unknown as JobManager;

    // Resolve job completion immediately
    setTimeout(() => resolveJob(), 10);

    const result = await tool.execute(
      { prompt: 'do something' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(jobManager.createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        prompt: 'do something',
      })
    );
    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('job_123');
  });

  it('returns immediately in background mode', async () => {
    const tool = new DelegateTool();

    const mockJob = {
      jobId: 'job_456',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}), // Never resolves
    } as unknown as JobState;

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_456', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    const result = await tool.execute(
      { prompt: 'do something', background: true },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('job_456');
    expect(result.content[0].text).toContain('started');
  });

  it('resumes previous job session', async () => {
    const tool = new DelegateTool();

    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });
    const mockJob = {
      jobId: 'job_789',
      status: 'completed' as const,
      completion,
      resolveCompletion: () => resolveJob(),
    } as unknown as JobState;

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_789', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([{ jobId: 'job_prev', subagentSessionId: 'sess_sub_abc' }]),
      getJobOutput: vi.fn().mockReturnValue('resumed output'),
      finalizeJob: vi.fn(),
    } as unknown as JobManager;

    setTimeout(() => resolveJob(), 10);

    const result = await tool.execute(
      { prompt: 'continue', resume: 'job_prev' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(jobManager.createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        prompt: 'continue',
        resumeSessionId: 'sess_sub_abc',
      })
    );
    expect(result.status).toBe('completed');
  });

  it('returns error when resume job not found', async () => {
    const tool = new DelegateTool();

    const jobManager = {
      listJobs: vi.fn().mockReturnValue([{ jobId: 'job_other' }]),
    } as unknown as JobManager;

    const result = await tool.execute(
      { prompt: 'continue', resume: 'job_missing' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('Cannot resume');
    expect(result.content[0].text).toContain('job_missing');
  });

  it('includes turn context when provided', async () => {
    const tool = new DelegateTool();

    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });

    const mockJob = {
      jobId: 'job_turn',
      status: 'completed' as const,
      completion,
    } as unknown as JobState;

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_turn', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
      getJobOutput: vi.fn().mockReturnValue(''),
    } as unknown as JobManager;

    setTimeout(() => resolveJob(), 10);

    await tool.execute(
      { prompt: 'task' },
      { signal: new AbortController().signal, jobManager, turnId: 'turn_abc', turnSeq: 5 }
    );

    expect(jobManager.createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        turnContext: { turnId: 'turn_abc', turnSeq: 5 },
      })
    );
  });

  it('passes connectionId and modelId to createJob', async () => {
    const tool = new DelegateTool();

    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });

    const mockJob = {
      jobId: 'job_model',
      status: 'completed' as const,
      completion,
    } as unknown as JobState;

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_model', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
      getJobOutput: vi.fn().mockReturnValue(''),
    } as unknown as JobManager;

    setTimeout(() => resolveJob(), 10);

    await tool.execute(
      { prompt: 'task', connectionId: 'conn_123', modelId: 'gpt-4' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(jobManager.createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        connectionId: 'conn_123',
        modelId: 'gpt-4',
      })
    );
  });
});
