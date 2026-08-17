// ABOUTME: jobs_list carries the interruptedByLatestRestart flag through to the
// ABOUTME: agent, so "did I lose work?" is answerable without doing timestamp
// ABOUTME: arithmetic against every restart in the box's history.

import { describe, it, expect } from 'vitest';
import { JobsListTool } from '../jobs_list';
import type { ToolContext } from '../../types';
import type { JobRecord } from '../../../jobs/job-manager';

const records: JobRecord[] = [
  {
    jobId: 'job_residue',
    type: 'delegate',
    status: 'interrupted',
    description: 'orphaned months ago',
    startTime: '2026-05-29T00:00:00.000Z',
    interruptedByLatestRestart: false,
  },
  {
    jobId: 'job_fresh',
    type: 'delegate',
    status: 'interrupted',
    description: 'orphaned by the deploy just now',
    startTime: '2026-08-17T00:00:00.000Z',
    interruptedByLatestRestart: true,
  },
  {
    jobId: 'job_done',
    type: 'bash',
    status: 'completed',
    description: 'finished cleanly',
    startTime: '2026-08-17T00:01:00.000Z',
  },
];

async function listed(): Promise<Array<Record<string, unknown>>> {
  const context = { jobManager: { listJobs: () => records } } as unknown as ToolContext;
  const result = await new JobsListTool().execute({ limit: 50 }, context);
  const text = result.content.map((c) => ('text' in c ? c.text : '')).join('');
  return JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) as Array<
    Record<string, unknown>
  >;
}

describe('jobs_list interrupted recency', () => {
  it('reports which interrupted jobs the latest restart killed', async () => {
    const byId = new Map((await listed()).map((j) => [j.jobId as string, j]));

    expect(byId.get('job_fresh')?.interruptedByLatestRestart).toBe(true);
    expect(byId.get('job_residue')?.interruptedByLatestRestart).toBe(false);
  });

  it('omits the flag for jobs that were never interrupted', async () => {
    const byId = new Map((await listed()).map((j) => [j.jobId as string, j]));

    expect(byId.get('job_done')).not.toHaveProperty('interruptedByLatestRestart');
  });

  it('tells the agent what the flag means', async () => {
    expect(new JobsListTool().description).toContain('interruptedByLatestRestart');
  });
});
