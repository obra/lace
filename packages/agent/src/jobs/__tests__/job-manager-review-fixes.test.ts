// ABOUTME: Regression tests for the issues surfaced in adversarial review of
// PRI-1692 Phase 2:
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
import type { JobState, PendingJobNotification } from '../../server-types';

function makeManager(): JobManager {
  return new JobManager({
    getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
    persistEvent: vi.fn(),
    emitUpdate: vi.fn(),
    runShellProcess: vi.fn(),
    runSubagentProcess: vi.fn(),
  });
}

function progressNotification(jobId: string, preview: string): PendingJobNotification {
  return {
    jobId,
    type: 'progress',
    content: `<background-job-notification job-id="${jobId}" type="progress">\n${preview}\n</background-job-notification>`,
    createdAt: Date.now(),
    preview,
  };
}

function terminalNotification(
  jobId: string,
  type: 'completed' | 'failed' | 'cancelled'
): PendingJobNotification {
  return {
    jobId,
    type,
    content: `<background-job-notification job-id="${jobId}" type="${type}"></background-job-notification>`,
    createdAt: Date.now(),
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

describe('JobManager review-driven fixes (PRI-1692 Phase 2)', () => {
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

      const fallback = vi.fn();
      // Progress fires — sub A buffers a batch (200ms timer armed).
      manager.fanout('job_1', 'progress', progressNotification('job_1', 'p1'), fallback);
      vi.advanceTimersByTime(50);
      // Terminal fires for the job.
      manager.fanout('job_1', 'completed', terminalNotification('job_1', 'completed'), fallback);

      // Before any further timer advance: sub A's batch must have been
      // flushed by the terminal fanout (so progress lands before terminal),
      // and sub B has the terminal queued.
      const queue = manager.getNotificationQueue();
      expect(queue).toHaveLength(2);
      expect(queue[0].type).toBe('progress');
      expect(queue[0].preview).toBe('p1');
      expect(queue[1].type).toBe('completed');

      // No phantom delivery 200ms later — the pending batch must have been
      // cancelled by the flush, not just delivered-and-then-rearmed.
      vi.advanceTimersByTime(500);
      expect(manager.getNotificationQueue()).toHaveLength(2);
    });

    it('progress-only sub still receives buffered progress even when only OTHER sub gets the terminal', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['progress'], filter: '^MATCH' });
      manager.subscribe({ jobId: 'job_1', on: ['completed'] });

      manager.fanout(
        'job_1',
        'progress',
        progressNotification('job_1', 'MATCH: only thing that matters'),
        vi.fn()
      );
      manager.fanout('job_1', 'completed', terminalNotification('job_1', 'completed'), vi.fn());

      const queue = manager.getNotificationQueue();
      // Progress sub's MATCH event was real, filtered-through, and buffered.
      // Terminal flushes it. Both subs see their respective notifications.
      expect(queue.map((n) => n.type)).toEqual(['progress', 'completed']);
      expect(queue[0].preview).toContain('MATCH');
    });

    it('terminal fanout against a job with no batched progress does nothing extra', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['completed', 'failed', 'cancelled'] });

      manager.fanout('job_1', 'completed', terminalNotification('job_1', 'completed'), vi.fn());

      const queue = manager.getNotificationQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].type).toBe('completed');
    });
  });

  describe('clearSubscriptionsForJob flushes pending batches on job-end (B1)', () => {
    it('finalizeJob flushes pending progress batches to the queue before reaping subs', async () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['progress'] });

      manager.fanout(
        'job_1',
        'progress',
        progressNotification('job_1', 'last meaningful tail'),
        vi.fn()
      );

      // Simulate cancel/kill path: finalizeJob → clearSubscriptionsForJob.
      const job = makeRunningJob('job_1');
      manager.addJob(job);
      job.status = 'cancelled';
      await manager.finalizeJob(job);

      // The buffered progress was meaningful tail data — it must land in
      // the queue so the agent doesn't lose 0–200ms of work, not be
      // silently discarded.
      const queue = manager.getNotificationQueue();
      const progressEntries = queue.filter((n) => n.type === 'progress');
      expect(progressEntries).toHaveLength(1);
      expect(progressEntries[0].preview).toBe('last meaningful tail');

      // No late delivery after subs are gone.
      vi.advanceTimersByTime(500);
      const afterAdvance = manager.getNotificationQueue();
      expect(afterAdvance.filter((n) => n.type === 'progress')).toHaveLength(1);
    });

    it('explicit unsubscribe still CANCELS the batch (not flush) — explicit teardown drops in-flight data', () => {
      const manager = makeManager();
      const sub = manager.subscribe({ jobId: 'job_1', on: ['progress'] });

      manager.fanout('job_1', 'progress', progressNotification('job_1', 'p1'), vi.fn());
      manager.unsubscribe(sub.subscriptionId);

      vi.advanceTimersByTime(500);
      // Explicit unsubscribe is intent to stop receiving — don't deliver
      // the half-batched event. (Contrast with job-end above.)
      expect(manager.getNotificationQueue()).toHaveLength(0);
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
