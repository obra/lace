// ABOUTME: Tests for JobManager subscriber-side filter regex (PRI-1692 Phase 2)
// Covers regex application to progress notifications, no-op on terminal-state
// kinds, multi-subscriber filter isolation, and invalid-regex rejection.
// After PRI-1744 the notification is delivered via an `inject` callback; the
// test spies on that callback to assert filter pass/drop behavior.

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

function recordedInject(calls: string[], tag: string): () => void {
  return () => {
    calls.push(tag);
  };
}

describe('JobManager filter regex (PRI-1692 Phase 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('filter on progress notifications', () => {
    it('drops a progress notification whose preview does not match the regex', () => {
      const manager = makeManager();
      manager.subscribe({
        jobId: 'job_1',
        on: ['progress'],
        filter: '^ERROR:',
      });

      const calls: string[] = [];
      manager.fanoutToInject(
        'job_1',
        'progress',
        { preview: 'info: ok' },
        recordedInject(calls, 'info')
      );

      // Flush any pending batch window — non-matching events must NOT inject.
      vi.advanceTimersByTime(500);

      expect(calls).toEqual([]);
    });

    it('delivers a progress notification whose preview matches the regex', () => {
      const manager = makeManager();
      manager.subscribe({
        jobId: 'job_1',
        on: ['progress'],
        filter: '^ERROR:',
      });

      const calls: string[] = [];
      manager.fanoutToInject(
        'job_1',
        'progress',
        { preview: 'ERROR: oops' },
        recordedInject(calls, 'ERROR: oops')
      );
      vi.advanceTimersByTime(500);

      expect(calls).toEqual(['ERROR: oops']);
    });

    it('regex uses multi-line matching so `^X` matches a line inside a multi-line preview', () => {
      const manager = makeManager();
      manager.subscribe({
        jobId: 'job_1',
        on: ['progress'],
        filter: '^ERROR:',
      });

      const calls: string[] = [];
      manager.fanoutToInject(
        'job_1',
        'progress',
        { preview: 'info: starting\nERROR: boom\ninfo: done' },
        recordedInject(calls, 'multi')
      );

      vi.advanceTimersByTime(500);
      expect(calls).toEqual(['multi']);
    });

    it('subscription without a filter delivers every progress notification', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['progress'] });

      const calls: string[] = [];
      manager.fanoutToInject(
        'job_1',
        'progress',
        { preview: 'info: ok' },
        recordedInject(calls, 'info')
      );

      vi.advanceTimersByTime(500);
      expect(calls).toEqual(['info']);
    });
  });

  describe('filter is no-op on terminal-state notifications', () => {
    it('filter that would not match still delivers a `failed` terminal notification', () => {
      const manager = makeManager();
      manager.subscribe({
        jobId: 'job_1',
        on: ['failed'],
        filter: '^X',
      });

      const calls: string[] = [];
      manager.fanoutToInject('job_1', 'failed', {}, recordedInject(calls, 'failed'));

      expect(calls).toEqual(['failed']);
    });

    it('filter is also no-op for `completed` and `cancelled`', () => {
      for (const kind of ['completed', 'cancelled'] as const) {
        const manager = makeManager();
        manager.subscribe({
          jobId: 'job_x',
          on: [kind],
          filter: '__never_matches__',
        });
        const calls: string[] = [];
        manager.fanoutToInject('job_x', kind, {}, recordedInject(calls, kind));
        expect(calls).toEqual([kind]);
      }
    });
  });

  describe('multiple subscriptions with distinct filters', () => {
    it('each subscriber receives only progress matching its own regex', () => {
      const manager = makeManager();
      // Subscriber A: only ERROR:
      manager.subscribe({ jobId: 'job_1', on: ['progress'], filter: '^ERROR:' });
      // Subscriber B: only WARN:
      manager.subscribe({ jobId: 'job_1', on: ['progress'], filter: '^WARN:' });

      const calls: string[] = [];
      manager.fanoutToInject(
        'job_1',
        'progress',
        { preview: 'ERROR: a' },
        recordedInject(calls, 'ERROR: a')
      );
      vi.advanceTimersByTime(500);
      manager.fanoutToInject(
        'job_1',
        'progress',
        { preview: 'WARN: b' },
        recordedInject(calls, 'WARN: b')
      );
      vi.advanceTimersByTime(500);
      manager.fanoutToInject(
        'job_1',
        'progress',
        { preview: 'info: c' },
        recordedInject(calls, 'info: c')
      );
      vi.advanceTimersByTime(500);

      // After all batching settles: subscriber A got 'ERROR: a',
      // subscriber B got 'WARN: b', and nobody got 'info: c'.
      expect(calls.slice().sort()).toEqual(['ERROR: a', 'WARN: b']);
    });
  });

  describe('invalid filter regex', () => {
    it('subscribe throws a clear error when the regex is invalid', () => {
      const manager = makeManager();
      expect(() =>
        manager.subscribe({
          jobId: 'job_bad',
          on: ['progress'],
          filter: '[invalid',
        })
      ).toThrow(/regex|filter/i);
    });

    it('rejection happens before any subscription is registered', () => {
      const manager = makeManager();
      try {
        manager.subscribe({ jobId: 'job_bad', on: ['progress'], filter: '[invalid' });
      } catch {
        // expected
      }
      // No subscription was registered → progress fanout falls back to a
      // single inject call.
      const calls: string[] = [];
      manager.fanoutToInject(
        'job_bad',
        'progress',
        { preview: 'ERROR: x' },
        recordedInject(calls, 'fallback')
      );
      expect(calls).toEqual(['fallback']);
    });
  });
});
