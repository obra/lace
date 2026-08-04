// ABOUTME: Tests that job_notify refuses a jobId no job has ever had. Subscribing to a
// ABOUTME: nonexistent id returns subscribed:true and then stays silent forever, which is
// ABOUTME: indistinguishable from a job that is merely slow — an agent waiting on it waits
// ABOUTME: for a notification that can never arrive. A job that has already FINISHED is a
// ABOUTME: different case and must still be accepted: it loses the race, not the id.

import { describe, it, expect } from 'vitest';
import { JobNotifyTool } from '../job_notify';
import type { ToolContext } from '../../types';

type FakeManagerOpts = {
  liveJobIds?: string[];
  historicalJobIds?: string[];
};

function contextWith({ liveJobIds = [], historicalJobIds = [] }: FakeManagerOpts): ToolContext {
  const jobManager = {
    getJob: (jobId: string) => (liveJobIds.includes(jobId) ? { jobId } : undefined),
    listJobs: () => historicalJobIds.map((jobId) => ({ jobId })),
    subscribe: ({ jobId, on }: { jobId: string; on: readonly string[] }) => ({
      subscriptionId: 'sub_test',
      jobId,
      on: [...on],
    }),
  };
  return { signal: new AbortController().signal, jobManager } as unknown as ToolContext;
}

function textOf(result: { content: Array<Record<string, unknown>> }): string {
  return result.content.map((c) => (typeof c.text === 'string' ? c.text : '')).join('');
}

describe('job_notify unknown jobId', () => {
  it('refuses an id that matches no job, live or historical', async () => {
    // Cadence hit this three times by composing a jobId before `delegate`
    // returned — including with the literal string "placeholder".
    const result = await new JobNotifyTool().execute(
      { jobId: 'placeholder', on: ['completed'] },
      contextWith({ liveJobIds: ['job_real'], historicalJobIds: ['job_real'] })
    );

    expect(result.status).toBe('failed');
    expect(textOf(result)).toContain('placeholder');
  });

  it('accepts a live job', async () => {
    const result = await new JobNotifyTool().execute(
      { jobId: 'job_live', on: ['completed'] },
      contextWith({ liveJobIds: ['job_live'] })
    );

    expect(result.status).toBe('completed');
    expect(textOf(result)).toContain('"subscribed":true');
  });

  it('accepts a job that has already finished, rather than calling it unknown', async () => {
    // The job left the live map but the event log still knows it. Rejecting
    // here would turn an ordinary race into a phantom "no such job".
    const result = await new JobNotifyTool().execute(
      { jobId: 'job_done', on: ['completed'] },
      contextWith({ liveJobIds: [], historicalJobIds: ['job_done'] })
    );

    expect(result.status).toBe('completed');
  });
});
