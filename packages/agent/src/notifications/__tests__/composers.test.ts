// ABOUTME: Unit tests for body composers — pure functions producing prose bodies
// ABOUTME: for each notification kind. Snapshots locked to the bodies in the spec.

import { describe, it, expect } from 'vitest';
import {
  composeAlarmFiredBody,
  composeJobCompletedBody,
  composeJobFailedBody,
  composeJobCancelledBody,
  composeJobProgressBody,
  composeSubagentExitedBody,
} from '../composers';

describe('composers', () => {
  it('alarm-fired: cron alarm', () => {
    expect(
      composeAlarmFiredBody({
        kind: 'cron',
        schedule: '0 9 * * *',
        timezone: 'America/Los_Angeles',
        prompt: 'Time to check the test status board',
      })
    ).toBe(
      'The cron alarm you scheduled (0 9 * * * in America/Los_Angeles) just fired. The note you left for your future self: "Time to check the test status board". Call list_alarms() to see other pending alarms.'
    );
  });

  it('alarm-fired: one-shot alarm', () => {
    expect(
      composeAlarmFiredBody({
        kind: 'once',
        schedule: '2026-05-22T17:00:00Z',
        timezone: 'UTC',
        prompt: 'Check the deploy',
      })
    ).toBe(
      'The one-shot alarm you scheduled for 2026-05-22T17:00:00Z just fired. The note you left for your future self: "Check the deploy". Call list_alarms() to see other pending alarms.'
    );
  });

  it('job-completed: shell exit 0', () => {
    expect(
      composeJobCompletedBody({
        jobId: 'job_xyz',
        jobType: 'bash',
        exitCode: 0,
        durationMs: 12300,
        outputBytes: 15234,
        lastLines: ['build finished in 5.2s'],
      })
    ).toBe(
      'Your background job completed successfully (exit code 0) after 12.3 seconds, writing 15,234 bytes of output. The last line was: "build finished in 5.2s". Call job_output(jobId="job_xyz") to read the full output.'
    );
  });

  it('job-completed: delegate adds resume hint', () => {
    const body = composeJobCompletedBody({
      jobId: 'job_xyz',
      jobType: 'delegate',
      exitCode: 0,
      durationMs: 12300,
      outputBytes: 15234,
      lastLines: ['ok'],
    });
    expect(body).toContain(
      'To continue this conversation thread, call delegate(resume="job_xyz", prompt="your message").'
    );
  });

  it('job-failed: includes exit code', () => {
    const body = composeJobFailedBody({
      jobId: 'job_q',
      jobType: 'bash',
      exitCode: 2,
      durationMs: 3000,
      outputBytes: 100,
      lastLines: ['error: thing went wrong'],
    });
    expect(body).toContain('exit code 2');
    expect(body).toContain('Call job_output(jobId="job_q")');
  });

  it('job-cancelled: includes reason', () => {
    const body = composeJobCancelledBody({
      jobId: 'job_q',
      jobType: 'bash',
      durationMs: 1500,
      outputBytes: 50,
      lastLines: [],
      reason: 'user requested cancel',
    });
    expect(body).toContain('was cancelled');
    expect(body).toContain('user requested cancel');
  });

  it('job-progress: includes delta + tail lines', () => {
    const body = composeJobProgressBody({
      jobId: 'job_xyz',
      durationMs: 5 * 60_000 + 12_000,
      outputBytes: 142_330,
      deltaBytes: 8_210,
      lastLines: ['building target...', 'built dist/cli.js in 3.1s', 'built dist/main.js in 5.2s'],
    });
    expect(body).toBe(
      'Your background job has been running for 5m 12.0s and has written 142,330 bytes (+8,210 since last update). Recent output:\n  building target...\n  built dist/cli.js in 3.1s\n  built dist/main.js in 5.2s\nCall job_output(jobId="job_xyz") to check current output.'
    );
  });

  it('subagent-exited: one pending alarm', () => {
    expect(
      composeSubagentExitedBody({
        persona: 'sen-box',
        pendingAlarms: [
          {
            id: 'alarm_z1z2',
            kind: 'once',
            schedule: '2026-05-22T17:00:00Z',
            prompt: 'Check on the running git operation',
          },
        ],
      })
    ).toBe(
      'Your sen-box subagent exited gracefully but had 1 pending alarm that won\'t fire now: alarm_z1z2 was a one-shot scheduled for 2026-05-22T17:00:00Z with the prompt "Check on the running git operation".'
    );
  });

  it('subagent-exited: multiple pending alarms', () => {
    const body = composeSubagentExitedBody({
      persona: 'sen-box',
      pendingAlarms: [
        { id: 'alarm_a', kind: 'once', schedule: '2026-05-22T17:00:00Z', prompt: 'A' },
        { id: 'alarm_b', kind: 'cron', schedule: '0 9 * * *', prompt: 'B' },
      ],
    });
    expect(body).toContain(
      "Your sen-box subagent exited gracefully but had 2 pending alarms that won't fire now:"
    );
    expect(body).toContain(
      '  alarm_a was a one-shot scheduled for 2026-05-22T17:00:00Z with the prompt "A".'
    );
    expect(body).toContain('  alarm_b was a cron (0 9 * * *) with the prompt "B".');
  });
});
