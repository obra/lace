// ABOUTME: Integration test for the createFinalizeJob → fanout → notification-queue
// path (PRI-1692 Acceptance #5). Spins up a real JobManager and the real
// createQueueJobNotification factory used in production by server.ts, then
// verifies that subscribers receive the <background-job-notification> block
// via the fanout path while unsubscribed jobs still get it via the back-compat
// queue-push fallback. Wire shape stays identical between the two paths.

import { describe, it, expect, vi } from 'vitest';
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

function makeJobState(jobId: string): JobState {
  return {
    jobId,
    type: 'delegate',
    status: 'completed',
    startedAt: new Date(Date.now() - 5000).toISOString(),
    outputPath: `/tmp/nonexistent-${jobId}.log`,
    finished: false,
    completion: Promise.resolve(),
    resolveCompletion: () => {},
  } as JobState;
}

/**
 * Minimal AgentServerState stub. createQueueJobNotification only touches
 * activeTurn, activeSession, and jobManager; the rest can stay undefined
 * for the duration of the test.
 */
function makeStateStub(jobManager: JobManager): AgentServerState {
  return {
    activeTurn: null,
    activeSession: { meta: { sessionId: 'sess_1' }, dir: '/tmp/sess' },
    jobManager,
  } as unknown as AgentServerState;
}

describe('createFinalizeJob → fanout integration (PRI-1692 Acceptance #5)', () => {
  it('subscribed jobId: completion routes through fanout (subscriber path), NOT through queue-push fallback', () => {
    const jobManager = makeJobManager();
    const queueNotificationSpy = vi.spyOn(jobManager, 'queueNotification');

    // Subscribe to terminal states for this job.
    jobManager.subscribe({
      jobId: 'job_subscribed',
      on: ['completed', 'failed', 'cancelled'],
    });

    const state = makeStateStub(jobManager);
    const queueJobNotification = createQueueJobNotification(state, { current: null });

    queueJobNotification(makeJobState('job_subscribed'), 'completed');

    // Subscriber path queued the notification directly (no queueNotification
    // call, because the fanout fallback was suppressed).
    expect(queueNotificationSpy).not.toHaveBeenCalled();

    const queue = jobManager.getNotificationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].jobId).toBe('job_subscribed');
    expect(queue[0].type).toBe('completed');
    // Wire shape: <background-job-notification> block (the same format the
    // unsubscribed path produces — see next test).
    expect(queue[0].content).toContain('<background-job-notification');
    expect(queue[0].content).toContain('job-id="job_subscribed"');
    expect(queue[0].content).toContain('type="completed"');
  });

  it('unsubscribed jobId: completion routes through the back-compat queue-push fallback', () => {
    const jobManager = makeJobManager();
    const queueNotificationSpy = vi.spyOn(jobManager, 'queueNotification');

    // No subscription for this jobId.

    const state = makeStateStub(jobManager);
    const queueJobNotification = createQueueJobNotification(state, { current: null });

    queueJobNotification(makeJobState('job_unsubscribed'), 'completed');

    // Fallback path → exactly one queueNotification call.
    expect(queueNotificationSpy).toHaveBeenCalledTimes(1);

    const queue = jobManager.getNotificationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].jobId).toBe('job_unsubscribed');
    expect(queue[0].type).toBe('completed');
    // Same wire shape as the subscriber path → back-compat preserved.
    expect(queue[0].content).toContain('<background-job-notification');
    expect(queue[0].content).toContain('job-id="job_unsubscribed"');
    expect(queue[0].content).toContain('type="completed"');
  });

  it('subscribed with on=[failed] only, a successful completion is SILENT (no fallback)', () => {
    // Coverage-discipline contract from the design, exercised end-to-end
    // through createQueueJobNotification: once subscribed, the back-compat
    // fallback is suppressed for unmatched kinds.
    const jobManager = makeJobManager();
    const queueNotificationSpy = vi.spyOn(jobManager, 'queueNotification');
    jobManager.subscribe({ jobId: 'job_silent', on: ['failed'] });

    const state = makeStateStub(jobManager);
    const queueJobNotification = createQueueJobNotification(state, { current: null });

    queueJobNotification(makeJobState('job_silent'), 'completed');

    expect(queueNotificationSpy).not.toHaveBeenCalled();
    expect(jobManager.getNotificationQueue()).toHaveLength(0);
  });
});
