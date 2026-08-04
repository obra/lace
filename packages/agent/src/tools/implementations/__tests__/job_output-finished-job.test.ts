// ABOUTME: Tests that job_output can still read a FINISHED job's output. A finished job is
// ABOUTME: deleted from the live jobs map, but its output file and its job_finished event
// ABOUTME: both persist — so resolving only from the map reports "not found" for a job whose
// ABOUTME: output is sitting on disk. Ada lost two investigations to this: 51KB and 42KB of
// ABOUTME: findings were recoverable while the tool insisted the jobs did not exist.

import { describe, it, expect } from 'vitest';
import { JobOutputTool } from '../job_output';
import type { ToolContext } from '../../types';
import type { JobRecord } from '../../../jobs/job-manager';

type FakeOpts = {
  liveJobs?: Record<string, { status: string; exitCode?: number }>;
  historical?: JobRecord[];
  outputs?: Record<string, string>;
};

function contextWith({ liveJobs = {}, historical = [], outputs = {} }: FakeOpts): ToolContext {
  const jobManager = {
    getJob: (jobId: string) => liveJobs[jobId],
    listJobs: () => historical,
    getJobOutput: (jobId: string) => outputs[jobId] ?? '',
  };
  return { signal: new AbortController().signal, jobManager } as unknown as ToolContext;
}

async function run(ctx: ToolContext, jobId: string) {
  const result = await new JobOutputTool().execute({ jobId }, ctx);
  const text = result.content.map((c) => ('text' in c ? String(c.text) : '')).join('');
  return { result, text };
}

function record(jobId: string, status: JobRecord['status']): JobRecord {
  return { jobId, type: 'delegate', status, startTime: '2026-08-03T21:12:05.253Z' };
}

describe('job_output for a job no longer in the live map', () => {
  it('returns the persisted output of a finished job instead of "not found"', async () => {
    const { result, text } = await run(
      contextWith({
        historical: [record('job_3304fcfe', 'failed')],
        outputs: { job_3304fcfe: 'partial findings from the killed worker' },
      }),
      'job_3304fcfe'
    );

    expect(result.status).toBe('completed');
    expect(text).toContain('partial findings from the killed worker');
    expect(text).toContain('failed');
  });

  it('still reports not found for a job that never existed', async () => {
    const { result, text } = await run(
      contextWith({ historical: [record('job_real', 'completed')] }),
      'job_never'
    );

    expect(result.status).toBe('failed');
    expect(text).toContain('job_never');
  });

  it('prefers the live job when one exists', async () => {
    const { result, text } = await run(
      contextWith({
        liveJobs: { job_live: { status: 'running' } },
        outputs: { job_live: 'output so far' },
      }),
      'job_live'
    );

    expect(result.status).toBe('completed');
    expect(text).toContain('running');
    expect(text).toContain('output so far');
  });

  it('reports a finished job with no output rather than failing', async () => {
    // Killed before writing anything: the honest answer is "it ended, empty",
    // not "no such job".
    const { result, text } = await run(
      contextWith({ historical: [record('job_empty', 'failed')] }),
      'job_empty'
    );

    expect(result.status).toBe('completed');
    expect(text).toContain('(no output)');
  });
});
