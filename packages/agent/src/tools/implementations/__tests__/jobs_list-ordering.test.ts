// ABOUTME: Tests that jobs_list returns the NEWEST jobs and says so when it truncates.
// ABOUTME: A long-lived session accumulates hundreds of jobs; returning the oldest N
// ABOUTME: makes recent work unreachable and indistinguishable from a job that never
// ABOUTME: ran — which is how three killed workers looked like they had vanished.

import { describe, it, expect } from 'vitest';
import { JobsListTool } from '../jobs_list';
import type { ToolContext } from '../../types';
import type { JobRecord } from '../../../jobs/job-manager';

/** N job records in ascending start order, as listJobs() derives them from the event log. */
function jobsOldestFirst(count: number): JobRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    jobId: `job_${String(i).padStart(4, '0')}`,
    type: 'delegate' as const,
    status: 'completed' as const,
    description: `job number ${i}`,
    startTime: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  }));
}

function contextWith(jobs: JobRecord[]): ToolContext {
  return { jobManager: { listJobs: () => jobs } } as unknown as ToolContext;
}

async function run(tool: JobsListTool, jobs: JobRecord[], args: Record<string, unknown> = {}) {
  const result = await tool.execute({ limit: 50, ...args }, contextWith(jobs));
  const text = result.content.map((c) => ('text' in c ? c.text : '')).join('');
  // The payload is the JSON array; a truncation note (when present) follows it.
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  return { result, text, jobs: JSON.parse(json) as Array<{ jobId: string }> };
}

describe('jobs_list ordering', () => {
  it('returns the most recent jobs, not the oldest, when over the limit', async () => {
    // Ada's core session held 444 jobs. At limit=50 the oldest-first slice
    // returned jobs from May and nothing from that night, so her in-flight
    // delegates were absent from jobs_list entirely.
    const { jobs } = await run(new JobsListTool(), jobsOldestFirst(444));

    expect(jobs).toHaveLength(50);
    expect(jobs[0]!.jobId).toBe('job_0443'); // newest first
    expect(jobs.at(-1)!.jobId).toBe('job_0394');
  });

  it('says how many jobs it withheld rather than truncating silently', async () => {
    const { text } = await run(new JobsListTool(), jobsOldestFirst(444));
    expect(text).toContain('444');
  });

  it('adds no truncation note when everything fits', async () => {
    const { text, jobs } = await run(new JobsListTool(), jobsOldestFirst(3));
    expect(jobs).toHaveLength(3);
    expect(text).not.toMatch(/older|withheld|truncat/i);
  });

  it('applies the limit AFTER filtering, so a filter cannot be starved', async () => {
    // One running job among 400 completed ones must be reachable: filtering
    // before slicing is what makes `status:["running"]` a useful probe.
    const all = jobsOldestFirst(400);
    all[10] = { ...all[10]!, status: 'running' };
    const { jobs } = await run(new JobsListTool(), all, { status: ['running'] });

    expect(jobs.map((j) => j.jobId)).toEqual(['job_0010']);
  });
});
