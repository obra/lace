// ABOUTME: Tests for JobManager subscription registry (PRI-1692 Phase 1)
// Covers subscribe/unsubscribe/fanout for per-jobId terminal-state subscriptions.

import { describe, it, expect, vi } from 'vitest';
import { JobManager } from '../job-manager';
import type { PendingJobNotification } from '../../server-types';

function makeManager() {
  const deps = {
    getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
    persistEvent: vi.fn(),
    emitUpdate: vi.fn(),
    runShellProcess: vi.fn(),
    runSubagentProcess: vi.fn(),
  };
  return new JobManager(deps);
}

function makeNotification(
  jobId: string,
  type: PendingJobNotification['type']
): PendingJobNotification {
  return {
    jobId,
    type,
    content: `<background-job-notification job-id="${jobId}" type="${type}"></background-job-notification>`,
    createdAt: Date.now(),
  };
}

describe('JobManager subscriptions', () => {
  describe('subscribe / unsubscribe', () => {
    it('registers a subscription and returns a subscription id', () => {
      const manager = makeManager();
      const sub = manager.subscribe({
        jobId: 'job_1',
        on: ['completed', 'failed', 'cancelled'],
      });
      expect(sub.subscriptionId).toMatch(/^sub_/);
      expect(sub.jobId).toBe('job_1');
      expect(sub.on).toEqual(['completed', 'failed', 'cancelled']);
    });

    it('is idempotent: subscribing twice with identical args reuses the subscription', () => {
      const manager = makeManager();
      const a = manager.subscribe({ jobId: 'job_1', on: ['completed', 'failed', 'cancelled'] });
      const b = manager.subscribe({ jobId: 'job_1', on: ['completed', 'failed', 'cancelled'] });
      expect(a.subscriptionId).toBe(b.subscriptionId);
    });

    it('unsubscribe removes a subscription so it no longer matches fanouts', () => {
      const manager = makeManager();
      const sub = manager.subscribe({ jobId: 'job_1', on: ['completed', 'failed', 'cancelled'] });
      manager.unsubscribe(sub.subscriptionId);
      // Fanout to a job with no subscribers should fall back to the always-on
      // queue-push (provided by the fallback fn) — see fanout tests below.
      const fallback = vi.fn();
      manager.fanout('job_1', 'completed', makeNotification('job_1', 'completed'), fallback);
      // Queue should contain the fallback notification (back-compat), not a
      // subscriber notification. Easiest assertion: fallback got called.
      expect(fallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('fanout', () => {
    it('delivers exactly one notification to the agent queue when a subscriber matches', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['completed', 'failed', 'cancelled'] });

      const fallback = vi.fn();
      manager.fanout('job_1', 'completed', makeNotification('job_1', 'completed'), fallback);

      // Subscriber-driven notification went on the queue; fallback NOT called.
      expect(fallback).not.toHaveBeenCalled();
      const queue = manager.getNotificationQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].type).toBe('completed');
      expect(queue[0].jobId).toBe('job_1');
    });

    it('once subscribed, an unmatched kind delivers nothing (no fallback)', () => {
      // Coverage-discipline contract from the design: subscribing with
      // on=['failed'] and watching a job complete successfully produces NO
      // notification. "Silence is not success." The back-compat fallback is
      // suppressed as soon as ANY subscription exists for this jobId.
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['failed'] });

      const fallback = vi.fn();
      manager.fanout('job_1', 'completed', makeNotification('job_1', 'completed'), fallback);

      expect(fallback).not.toHaveBeenCalled();
      expect(manager.getNotificationQueue()).toHaveLength(0);
    });

    it('fires subscriber when kind matches `on=["failed"]`', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['failed'] });

      const fallback = vi.fn();
      manager.fanout('job_1', 'failed', makeNotification('job_1', 'failed'), fallback);

      expect(fallback).not.toHaveBeenCalled();
      expect(manager.getNotificationQueue()).toHaveLength(1);
      expect(manager.getNotificationQueue()[0].type).toBe('failed');
    });

    it('back-compat: with no subscribers, invokes the fallback (always-on queue-push)', () => {
      const manager = makeManager();
      const fallback = vi.fn();
      manager.fanout(
        'job_unsubscribed',
        'completed',
        makeNotification('job_unsubscribed', 'completed'),
        fallback
      );
      expect(fallback).toHaveBeenCalledTimes(1);
      // Subscriber path didn't queue anything.
      expect(manager.getNotificationQueue()).toHaveLength(0);
    });

    it('fanout to a different jobId does not affect other subscriptions', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_A', on: ['completed'] });

      const fallback = vi.fn();
      manager.fanout('job_B', 'completed', makeNotification('job_B', 'completed'), fallback);

      // No subscriber for job_B → fallback fires.
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(manager.getNotificationQueue()).toHaveLength(0);
    });

    it('default subscription on=[completed,failed,cancelled] receives all three terminal states', () => {
      for (const kind of ['completed', 'failed', 'cancelled'] as const) {
        const manager = makeManager();
        manager.subscribe({ jobId: 'job_x', on: ['completed', 'failed', 'cancelled'] });
        const fallback = vi.fn();
        manager.fanout('job_x', kind, makeNotification('job_x', kind), fallback);
        expect(fallback).not.toHaveBeenCalled();
        expect(manager.getNotificationQueue()[0].type).toBe(kind);
      }
    });

    it('filter is accepted but no-op on terminal-state kinds (Phase 1)', () => {
      const manager = makeManager();
      // Filter that would never match the content text — should still deliver
      // because Phase 1 ignores filter for terminal states.
      manager.subscribe({
        jobId: 'job_1',
        on: ['completed', 'failed', 'cancelled'],
        filter: '__never_matches__',
      });

      const fallback = vi.fn();
      manager.fanout('job_1', 'completed', makeNotification('job_1', 'completed'), fallback);

      expect(fallback).not.toHaveBeenCalled();
      expect(manager.getNotificationQueue()).toHaveLength(1);
    });
  });

  describe('cleanup on job removal', () => {
    it('removeJob(jobId) prunes all subscriptions for that jobId', () => {
      const manager = makeManager();
      const sub = manager.subscribe({ jobId: 'job_1', on: ['completed', 'failed', 'cancelled'] });
      manager.subscribe({ jobId: 'job_other', on: ['completed'] });

      manager.removeJob('job_1');

      // No subscription remains for job_1 → fallback fires.
      const fallback = vi.fn();
      manager.fanout('job_1', 'completed', makeNotification('job_1', 'completed'), fallback);
      expect(fallback).toHaveBeenCalledTimes(1);
      // Re-subscribing returns a fresh subscriptionId (the old one is gone).
      const fresh = manager.subscribe({
        jobId: 'job_1',
        on: ['completed', 'failed', 'cancelled'],
      });
      expect(fresh.subscriptionId).not.toBe(sub.subscriptionId);

      // Other jobs' subscriptions are unaffected.
      const fallback2 = vi.fn();
      manager.fanout(
        'job_other',
        'completed',
        makeNotification('job_other', 'completed'),
        fallback2
      );
      expect(fallback2).not.toHaveBeenCalled();
    });

    it('clearJobs() prunes every subscription across all jobs', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_a', on: ['completed'] });
      manager.subscribe({ jobId: 'job_b', on: ['failed'] });

      manager.clearJobs();

      const fallback = vi.fn();
      manager.fanout('job_a', 'completed', makeNotification('job_a', 'completed'), fallback);
      manager.fanout('job_b', 'failed', makeNotification('job_b', 'failed'), fallback);
      // Both jobs' subscriptions are gone → fallback for each.
      expect(fallback).toHaveBeenCalledTimes(2);
    });

    it('finalizeJob() prunes subscriptions for the finalized job', async () => {
      // The internal JobManager.finalizeJob path (used by cancelJob) removes
      // a job from the in-memory map; subscriptions should not outlive it.
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_finalize', on: ['cancelled'] });

      const job = {
        jobId: 'job_finalize',
        type: 'bash',
        status: 'cancelled',
        startedAt: new Date().toISOString(),
        outputPath: '/tmp/job.log',
        finished: false,
        completion: Promise.resolve(),
        resolveCompletion: () => {},
      } as Parameters<typeof manager.finalizeJob>[0];
      manager.addJob(job);

      await manager.finalizeJob(job);

      const fallback = vi.fn();
      manager.fanout(
        'job_finalize',
        'cancelled',
        makeNotification('job_finalize', 'cancelled'),
        fallback
      );
      expect(fallback).toHaveBeenCalledTimes(1);
    });
  });
});
