// ABOUTME: Tests for JobManager 200ms progress-batching window (PRI-1692 Phase 2)
// Verifies that bursty progress notifications coalesce into a single delivered
// notification carrying the latest preview, that a terminal-state fanout flushes
// any pending batch immediately, and that unsubscribe cancels pending timers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobManager } from '../job-manager';
import type { PendingJobNotification } from '../../server-types';

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

describe('JobManager 200ms progress batching (PRI-1692 Phase 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces 5 progress notifications fired inside one window into ONE delivery with the latest preview', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    const fallback = vi.fn();
    // Fixed-window batching: the first fanout arms the 200ms timer; later
    // fires within that window replace the buffer (latest preview wins).
    // 5 fires at 30ms intervals → all 5 land inside [t=0, t=200).
    for (let i = 0; i < 5; i++) {
      manager.fanout('job_1', 'progress', progressNotification('job_1', `tick-${i}`), fallback);
      vi.advanceTimersByTime(30);
    }
    // Advance past the window boundary so the timer flushes.
    vi.advanceTimersByTime(200);

    const queue = manager.getNotificationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('progress');
    expect(queue[0].preview).toBe('tick-4');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('does NOT deliver progress before the 200ms window elapses', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    manager.fanout('job_1', 'progress', progressNotification('job_1', 'p1'), vi.fn());
    vi.advanceTimersByTime(199);
    expect(manager.getNotificationQueue()).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(manager.getNotificationQueue()).toHaveLength(1);
  });

  it('terminal-state fanout flushes the pending progress batch immediately, then enqueues the terminal', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress', 'completed'] });

    const fallback = vi.fn();
    manager.fanout('job_1', 'progress', progressNotification('job_1', 'p1'), fallback);
    vi.advanceTimersByTime(30);
    manager.fanout('job_1', 'progress', progressNotification('job_1', 'p2'), fallback);
    vi.advanceTimersByTime(30);
    manager.fanout('job_1', 'progress', progressNotification('job_1', 'p3'), fallback);
    vi.advanceTimersByTime(30);

    expect(manager.getNotificationQueue()).toHaveLength(0); // batched, not flushed

    manager.fanout('job_1', 'completed', terminalNotification('job_1', 'completed'), fallback);

    // Without any further timer advance, the terminal must have flushed the
    // batch AND enqueued itself.
    const queue = manager.getNotificationQueue();
    expect(queue).toHaveLength(2);
    expect(queue[0].type).toBe('progress');
    expect(queue[0].preview).toBe('p3');
    expect(queue[1].type).toBe('completed');

    // No extra delivery later from the (now-cancelled) pending timer.
    vi.advanceTimersByTime(500);
    expect(manager.getNotificationQueue()).toHaveLength(2);
  });

  it('terminal flush works even when no progress was batched', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress', 'completed'] });

    const fallback = vi.fn();
    manager.fanout('job_1', 'completed', terminalNotification('job_1', 'completed'), fallback);

    const queue = manager.getNotificationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('completed');
  });

  it('a new batch window starts after the previous one flushes', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    manager.fanout('job_1', 'progress', progressNotification('job_1', 'p1'), vi.fn());
    vi.advanceTimersByTime(200);
    expect(manager.getNotificationQueue()).toHaveLength(1);

    manager.fanout('job_1', 'progress', progressNotification('job_1', 'p2'), vi.fn());
    vi.advanceTimersByTime(199);
    expect(manager.getNotificationQueue()).toHaveLength(1); // still one
    vi.advanceTimersByTime(1);
    expect(manager.getNotificationQueue()).toHaveLength(2);
    expect(manager.getNotificationQueue()[1].preview).toBe('p2');
  });

  it('unsubscribe cancels any pending batch timer (no late delivery)', () => {
    const manager = makeManager();
    const sub = manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    manager.fanout('job_1', 'progress', progressNotification('job_1', 'p1'), vi.fn());
    manager.unsubscribe(sub.subscriptionId);

    vi.advanceTimersByTime(500);
    expect(manager.getNotificationQueue()).toHaveLength(0);
  });

  it('clearJobs cancels pending batch timers', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    manager.fanout('job_1', 'progress', progressNotification('job_1', 'p1'), vi.fn());
    manager.clearJobs();

    vi.advanceTimersByTime(500);
    expect(manager.getNotificationQueue()).toHaveLength(0);
  });

  it('removeJob flushes pending batches (job-end reap delivers the last meaningful tail)', () => {
    // removeJob is called by JobManager.finalizeJob (cancel/kill path).
    // The buffered progress represents real work the agent asked for — flush
    // it to the queue rather than silently drop. Contrast with unsubscribe
    // above, which is explicit user intent to STOP receiving.
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    manager.fanout('job_1', 'progress', progressNotification('job_1', 'p1'), vi.fn());
    manager.removeJob('job_1');

    const queue = manager.getNotificationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].preview).toBe('p1');

    // Timer is gone — no late delivery on top.
    vi.advanceTimersByTime(500);
    expect(manager.getNotificationQueue()).toHaveLength(1);
  });

  it('multiple subscribers on the same job each get their own coalesced delivery', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });
    manager.subscribe({ jobId: 'job_1', on: ['progress'], filter: '^X' }); // distinct sub (different filter)

    // First progress matches both subs (only first carries no filter, second
    // requires ^X).
    manager.fanout('job_1', 'progress', progressNotification('job_1', 'X: a'), vi.fn());
    manager.fanout('job_1', 'progress', progressNotification('job_1', 'X: b'), vi.fn());

    vi.advanceTimersByTime(200);

    // Two subscriptions, each batched once → two queued notifications.
    const queue = manager.getNotificationQueue();
    expect(queue).toHaveLength(2);
    // Both should carry the latest preview ('X: b').
    expect(queue.every((n) => n.preview === 'X: b')).toBe(true);
  });

  it('back-compat: progress with NO subscribers still falls back to queue-push (unchanged)', () => {
    const manager = makeManager();
    const fallback = vi.fn();
    manager.fanout(
      'job_unsubscribed',
      'progress',
      progressNotification('job_unsubscribed', 'p1'),
      fallback
    );
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(manager.getNotificationQueue()).toHaveLength(0);
  });
});
