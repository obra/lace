// ABOUTME: Tests for JobManager subscriber-side filter regex (PRI-1692 Phase 2)
// Covers regex application to progress notifications, no-op on terminal-state
// kinds, multi-subscriber filter isolation, and invalid-regex rejection.
// These tests are batching-agnostic — they only assert the eventual outcome
// (after a long-enough timer advance) so they remain green whether or not
// the 200ms batching window has been implemented yet.

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

      const fallback = vi.fn();
      manager.fanout('job_1', 'progress', progressNotification('job_1', 'info: ok'), fallback);

      // Flush any pending batch window — non-matching events must NOT deliver.
      vi.advanceTimersByTime(500);

      // Regex did not match → subscriber sees nothing.
      // Fallback also does NOT fire (subscription exists; we don't fall back
      // to queue-push just because the filter dropped the event).
      expect(fallback).not.toHaveBeenCalled();
      expect(manager.getNotificationQueue()).toHaveLength(0);
    });

    it('delivers a progress notification whose preview matches the regex', () => {
      const manager = makeManager();
      manager.subscribe({
        jobId: 'job_1',
        on: ['progress'],
        filter: '^ERROR:',
      });

      const fallback = vi.fn();
      manager.fanout('job_1', 'progress', progressNotification('job_1', 'ERROR: oops'), fallback);
      vi.advanceTimersByTime(500);

      expect(fallback).not.toHaveBeenCalled();
      const queue = manager.getNotificationQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].type).toBe('progress');
      expect(queue[0].preview).toBe('ERROR: oops');
    });

    it('regex uses multi-line matching so `^X` matches a line inside a multi-line preview', () => {
      const manager = makeManager();
      manager.subscribe({
        jobId: 'job_1',
        on: ['progress'],
        filter: '^ERROR:',
      });

      const fallback = vi.fn();
      manager.fanout(
        'job_1',
        'progress',
        progressNotification('job_1', 'info: starting\nERROR: boom\ninfo: done'),
        fallback
      );

      vi.advanceTimersByTime(500);
      expect(manager.getNotificationQueue()).toHaveLength(1);
      expect(fallback).not.toHaveBeenCalled();
    });

    it('subscription without a filter delivers every progress notification', () => {
      const manager = makeManager();
      manager.subscribe({ jobId: 'job_1', on: ['progress'] });

      const fallback = vi.fn();
      manager.fanout('job_1', 'progress', progressNotification('job_1', 'info: ok'), fallback);

      vi.advanceTimersByTime(500);
      expect(manager.getNotificationQueue()).toHaveLength(1);
      expect(fallback).not.toHaveBeenCalled();
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

      const fallback = vi.fn();
      manager.fanout('job_1', 'failed', terminalNotification('job_1', 'failed'), fallback);

      expect(fallback).not.toHaveBeenCalled();
      const queue = manager.getNotificationQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].type).toBe('failed');
    });

    it('filter is also no-op for `completed` and `cancelled`', () => {
      for (const kind of ['completed', 'cancelled'] as const) {
        const manager = makeManager();
        manager.subscribe({
          jobId: 'job_x',
          on: [kind],
          filter: '__never_matches__',
        });
        const fallback = vi.fn();
        manager.fanout('job_x', kind, terminalNotification('job_x', kind), fallback);
        expect(fallback).not.toHaveBeenCalled();
        expect(manager.getNotificationQueue()).toHaveLength(1);
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

      const fallback = vi.fn();
      manager.fanout('job_1', 'progress', progressNotification('job_1', 'ERROR: a'), fallback);
      vi.advanceTimersByTime(500);
      manager.fanout('job_1', 'progress', progressNotification('job_1', 'WARN: b'), fallback);
      vi.advanceTimersByTime(500);
      manager.fanout('job_1', 'progress', progressNotification('job_1', 'info: c'), fallback);
      vi.advanceTimersByTime(500);

      // After all batching settles: subscriber A got 'ERROR: a',
      // subscriber B got 'WARN: b', and nobody got 'info: c'.
      const queue = manager.getNotificationQueue();
      const previews = queue.map((n) => n.preview).sort();
      expect(previews).toEqual(['ERROR: a', 'WARN: b']);
      expect(fallback).not.toHaveBeenCalled();
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
      // No subscription was registered → progress fanout falls back.
      const fallback = vi.fn();
      manager.fanout('job_bad', 'progress', progressNotification('job_bad', 'ERROR: x'), fallback);
      expect(fallback).toHaveBeenCalledTimes(1);
    });
  });
});
