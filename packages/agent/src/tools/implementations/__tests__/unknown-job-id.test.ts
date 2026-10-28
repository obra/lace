// ABOUTME: Tests that the job tools answer an unknown jobId by naming the session's real,
// ABOUTME: most recent jobs. Agents retype ids from memory (after a compaction, or when a
// ABOUTME: call that returns an id is batched with the call that uses it), and a bare "not
// ABOUTME: found" leaves them guessing again instead of picking the id they meant.

import { describe, it, expect } from 'vitest';
import { JobOutputTool } from '../job_output';
import { JobKillTool } from '../job_kill';
import { JobNotifyTool } from '../job_notify';
import { uncitedJobIds, uncitedJobIdsMessage } from '../unknown-job-id';
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

// `todo_write`'s refusal for a cited-but-unknown job_<uuid> (PRI-3362). Unlike
// job_output/job_kill/job_notify's unknownJobIdMessage above, this refusal used
// to name no real ids at all, so a caller had to go fetch `jobs_list` separately
// to self-correct. It should list the same five-most-recent-first the other
// refusal does.
describe('uncitedJobIdsMessage', () => {
  const INVENTED_ID = 'job_8a0bfabf-1a19-4e0b-bc14-07e5e4ded12d';

  it('names the five most recent real jobs, newest first, like unknownJobIdMessage', () => {
    const text = uncitedJobIdsMessage('todo_write', [INVENTED_ID], HISTORY);

    expect(text).toContain(INVENTED_ID);
    const listed = ['job_newest', 'job_e', 'job_d', 'job_c', 'job_b'].map((id) => text.indexOf(id));
    expect(listed.every((i) => i >= 0)).toBe(true);
    expect([...listed].sort((a, b) => a - b)).toEqual(listed);
    expect(text).not.toContain('job_oldest');
    expect(text).toContain('File the attachment ticket');
  });

  it('says so plainly when the session has no jobs at all', () => {
    const text = uncitedJobIdsMessage('todo_write', [INVENTED_ID], []);

    expect(text).toContain('no jobs');
  });
});

// The id regex (`JOB_ID_TOKEN`) matches upper and lower case, but job ids
// themselves are always lower case (`randomUUID()`'s output is lower case).
// A model that cites a real id in a different case shouldn't be refused for
// it.
describe('uncitedJobIds case sensitivity', () => {
  const REAL_ID = 'job_a1b2c3d4-e5f6-47a8-89b0-c1d2e3f4a5b6';

  function jobManagerWith(realId: string) {
    return {
      getJob: (id: string) =>
        id === realId ? record(realId, '2026-10-10T00:00:00.000Z') : undefined,
      listJobs: () => [record(realId, '2026-10-10T00:00:00.000Z')],
    };
  }

  it('treats a cited id in a different case as known', () => {
    const citedUpper = REAL_ID.toUpperCase();
    const unknown = uncitedJobIds(`Watch ${citedUpper} for results`, jobManagerWith(REAL_ID));

    expect(unknown).toEqual([]);
  });

  it('still refuses a genuinely invented id regardless of case', () => {
    const inventedUpper = 'JOB_8A0BFABF-1A19-4E0B-BC14-07E5E4DED12D';
    const unknown = uncitedJobIds(`Watch ${inventedUpper} for results`, jobManagerWith(REAL_ID));

    expect(unknown).toEqual([inventedUpper]);
  });
});
