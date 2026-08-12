// ABOUTME: listInterruptedJobs scopes to the latest crash generation: only jobs
// ABOUTME: started after the previous session-recovered marker are reported.

import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listInterruptedJobs } from '../job-derivation';

describe('listInterruptedJobs', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'interrupted-jobs-'));
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function appendEvents(events: object[]): void {
    appendFileSync(
      join(dir, 'events.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8'
    );
  }

  const recoveryMarker = {
    type: 'context_injected',
    timestamp: '2026-08-12T01:00:00.000Z',
    data: {
      content: [
        {
          type: 'text',
          text: '<notification kind="session-recovered">You just crashed.</notification>',
        },
      ],
      priority: 'immediate',
    },
  };

  it('reports a job left unfinished in the log', () => {
    appendEvents([
      {
        type: 'job_started',
        timestamp: '2026-08-12T00:00:00.000Z',
        data: { jobId: 'job_a', jobType: 'delegate', description: 'in flight' },
      },
    ]);

    const jobs = listInterruptedJobs(dir);
    expect(jobs.map((j) => j.jobId)).toEqual(['job_a']);
    expect(jobs[0].description).toBe('in flight');
  });

  it('excludes jobs that finished', () => {
    appendEvents([
      {
        type: 'job_started',
        timestamp: '2026-08-12T00:00:00.000Z',
        data: { jobId: 'job_a', jobType: 'bash' },
      },
      {
        type: 'job_finished',
        timestamp: '2026-08-12T00:01:00.000Z',
        data: { jobId: 'job_a', outcome: 'completed' },
      },
    ]);

    expect(listInterruptedJobs(dir)).toEqual([]);
  });

  it('excludes unfinished jobs from a previous crash generation', () => {
    appendEvents([
      // Crash generation 1: job_a was in flight, process died, next process
      // injected the session-recovered marker. job_a never gets a
      // job_finished — it must not be re-reported by later crashes.
      {
        type: 'job_started',
        timestamp: '2026-08-12T00:00:00.000Z',
        data: { jobId: 'job_a', jobType: 'delegate', description: 'old crash victim' },
      },
      recoveryMarker,
      // Crash generation 2: job_b in flight when the process died again.
      {
        type: 'job_started',
        timestamp: '2026-08-12T02:00:00.000Z',
        data: { jobId: 'job_b', jobType: 'bash', description: 'fresh crash victim' },
      },
    ]);

    const jobs = listInterruptedJobs(dir);
    expect(jobs.map((j) => j.jobId)).toEqual(['job_b']);
  });
});
