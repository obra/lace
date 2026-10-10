// ABOUTME: Tests that the job tools answer an unknown jobId by naming the session's real,
// ABOUTME: most recent jobs. Agents retype ids from memory (after a compaction, or when a
// ABOUTME: call that returns an id is batched with the call that uses it), and a bare "not
// ABOUTME: found" leaves them guessing again instead of picking the id they meant.

import { describe, it, expect } from 'vitest';
import { JobOutputTool } from '../job_output';
import { JobKillTool } from '../job_kill';
import { JobNotifyTool } from '../job_notify';
import type { ToolContext } from '../../types';
import type { JobRecord } from '../../../jobs/job-manager';

function record(jobId: string, startTime: string, description?: string): JobRecord {
  return {
    jobId,
    type: 'delegate',
    status: 'completed',
    startTime,
    ...(description !== undefined ? { description } : {}),
  };
}

const HISTORY: JobRecord[] = [
  record('job_oldest', '2026-10-10T01:00:00.000Z'),
  record('job_b', '2026-10-10T02:00:00.000Z'),
  record('job_c', '2026-10-10T03:00:00.000Z'),
  record('job_d', '2026-10-10T04:00:00.000Z'),
  record('job_e', '2026-10-10T05:00:00.000Z'),
  record('job_newest', '2026-10-10T06:00:00.000Z', 'File the attachment ticket'),
];

function contextWith(history: JobRecord[]): ToolContext {
  const jobManager = {
    getJob: () => undefined,
    listJobs: () => history,
    getJobOutput: () => '',
    subscribe: () => ({ subscriptionId: 'sub', jobId: 'x', on: [] }),
  };
  return { signal: new AbortController().signal, jobManager } as unknown as ToolContext;
}

function textOf(result: { content: Array<Record<string, unknown>> }): string {
  return result.content.map((c) => (typeof c.text === 'string' ? c.text : '')).join('');
}

const TOOLS = [
  ['job_output', () => new JobOutputTool(), { jobId: 'job_a84fa1bb' }],
  ['job_kill', () => new JobKillTool(), { jobId: 'job_a84fa1bb' }],
  ['job_notify', () => new JobNotifyTool(), { jobId: 'job_a84fa1bb', on: ['completed'] }],
] as const;

describe.each(TOOLS)('%s with a jobId no job has had', (_name, makeTool, args) => {
  it('names the five most recent real jobs, newest first', async () => {
    const result = await makeTool().execute(args, contextWith(HISTORY));
    const text = textOf(result);

    expect(result.status).toBe('failed');
    expect(text).toContain('job_a84fa1bb');
    const listed = ['job_newest', 'job_e', 'job_d', 'job_c', 'job_b'].map((id) => text.indexOf(id));
    expect(listed.every((i) => i >= 0)).toBe(true);
    expect([...listed].sort((a, b) => a - b)).toEqual(listed);
    expect(text).not.toContain('job_oldest');
    expect(text).toContain('File the attachment ticket');
  });

  it('tells the agent where real ids come from', async () => {
    const text = textOf(await makeTool().execute(args, contextWith(HISTORY)));

    expect(text).toMatch(/copy .*from .*tool result/i);
  });

  it('says so plainly when the session has no jobs at all', async () => {
    const text = textOf(await makeTool().execute(args, contextWith([])));

    expect(text).toContain('no jobs');
  });
});
