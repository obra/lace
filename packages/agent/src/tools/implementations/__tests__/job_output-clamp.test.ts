// ABOUTME: Tests that job_output(block=true) clamps short timeouts up to 120s
// (mirrors serf's minWaitTimeoutMS = 120_000). The reason: any timeout smaller
// than two minutes encourages rapid-retry polling; the design's wake-the-parent
// path is job_notify, not job_output(block=true).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { JobOutputTool } from '../job_output';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('JobOutputTool 120s blocking-wait minimum', () => {
  it('clamps a 1000ms blocking-wait request up to >= 120_000ms', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const completion = new Promise<void>(() => {
      /* never resolves */
    });
    const runningJob = {
      jobId: 'job_block',
      status: 'running' as const,
      completion,
    } as unknown as JobState;

    const jobManager = {
      getJob: vi.fn().mockReturnValue(runningJob),
      getJobOutput: vi.fn().mockReturnValue(''),
    } as unknown as JobManager;

    const tool = new JobOutputTool();

    // Fire the call but don't await it — we just want to inspect the timer
    // delay it scheduled. The Promise.race won't resolve because completion
    // never resolves and we never advance fake timers past the clamp.
    void tool.execute(
      { jobId: 'job_block', block: true, timeoutMs: 1000 },
      { signal: new AbortController().signal, jobManager }
    );

    // Microtask flush so the async body reaches its setTimeout call.
    await Promise.resolve();

    // The internal setTimeout that backs the blocking wait must have been
    // scheduled with at least the 120s minimum, regardless of timeoutMs=1000.
    const delaysScheduled = setTimeoutSpy.mock.calls.map(([, delay]) => delay as number);
    expect(delaysScheduled.some((d) => d >= 120_000)).toBe(true);
  });

  it('does not clamp UP a timeoutMs request larger than 120_000', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const completion = new Promise<void>(() => {
      /* never */
    });
    const runningJob = {
      jobId: 'job_block_long',
      status: 'running' as const,
      completion,
    } as unknown as JobState;

    const jobManager = {
      getJob: vi.fn().mockReturnValue(runningJob),
      getJobOutput: vi.fn().mockReturnValue(''),
    } as unknown as JobManager;

    const tool = new JobOutputTool();

    void tool.execute(
      { jobId: 'job_block_long', block: true, timeoutMs: 300_000 },
      { signal: new AbortController().signal, jobManager }
    );

    await Promise.resolve();

    // The 300s request should be honored as-is (the clamp is a minimum, not
    // a ceiling). Some setTimeout call should be scheduled for 300_000ms.
    const delaysScheduled = setTimeoutSpy.mock.calls.map(([, delay]) => delay as number);
    expect(delaysScheduled).toContain(300_000);
  });

  it('does not clamp when block=false (read-only mode)', async () => {
    const completedJob = {
      jobId: 'job_done',
      status: 'completed' as const,
      exitCode: 0,
      completion: Promise.resolve(),
    } as unknown as JobState;

    const jobManager = {
      getJob: vi.fn().mockReturnValue(completedJob),
      getJobOutput: vi.fn().mockReturnValue('done'),
    } as unknown as JobManager;

    const tool = new JobOutputTool();

    const result = await tool.execute(
      { jobId: 'job_done', block: false, timeoutMs: 0 },
      { signal: new AbortController().signal, jobManager }
    );
    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('done');
  });

  it('describes the 120s minimum in its tool description', () => {
    const tool = new JobOutputTool();
    expect(tool.description).toMatch(/120/);
    // Description must point at job_notify as the not-polling alternative.
    expect(tool.description).toMatch(/job_notify/);
  });
});
