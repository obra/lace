// ABOUTME: Tests for the job_notify tool (PRI-1692 Phase 1)
// Verifies that job_notify registers a subscription on the JobManager and
// returns a structured result containing the subscription id.

import { describe, it, expect, vi } from 'vitest';
import { JobNotifyTool } from '../job_notify';
import type { JobManager } from '@lace/agent/jobs/job-manager';

describe('JobNotifyTool', () => {
  it('returns error when jobManager not in context', async () => {
    const tool = new JobNotifyTool();
    const result = await tool.execute(
      { jobId: 'job_123' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('jobManager');
  });

  it('registers a subscription with default terminal-state on=[]', async () => {
    const tool = new JobNotifyTool();
    const subscribe = vi.fn().mockReturnValue({
      subscriptionId: 'sub_abc',
      jobId: 'job_123',
      on: ['completed', 'failed', 'cancelled'],
    });
    const jobManager = { subscribe } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_123' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(subscribe).toHaveBeenCalledWith({
      jobId: 'job_123',
      on: ['completed', 'failed', 'cancelled'],
    });
    const parsed = JSON.parse(result.content[0].text ?? '{}') as {
      subscribed: boolean;
      subscriptionId: string;
      jobId: string;
      on: string[];
    };
    expect(parsed.subscribed).toBe(true);
    expect(parsed.subscriptionId).toBe('sub_abc');
    expect(parsed.jobId).toBe('job_123');
    expect(parsed.on).toEqual(['completed', 'failed', 'cancelled']);
  });

  it('accepts explicit on=["failed"] only', async () => {
    const tool = new JobNotifyTool();
    const subscribe = vi.fn().mockReturnValue({
      subscriptionId: 'sub_def',
      jobId: 'job_456',
      on: ['failed'],
    });
    const jobManager = { subscribe } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_456', on: ['failed'] },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(subscribe).toHaveBeenCalledWith({
      jobId: 'job_456',
      on: ['failed'],
    });
  });

  it('forwards an optional filter argument to JobManager.subscribe', async () => {
    const tool = new JobNotifyTool();
    const subscribe = vi.fn().mockReturnValue({
      subscriptionId: 'sub_ghi',
      jobId: 'job_789',
      on: ['completed', 'failed', 'cancelled'],
      filter: '^ERROR:',
    });
    const jobManager = { subscribe } as unknown as JobManager;

    await tool.execute(
      { jobId: 'job_789', filter: '^ERROR:' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(subscribe).toHaveBeenCalledWith({
      jobId: 'job_789',
      on: ['completed', 'failed', 'cancelled'],
      filter: '^ERROR:',
    });
  });

  it('rejects empty on=[]', async () => {
    const tool = new JobNotifyTool();
    const subscribe = vi.fn();
    const jobManager = { subscribe } as unknown as JobManager;

    const result = await tool.execute(
      { jobId: 'job_1', on: [] },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('failed');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('teaches the job-vs-session distinction in its description', () => {
    const tool = new JobNotifyTool();
    // The description must teach: a delegate JOB is one round; a delegate
    // SESSION is the whole conversation. This is the load-bearing mental
    // model from PRI-1692.
    expect(tool.description).toMatch(/job/i);
    expect(tool.description).toMatch(/session/i);
    // Should point the agent at delegate(resume=...) for continuing a
    // conversation rather than waiting again.
    expect(tool.description).toMatch(/resume/i);
  });
});
