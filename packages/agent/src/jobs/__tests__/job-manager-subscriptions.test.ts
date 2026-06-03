// ABOUTME: Tests for JobManager subscription registry
// Covers subscribe/unsubscribe/fanoutToInject for per-jobId terminal-state
// subscriptions. Fanout delivers via an `inject` callback that
// the caller wires to injectNotification; this test exercises the gating
// semantics by spying on that callback.

import { describe, it, expect, vi } from 'vitest';
import { JobManager } from '../job-manager';

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
      // With no subscribers, fanoutToInject invokes the inject callback once
      // as the always-on fallback.
      const inject = vi.fn();
      manager.fanoutToInject('job_1', 'completed', {}, inject);
      expect(inject).toHaveBeenCalledTimes(1);
    });
  });

  describe('fanoutToInject', () => {
    it('invokes inject exactly once when a single subscriber matches', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['completed', 'failed', 'cancelled'] });

      const inject = vi.fn();
      manager.fanoutToInject('job_1', 'completed', {}, inject);

      expect(inject).toHaveBeenCalledTimes(1);
    });

    it('once subscribed, an unmatched kind delivers nothing (no fallback)', () => {
      // Coverage-discipline contract from the design: subscribing with
      // on=['failed'] and watching a job complete successfully produces NO
      // notification. "Silence is not success." The always-on fallback is
      // suppressed as soon as ANY subscription exists for this jobId.
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['failed'] });

      const inject = vi.fn();
      manager.fanoutToInject('job_1', 'completed', {}, inject);

      expect(inject).not.toHaveBeenCalled();
    });

    it('fires subscriber when kind matches `on=["failed"]`', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['failed'] });

      const inject = vi.fn();
      manager.fanoutToInject('job_1', 'failed', {}, inject);

      expect(inject).toHaveBeenCalledTimes(1);
    });

    it('back-compat: with no subscribers, inject fires once as the fallback', () => {
      const manager = makeManager();
      const inject = vi.fn();
      manager.fanoutToInject('job_unsubscribed', 'completed', {}, inject);
      expect(inject).toHaveBeenCalledTimes(1);
    });

    it('fanout to a different jobId does not match other subscriptions', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_A', on: ['completed'] });

      const inject = vi.fn();
      manager.fanoutToInject('job_B', 'completed', {}, inject);

      // No subscriber for job_B → fallback fires.
      expect(inject).toHaveBeenCalledTimes(1);
    });

    it('default subscription on=[completed,failed,cancelled] receives all three terminal states', () => {
      for (const kind of ['completed', 'failed', 'cancelled'] as const) {
        const manager = makeManager();
        manager.subscribe({ jobId: 'job_x', on: ['completed', 'failed', 'cancelled'] });
        const inject = vi.fn();
        manager.fanoutToInject('job_x', kind, {}, inject);
        expect(inject).toHaveBeenCalledTimes(1);
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

      const inject = vi.fn();
      manager.fanoutToInject('job_1', 'completed', {}, inject);

      expect(inject).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanup on job removal', () => {
    it('removeJob(jobId) prunes all subscriptions for that jobId', () => {
      const manager = makeManager();
      const sub = manager.subscribe({ jobId: 'job_1', on: ['completed', 'failed', 'cancelled'] });
      manager.subscribe({ jobId: 'job_other', on: ['completed'] });

      manager.removeJob('job_1');

      // No subscription remains for job_1 → fallback fires.
      const inject = vi.fn();
      manager.fanoutToInject('job_1', 'completed', {}, inject);
      expect(inject).toHaveBeenCalledTimes(1);
      // Re-subscribing returns a fresh subscriptionId (the old one is gone).
      const fresh = manager.subscribe({
        jobId: 'job_1',
        on: ['completed', 'failed', 'cancelled'],
      });
      expect(fresh.subscriptionId).not.toBe(sub.subscriptionId);

      // Other jobs' subscriptions are unaffected — exactly one inject for the
      // matching subscriber.
      const inject2 = vi.fn();
      manager.fanoutToInject('job_other', 'completed', {}, inject2);
      expect(inject2).toHaveBeenCalledTimes(1);
    });

    it('clearJobs() prunes every subscription across all jobs', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_a', on: ['completed'] });
      manager.subscribe({ jobId: 'job_b', on: ['failed'] });

      manager.clearJobs();

      const injectA = vi.fn();
      const injectB = vi.fn();
      manager.fanoutToInject('job_a', 'completed', {}, injectA);
      manager.fanoutToInject('job_b', 'failed', {}, injectB);
      // Both jobs' subscriptions are gone → fallback for each.
      expect(injectA).toHaveBeenCalledTimes(1);
      expect(injectB).toHaveBeenCalledTimes(1);
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

      const inject = vi.fn();
      manager.fanoutToInject('job_finalize', 'cancelled', {}, inject);
      // Subscription is gone → fallback inject fires.
      expect(inject).toHaveBeenCalledTimes(1);
    });
  });
});
