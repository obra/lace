// ABOUTME: Tests for JobManager 200ms progress-batching window
// Verifies that bursty progress fanouts coalesce into a single inject call per
// subscription, that a terminal-state fanout flushes any pending batch
// immediately, and that unsubscribe cancels pending timers. The
// notification is delivered via an `inject` callback (one per matching sub),
// not pushed onto an in-memory queue.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobManager } from '../job-manager';

function makeManager(): JobManager {
  return new JobManager({
    getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
    persistEvent: vi.fn(),
    emitUpdate: vi.fn(),
    runShellProcess: vi.fn(),
    runSubagentProcess: vi.fn(),
  });
}

/**
 * A test helper that tracks every inject call with an attached tag. The
 * batching contract is "latest preview wins" — we tag each fanout with the
 * preview string so the order/identity of fired injects is visible.
 */
function recordedInject(calls: string[], tag: string): () => void {
  return () => {
    calls.push(tag);
  };
}

describe('JobManager 200ms progress batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces 5 progress fanouts fired inside one window into ONE inject with the latest preview', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    const calls: string[] = [];
    // Fixed-window batching: the first fanout arms the 200ms timer; later
    // fires within that window replace the buffered closure (latest preview
    // wins). 5 fires at 30ms intervals → all 5 land inside [t=0, t=200).
    for (let i = 0; i < 5; i++) {
      manager.fanoutToInject(
        'job_1',
        'progress',
        { preview: `tick-${i}` },
        recordedInject(calls, `tick-${i}`)
      );
      vi.advanceTimersByTime(30);
    }
    // Advance past the window boundary so the timer flushes.
    vi.advanceTimersByTime(200);

    // Exactly one inject fired, carrying the latest closure's tag.
    expect(calls).toEqual(['tick-4']);
  });

  it('does NOT inject before the 200ms window elapses', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    const calls: string[] = [];
    manager.fanoutToInject('job_1', 'progress', { preview: 'p1' }, recordedInject(calls, 'p1'));
    vi.advanceTimersByTime(199);
    expect(calls).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['p1']);
  });

  it('terminal-state fanout flushes the pending progress batch immediately, then injects the terminal', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress', 'completed'] });

    const calls: string[] = [];
    manager.fanoutToInject('job_1', 'progress', { preview: 'p1' }, recordedInject(calls, 'p1'));
    vi.advanceTimersByTime(30);
    manager.fanoutToInject('job_1', 'progress', { preview: 'p2' }, recordedInject(calls, 'p2'));
    vi.advanceTimersByTime(30);
    manager.fanoutToInject('job_1', 'progress', { preview: 'p3' }, recordedInject(calls, 'p3'));
    vi.advanceTimersByTime(30);

    expect(calls).toEqual([]); // batched, not flushed

    manager.fanoutToInject('job_1', 'completed', {}, recordedInject(calls, 'terminal'));

    // Without any further timer advance, the terminal must have flushed the
    // batch (latest tag 'p3') AND injected itself.
    expect(calls).toEqual(['p3', 'terminal']);

    // No extra inject later from the (now-cancelled) pending timer.
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(['p3', 'terminal']);
  });

  it('terminal flush works even when no progress was batched', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress', 'completed'] });

    const calls: string[] = [];
    manager.fanoutToInject('job_1', 'completed', {}, recordedInject(calls, 'terminal'));

    expect(calls).toEqual(['terminal']);
  });

  it('a new batch window starts after the previous one flushes', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    const calls: string[] = [];
    manager.fanoutToInject('job_1', 'progress', { preview: 'p1' }, recordedInject(calls, 'p1'));
    vi.advanceTimersByTime(200);
    expect(calls).toEqual(['p1']);

    manager.fanoutToInject('job_1', 'progress', { preview: 'p2' }, recordedInject(calls, 'p2'));
    vi.advanceTimersByTime(199);
    expect(calls).toEqual(['p1']); // still one
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['p1', 'p2']);
  });

  it('unsubscribe cancels any pending batch timer (no late delivery)', () => {
    const manager = makeManager();
    const sub = manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    const calls: string[] = [];
    manager.fanoutToInject('job_1', 'progress', { preview: 'p1' }, recordedInject(calls, 'p1'));
    manager.unsubscribe(sub.subscriptionId);

    vi.advanceTimersByTime(500);
    expect(calls).toEqual([]);
  });

  it('clearJobs cancels pending batch timers', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    const calls: string[] = [];
    manager.fanoutToInject('job_1', 'progress', { preview: 'p1' }, recordedInject(calls, 'p1'));
    manager.clearJobs();

    vi.advanceTimersByTime(500);
    expect(calls).toEqual([]);
  });

  it('removeJob flushes pending batches (job-end reap delivers the last meaningful tail)', () => {
    // removeJob is called by JobManager.finalizeJob (cancel/kill path).
    // The buffered progress represents the most recent meaningful tail — flush
    // it so the agent doesn't lose 0–200ms of work to teardown. Contrast with
    // unsubscribe above, which is explicit user intent to STOP receiving.
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });

    const calls: string[] = [];
    manager.fanoutToInject('job_1', 'progress', { preview: 'p1' }, recordedInject(calls, 'p1'));
    manager.removeJob('job_1');

    expect(calls).toEqual(['p1']);

    // Timer is gone — no late inject on top.
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(['p1']);
  });

  it('multiple subscribers on the same job each get their own coalesced inject', () => {
    const manager = makeManager();
    manager.subscribe({ jobId: 'job_1', on: ['progress'] });
    manager.subscribe({ jobId: 'job_1', on: ['progress'], filter: '^X' }); // distinct sub (different filter)

    const calls: string[] = [];
    // Both progress fanouts match both subs (first sub has no filter; second
    // sub requires '^X', which both 'X: a' and 'X: b' match).
    manager.fanoutToInject('job_1', 'progress', { preview: 'X: a' }, recordedInject(calls, 'X: a'));
    manager.fanoutToInject('job_1', 'progress', { preview: 'X: b' }, recordedInject(calls, 'X: b'));

    vi.advanceTimersByTime(200);

    // Two subscriptions, each batched once → two inject calls. Both carry
    // the latest tag ('X: b') because the second fanout replaced both
    // buffered closures.
    expect(calls).toEqual(['X: b', 'X: b']);
  });

  it('back-compat: progress with NO subscribers still falls back to a single inject (unchanged)', () => {
    const manager = makeManager();
    const calls: string[] = [];
    manager.fanoutToInject(
      'job_unsubscribed',
      'progress',
      { preview: 'p1' },
      recordedInject(calls, 'p1')
    );
    expect(calls).toEqual(['p1']);
  });
});
