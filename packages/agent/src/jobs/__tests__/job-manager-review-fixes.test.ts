// ABOUTME: Regression tests for the issues surfaced in adversarial review of
// the Phase 2 progress fanout:
//  - terminal fanout must flush every pending progress batch for the jobId,
//    even on subs whose `on` doesn't include the terminal kind (otherwise a
//    progress-only sub fires a stale post-terminal phantom);
//  - clearSubscriptionsForJob (cancel/kill/session-close) must FLUSH pending
//    batches rather than silently drop them.
// Also covers the (jobId, on, filter)-identity contract: same args reuse,
// any differing field creates a new sub (the brief's multi-subscriber/
// multi-filter test case relies on this).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobManager } from '../job-manager';
import type { JobState } from '../../server-types';

function makeManager(): JobManager {
  return new JobManager({
    getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
    persistEvent: vi.fn(),
    emitUpdate: vi.fn(),
    runShellProcess: vi.fn(),
    runSubagentProcess: vi.fn(),
  });
}

function recordedInject(calls: string[], tag: string): () => void {
  return () => {
    calls.push(tag);
  };
}

function makeRunningJob(jobId: string): JobState {
  return {
    jobId,
    type: 'bash',
    status: 'running',
    startedAt: new Date().toISOString(),
    outputPath: `/tmp/${jobId}.log`,
    finished: false,
    completion: Promise.resolve(),
    resolveCompletion: () => {},
  } as JobState;
}

describe('JobManager review-driven fixes (Phase 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('terminal fanout flushes ALL pending batches for the jobId (A1/B2)', () => {
    it('a progress-only sub does NOT get a stale post-terminal phantom delivery', () => {
      // Two subs on the same job: A is progress-only, B is terminal-only.
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['progress'] });
      manager.subscribe({ jobId: 'job_1', on: ['completed', 'failed', 'cancelled'] });

      const calls: string[] = [];
      // Progress fires — sub A buffers a batch (200ms timer armed).
      manager.fanoutToInject('job_1', 'progress', { preview: 'p1' }, recordedInject(calls, 'p1'));
      vi.advanceTimersByTime(50);
      // Terminal fires for the job.
      manager.fanoutToInject('job_1', 'completed', {}, recordedInject(calls, 'terminal'));

      // Before any further timer advance: sub A's batch must have been
      // flushed by the terminal fanout (so progress lands before terminal),
      // and sub B injected the terminal.
      expect(calls).toEqual(['p1', 'terminal']);

      // No phantom inject 200ms later — the pending batch must have been
      // cancelled by the flush, not just delivered-and-then-rearmed.
      vi.advanceTimersByTime(500);
      expect(calls).toEqual(['p1', 'terminal']);
    });

    it('progress-only sub still receives buffered progress even when only OTHER sub gets the terminal', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['progress'], filter: '^MATCH' });
      manager.subscribe({ jobId: 'job_1', on: ['completed'] });

      const calls: string[] = [];
      manager.fanoutToInject(
        'job_1',
        'progress',
        { preview: 'MATCH: only thing that matters' },
        recordedInject(calls, 'MATCH')
      );
      manager.fanoutToInject('job_1', 'completed', {}, recordedInject(calls, 'completed'));

      // Progress sub's MATCH event was real, filtered-through, and buffered.
      // Terminal flushes it. Both subs see their respective notifications.
      expect(calls).toEqual(['MATCH', 'completed']);
    });

    it('terminal fanout against a job with no batched progress does nothing extra', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['completed', 'failed', 'cancelled'] });

      const calls: string[] = [];
      manager.fanoutToInject('job_1', 'completed', {}, recordedInject(calls, 'completed'));

      expect(calls).toEqual(['completed']);
    });
  });

  describe('clearSubscriptionsForJob flushes pending batches on job-end (B1)', () => {
    it('finalizeJob flushes pending progress batches before reaping subs', async () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['progress'] });

      const calls: string[] = [];
      manager.fanoutToInject(
        'job_1',
        'progress',
        { preview: 'last meaningful tail' },
        recordedInject(calls, 'last meaningful tail')
      );

      // Simulate cancel/kill path: finalizeJob → clearSubscriptionsForJob.
      const job = makeRunningJob('job_1');
      manager.addJob(job);
      job.status = 'cancelled';
      await manager.finalizeJob(job);

      // The buffered progress was meaningful tail data — it must inject so
      // the agent doesn't lose 0–200ms of work, not be silently discarded.
      expect(calls).toEqual(['last meaningful tail']);

      // No late inject after subs are gone.
      vi.advanceTimersByTime(500);
      expect(calls).toEqual(['last meaningful tail']);
    });

    it('explicit unsubscribe still CANCELS the batch (not flush) — explicit teardown drops in-flight data', () => {
      const manager = makeManager();
      const sub = manager.subscribe({ jobId: 'job_1', on: ['progress'] });

      const calls: string[] = [];
      manager.fanoutToInject('job_1', 'progress', { preview: 'p1' }, recordedInject(calls, 'p1'));
      manager.unsubscribe(sub.subscriptionId);

      vi.advanceTimersByTime(500);
      // Explicit unsubscribe is intent to stop receiving — don't deliver
      // the half-batched event. (Contrast with job-end above.)
      expect(calls).toEqual([]);
    });
  });

  describe('subscription identity: (jobId, on, filter) tuple (closes B4 test gap)', () => {
    it('same (jobId, on, filter) returns the SAME subscriptionId (idempotent)', () => {
      const manager = makeManager();
      const first = manager.subscribe({
        jobId: 'job_1',
        on: ['progress'],
        filter: '^ERROR:',
      });
      const second = manager.subscribe({
        jobId: 'job_1',
        on: ['progress'],
        filter: '^ERROR:',
      });
      expect(second.subscriptionId).toBe(first.subscriptionId);
      expect(second.filter).toBe('^ERROR:');
    });

    it('same (jobId, on) but DIFFERENT filter creates a NEW subscription', () => {
      // The brief's multi-subscriber test relies on this — two subs with
      // distinct filters on the same job each fire only for their own
      // matching events.
      const manager = makeManager();
      const first = manager.subscribe({
        jobId: 'job_1',
        on: ['progress'],
        filter: '^ERROR:',
      });
      const second = manager.subscribe({
        jobId: 'job_1',
        on: ['progress'],
        filter: '^FATAL:',
      });
      expect(second.subscriptionId).not.toBe(first.subscriptionId);
    });

    it('same (jobId, on) with vs without filter creates two distinct subscriptions', () => {
      const manager = makeManager();
      const filtered = manager.subscribe({
        jobId: 'job_1',
        on: ['progress'],
        filter: '^ERROR:',
      });
      const unfiltered = manager.subscribe({ jobId: 'job_1', on: ['progress'] });
      expect(unfiltered.subscriptionId).not.toBe(filtered.subscriptionId);
    });
  });
});
