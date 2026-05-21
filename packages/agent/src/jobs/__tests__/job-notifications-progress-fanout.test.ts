// ABOUTME: Integration test for the createSetupProgressTimer → queueJobNotification
// → fanout path for `progress` notifications (PRI-1692 Phase 2). Spins up the
// real createQueueJobNotification factory used by server.ts and verifies that
// progress notifications route through the subscription registry, that the
// subscriber-side filter regex is applied against the preview text, and that
// jobs with no subscribers still fall back to the always-on queue-push
// (back-compat with Phase 1 + pre-PRI-1692).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobManager } from '../job-manager';
import { createQueueJobNotification } from '../job-notifications';
import type { AgentServerState, JobState } from '../../server-types';

function makeJobManager(): JobManager {
  return new JobManager({
    getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/sess' }),
    persistEvent: vi.fn(),
    emitUpdate: vi.fn(),
    runShellProcess: vi.fn(),
    runSubagentProcess: vi.fn(),
  });
}

function makeStateStub(jobManager: JobManager): AgentServerState {
  return {
    activeTurn: null,
    activeSession: { meta: { sessionId: 'sess_1' }, dir: '/tmp/sess' },
    jobManager,
  } as unknown as AgentServerState;
}

/**
 * createQueueJobNotification reads the on-disk job output to populate
 * `lastLines`, which becomes the filter target. Use a real tempfile so the
 * preview is actually populated.
 */
function makeJobStateWithOutput(jobId: string, outputDir: string, output: string): JobState {
  const outputPath = join(outputDir, `${jobId}.log`);
  writeFileSync(outputPath, output);
  return {
    jobId,
    type: 'bash',
    status: 'running',
    startedAt: new Date(Date.now() - 1000).toISOString(),
    outputPath,
    finished: false,
    completion: Promise.resolve(),
    resolveCompletion: () => {},
  } as JobState;
}

describe('progress fanout integration (PRI-1692 Phase 2)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lace-progress-fanout-'));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('subscribed progress routes through fanout and batches; filter is applied to the preview', () => {
    const jobManager = makeJobManager();
    const queueNotificationSpy = vi.spyOn(jobManager, 'queueNotification');

    // Subscribe to progress with a filter that matches "ERROR:" anywhere
    // (multi-line). Two fires: one with no ERROR (dropped by filter), one
    // with ERROR (passes filter, then coalesced through the 200ms window).
    jobManager.subscribe({
      jobId: 'job_p',
      on: ['progress'],
      filter: '^ERROR:',
    });

    const state = makeStateStub(jobManager);
    const queueJobNotification = createQueueJobNotification(state, { current: null });

    queueJobNotification(
      makeJobStateWithOutput('job_p', tmp, 'starting\ninfo: doing work\nstill working\n'),
      'progress',
      { deltaBytes: 30 }
    );
    queueJobNotification(
      makeJobStateWithOutput('job_p', tmp, 'starting\nERROR: bad thing happened\n'),
      'progress',
      { deltaBytes: 30 }
    );
    vi.advanceTimersByTime(250);

    // Back-compat fallback NOT called (subscription exists). Filter dropped
    // the first fire, the second one was batched and flushed after 200ms.
    expect(queueNotificationSpy).not.toHaveBeenCalled();
    const queue = jobManager.getNotificationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('progress');
    expect(queue[0].preview).toContain('ERROR: bad thing happened');
    // Wire shape preserved — content is the formatted XML block.
    expect(queue[0].content).toContain('<background-job-notification');
    expect(queue[0].content).toContain('type="progress"');
  });

  it('unsubscribed progress: back-compat queue-push fallback fires immediately (no batching)', () => {
    const jobManager = makeJobManager();
    const queueNotificationSpy = vi.spyOn(jobManager, 'queueNotification');

    // No subscription for this jobId.
    const state = makeStateStub(jobManager);
    const queueJobNotification = createQueueJobNotification(state, { current: null });

    queueJobNotification(makeJobStateWithOutput('job_unsub', tmp, 'line\n'), 'progress', {
      deltaBytes: 5,
    });

    // Fallback fires immediately — no 200ms wait, no fanout-driven batching.
    expect(queueNotificationSpy).toHaveBeenCalledTimes(1);
    const queue = jobManager.getNotificationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('progress');
    expect(queue[0].content).toContain('<background-job-notification');
  });
});
