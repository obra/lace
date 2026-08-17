// ABOUTME: listJobs tags each interrupted job with whether the restart that just
// ABOUTME: happened is what killed it. Without that flag a job orphaned thirty
// ABOUTME: seconds ago is indistinguishable from months-old residue, and a list
// ABOUTME: that only grows teaches an agent to ignore the one view that catches
// ABOUTME: lost work.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JobManager } from '../job-manager';

describe('interrupted job restart generation', () => {
  let testDir: string | null = null;

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
      testDir = null;
    }
  });

  /** The notice a restarting process injects; the crash-generation boundary. */
  function recoveryMarker(timestamp: string): object {
    return {
      type: 'context_injected',
      timestamp,
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
  }

  function jobStarted(jobId: string, timestamp: string): object {
    return {
      type: 'job_started',
      timestamp,
      data: { jobId, jobType: 'delegate', description: jobId },
    };
  }

  function managerFor(events: object[]): JobManager {
    testDir = mkdtempSync(join(tmpdir(), 'interrupted-generation-'));
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));

    // An empty in-memory map is the post-restart state: every log-running job
    // reads as interrupted.
    return new JobManager({
      getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: testDir }),
      persistEvent: vi.fn(),
      emitUpdate: vi.fn(),
      runShellProcess: vi.fn(),
      runSubagentProcess: vi.fn(),
    });
  }

  function flagsById(manager: JobManager): Record<string, boolean | undefined> {
    return Object.fromEntries(
      manager.listJobs().map((j) => [j.jobId, j.interruptedByLatestRestart])
    );
  }

  it('separates the jobs the latest restart killed from older residue', () => {
    // Three generations of the same box. job_old died two restarts ago and was
    // already reported then; job_fresh is what the restart that JUST happened
    // took down.
    const manager = managerFor([
      jobStarted('job_ancient', '2026-05-29T00:00:00.000Z'),
      recoveryMarker('2026-08-11T00:00:00.000Z'),
      jobStarted('job_old', '2026-08-12T00:00:00.000Z'),
      recoveryMarker('2026-08-16T00:00:00.000Z'),
      jobStarted('job_fresh', '2026-08-16T01:00:00.000Z'),
      recoveryMarker('2026-08-17T00:00:00.000Z'),
    ]);

    expect(flagsById(manager)).toEqual({
      job_ancient: false,
      job_old: false,
      job_fresh: true,
    });
  });

  it('flags a job orphaned before the session ever recorded a restart', () => {
    // First crash this session has seen: the marker the current process wrote
    // is the only one, so everything before it belongs to the process that
    // just died.
    const manager = managerFor([
      jobStarted('job_a', '2026-08-17T00:00:00.000Z'),
      recoveryMarker('2026-08-17T00:05:00.000Z'),
    ]);

    expect(flagsById(manager)).toEqual({ job_a: true });
  });

  it('leaves the flag off jobs that are not interrupted', () => {
    const manager = managerFor([
      jobStarted('job_done', '2026-08-12T00:00:00.000Z'),
      {
        type: 'job_finished',
        timestamp: '2026-08-12T00:01:00.000Z',
        data: { jobId: 'job_done', outcome: 'completed' },
      },
      recoveryMarker('2026-08-17T00:00:00.000Z'),
    ]);

    const jobs = manager.listJobs();
    expect(jobs.map((j) => j.status)).toEqual(['completed']);
    expect(jobs[0]).not.toHaveProperty('interruptedByLatestRestart');
  });

  it('does not treat injected text that merely quotes the marker as a restart', () => {
    // A Slack message pasting the marker string must not open a generation.
    // If it did, this job — which the restart that just happened killed —
    // would be counted a generation behind and demoted to residue.
    const manager = managerFor([
      jobStarted('job_fresh', '2026-08-16T01:00:00.000Z'),
      {
        type: 'context_injected',
        timestamp: '2026-08-16T02:00:00.000Z',
        data: {
          content: [
            {
              type: 'text',
              text: '<notification kind="slack-message">someone pasted kind="session-recovered" in chat</notification>',
            },
          ],
        },
      },
      recoveryMarker('2026-08-17T00:00:00.000Z'),
    ]);

    expect(flagsById(manager)).toEqual({ job_fresh: true });
  });

  it('keeps the flag across the listJobs cache', () => {
    // listJobs caches the parsed records and re-derives status on every call;
    // the flag has to survive that path, not just the cold parse.
    const manager = managerFor([
      jobStarted('job_old', '2026-08-12T00:00:00.000Z'),
      recoveryMarker('2026-08-16T00:00:00.000Z'),
      jobStarted('job_fresh', '2026-08-16T01:00:00.000Z'),
      recoveryMarker('2026-08-17T00:00:00.000Z'),
    ]);

    manager.listJobs();
    expect(flagsById(manager)).toEqual({ job_old: false, job_fresh: true });
  });

  it('does not flag a job the current process is still running', () => {
    const manager = managerFor([
      jobStarted('job_old', '2026-08-12T00:00:00.000Z'),
      recoveryMarker('2026-08-17T00:00:00.000Z'),
      jobStarted('job_live', '2026-08-17T01:00:00.000Z'),
    ]);
    manager.addJob({
      jobId: 'job_live',
      type: 'delegate',
      status: 'running',
      startedAt: '2026-08-17T01:00:00.000Z',
      outputPath: join(testDir!, 'job_live.log'),
      finished: false,
      completion: Promise.resolve(),
      resolveCompletion: () => {},
    });

    const jobs = manager.listJobs();
    const live = jobs.find((j) => j.jobId === 'job_live');
    expect(live?.status).toBe('running');
    expect(live).not.toHaveProperty('interruptedByLatestRestart');
  });
});
