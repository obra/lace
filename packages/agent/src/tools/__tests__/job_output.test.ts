// ABOUTME: Tests for job_output tool schema validation (snapshot-only)

import { describe, expect, it, vi } from 'vitest';
import { JobOutputTool } from '../implementations/job_output';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';

describe('JobOutputTool', () => {
  it('has correct name and schema', () => {
    const tool = new JobOutputTool();

    expect(tool.name).toBe('job_output');

    const result = tool.schema.safeParse({
      jobId: 'job_abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects the removed block parameter (strict schema)', () => {
    const tool = new JobOutputTool();

    const result = tool.schema.safeParse({
      jobId: 'job_abc123',
      block: true,
    });

    expect(result.success).toBe(false);
  });

  it('accepts byteOffset parameter', () => {
    const tool = new JobOutputTool();

    const result = tool.schema.safeParse({
      jobId: 'job_abc123',
      byteOffset: 100,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.byteOffset).toBe(100);
    }
  });

  it('returns immediately with status running without waiting for completion', async () => {
    const tool = new JobOutputTool();

    const completion = new Promise<void>(() => {
      /* never resolves */
    });

    const runningJob = {
      jobId: 'job_running',
      status: 'running' as const,
      completion,
    } as unknown as JobState;

    const jobManager = {
      getJob: vi.fn().mockReturnValue(runningJob),
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

  it('marks a running job stalled when output has been quiet past the threshold', async () => {
    const tool = new JobOutputTool();

    const stalledJob = {
      jobId: 'job_stalled',
      status: 'running' as const,
      lastOutputChangeAt: Date.now() - 16 * 60 * 1000,
    } as unknown as JobState;

    const jobManager = {
      getJob: vi.fn().mockReturnValue(stalledJob),
      getJobOutput: vi.fn().mockReturnValue('same old output'),
    } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_stalled' },
      { signal: new AbortController().signal, jobManager }
    );

    const parsed = JSON.parse(result.content[0].text ?? '{}') as {
      stalled?: boolean;
      stalledForMs?: number;
    };
    expect(parsed.stalled).toBe(true);
    expect(parsed.stalledForMs).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });

  it('does not mark a recently-active running job stalled', async () => {
    const tool = new JobOutputTool();

    const activeJob = {
      jobId: 'job_active',
      status: 'running' as const,
      lastOutputChangeAt: Date.now() - 60 * 1000,
    } as unknown as JobState;

    const jobManager = {
      getJob: vi.fn().mockReturnValue(activeJob),
      getJobOutput: vi.fn().mockReturnValue('fresh output'),
    } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_active' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.content[0].text).not.toContain('stalled');
  });
});
