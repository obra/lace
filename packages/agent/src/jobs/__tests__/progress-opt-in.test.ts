// ABOUTME: PRI-1707 — progressIntervalMs is opt-in. The progress timer is
// only armed when (a) the operator passes an explicit progressIntervalMs on
// job creation, OR (b) a subscriber registers with `on` containing 'progress'.
// When the last progress subscriber leaves an unconfigured job, the timer
// stops. These tests pin that lifecycle and ensure default delegate jobs do
// not firehose progress notifications when nobody is listening.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobManager, type JobManagerDeps } from '../job-manager';
import type { JobState } from '../../server-types';

function createDeps(overrides: Partial<JobManagerDeps> = {}): JobManagerDeps {
  return {
    getActiveSession: vi.fn().mockReturnValue({ sessionId: 'sess_1', dir: '/tmp/test-session' }),
    persistEvent: vi.fn().mockResolvedValue(undefined),
    emitUpdate: vi.fn().mockResolvedValue(undefined),
    runShellProcess: vi.fn(),
    runSubagentProcess: vi.fn(),
    ...overrides,
  };
}

/**
 * Fake setupProgressTimer that actually arms a real (fake-timer-backed)
 * interval and writes it to job.progressTimer, exactly like the real
 * createSetupProgressTimer wiring. Lets us assert both on call counts AND
 * on whether the timer is cleared after subscriber teardown.
 */
function makeSetupProgressTimer(): ReturnType<typeof vi.fn> {
  return vi.fn((job: JobState) => {
    const interval = job.progressIntervalMs ?? 300000;
    job.progressTimer = setInterval(() => {}, interval);
  });
}

describe('progress timer opt-in (PRI-1707)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not arm progress timer for a default delegate job with no subscribers', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', { prompt: 'do work' });
    const job = manager.getJob(result.jobId)!;

    // Advance 10 minutes — well past the old 5min default cadence. Without
    // explicit opt-in (no subscribers, no progressIntervalMs), the timer
    // factory must not have been invoked and no interval is armed.
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(setupProgressTimer).not.toHaveBeenCalled();
    expect(job.progressTimer).toBeUndefined();
  });

  it('arms the progress timer when subscribe(on=["progress"]) lands after job start', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', { prompt: 'do work' });
    const job = manager.getJob(result.jobId)!;
    expect(setupProgressTimer).not.toHaveBeenCalled();

    manager.subscribe({ jobId: result.jobId, on: ['progress'] });

    expect(setupProgressTimer).toHaveBeenCalledOnce();
    expect(setupProgressTimer.mock.calls[0][0]).toBe(job);
    expect(job.progressTimer).toBeDefined();
  });

  it('does not arm the timer when subscribe only covers terminal kinds', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', { prompt: 'do work' });
    manager.subscribe({ jobId: result.jobId, on: ['completed', 'failed', 'cancelled'] });

    expect(setupProgressTimer).not.toHaveBeenCalled();
    expect(manager.getJob(result.jobId)!.progressTimer).toBeUndefined();
  });

  it('does not double-arm when a second progress subscriber arrives', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', { prompt: 'do work' });
    manager.subscribe({ jobId: result.jobId, on: ['progress'] });
    manager.subscribe({ jobId: result.jobId, on: ['progress'], filter: 'x' });

    expect(setupProgressTimer).toHaveBeenCalledOnce();
  });

  it('stops the timer when the last progress subscriber unsubscribes', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', { prompt: 'do work' });
    const job = manager.getJob(result.jobId)!;
    const sub1 = manager.subscribe({ jobId: result.jobId, on: ['progress'] });
    const sub2 = manager.subscribe({ jobId: result.jobId, on: ['progress'], filter: 'x' });

    manager.unsubscribe(sub1.subscriptionId);
    expect(job.progressTimer).toBeDefined(); // still one progress sub

    manager.unsubscribe(sub2.subscriptionId);
    expect(job.progressTimer).toBeUndefined();
  });

  it('re-arms the timer when a new progress subscriber arrives after the last one left', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', { prompt: 'do work' });
    const sub = manager.subscribe({ jobId: result.jobId, on: ['progress'] });
    manager.unsubscribe(sub.subscriptionId);
    expect(setupProgressTimer).toHaveBeenCalledTimes(1);

    manager.subscribe({ jobId: result.jobId, on: ['progress'] });

    expect(setupProgressTimer).toHaveBeenCalledTimes(2);
    expect(manager.getJob(result.jobId)!.progressTimer).toBeDefined();
  });

  it('keeps the timer armed when only-terminal subs remain after a progress sub leaves', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', { prompt: 'do work' });
    const job = manager.getJob(result.jobId)!;
    const progressSub = manager.subscribe({ jobId: result.jobId, on: ['progress'] });
    manager.subscribe({ jobId: result.jobId, on: ['completed'] });
    expect(job.progressTimer).toBeDefined();

    manager.unsubscribe(progressSub.subscriptionId);

    // The other sub doesn't watch progress, so the timer should stop.
    expect(job.progressTimer).toBeUndefined();
  });

  it('arms the timer at job creation when operator passes explicit progressIntervalMs', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', {
      prompt: 'do work',
      progressIntervalMs: 60000,
    });
    const job = manager.getJob(result.jobId)!;

    expect(setupProgressTimer).toHaveBeenCalledOnce();
    expect(job.progressIntervalMs).toBe(60000);
    expect(job.progressTimer).toBeDefined();
  });

  it('does not re-arm timer or stop it for operator-configured jobs when subscribers come and go', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', {
      prompt: 'do work',
      progressIntervalMs: 60000,
    });
    const job = manager.getJob(result.jobId)!;
    expect(setupProgressTimer).toHaveBeenCalledTimes(1);

    const sub = manager.subscribe({ jobId: result.jobId, on: ['progress'] });
    // Already armed by the operator — do not double-arm.
    expect(setupProgressTimer).toHaveBeenCalledTimes(1);

    manager.unsubscribe(sub.subscriptionId);
    // Operator-configured cadence outlives subscriber churn.
    expect(job.progressTimer).toBeDefined();
  });

  it('clears the progress timer when the job is removed via removeJob', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', { prompt: 'do work' });
    const job = manager.getJob(result.jobId)!;
    manager.subscribe({ jobId: result.jobId, on: ['progress'] });
    expect(job.progressTimer).toBeDefined();

    manager.removeJob(result.jobId);

    expect(job.progressTimer).toBeUndefined();
  });

  it('clears the progress timer on clearJobs() (session close)', async () => {
    const setupProgressTimer = makeSetupProgressTimer();
    const manager = new JobManager(createDeps({ setupProgressTimer }));

    const result = await manager.createJob('delegate', { prompt: 'do work' });
    const job = manager.getJob(result.jobId)!;
    manager.subscribe({ jobId: result.jobId, on: ['progress'] });
    expect(job.progressTimer).toBeDefined();

    manager.clearJobs();

    expect(job.progressTimer).toBeUndefined();
  });
});
