// ABOUTME: Unit tests for body composers — pure functions producing prose bodies
// ABOUTME: for each notification kind. Snapshots locked to the bodies in the spec.

import { describe, it, expect } from 'vitest';
import {
  composeAlarmFiredBody,
  composeAlarmExpiredBody,
  composeJobCompletedBody,
  composeJobFailedBody,
  composeJobCancelledBody,
  composeJobProgressBody,
  composeSubagentExitedBody,
} from '../composers';

describe('composeAlarmFiredBody', () => {
  it('once-absolute: ISO time + zone', () => {
    expect(
      composeAlarmFiredBody({
        kind: 'once-absolute',
        scheduledFor: Date.parse('2026-12-25T17:00:00Z'), // 09:00 PST on this date
        timezone: 'America/Los_Angeles',
        prompt: 'Check the deploy',
        alarmId: 'alarm_abs1',
      })
    ).toBe(
      'Your alarm for 2026-12-25T09:00:00-08:00 (America/Los_Angeles) just fired. Note: "Check the deploy".'
    );
  });

  it('once-relative: pluralized correctly', () => {
    expect(
      composeAlarmFiredBody({
        kind: 'once-relative',
        minutes: 5,
        prompt: 'Stretch your legs',
        alarmId: 'alarm_rel1',
      })
    ).toBe('Your 5-minute timer just fired. Note: "Stretch your legs".');
  });

  it('once-relative: 1 minute', () => {
    expect(
      composeAlarmFiredBody({
        kind: 'once-relative',
        minutes: 1,
        prompt: 'Now',
        alarmId: 'alarm_rel2',
      })
    ).toBe('Your 1-minute timer just fired. Note: "Now".');
  });

  it('cron: includes alarm id in body', () => {
    expect(
      composeAlarmFiredBody({
        kind: 'cron',
        expr: '0 9 * * *',
        timezone: 'America/Los_Angeles',
        prompt: 'Time to check the test status board',
        alarmId: 'alarm_cron1',
      })
    ).toBe(
      'Your cron alarm alarm_cron1 (0 9 * * * in America/Los_Angeles) just fired. Note: "Time to check the test status board".'
    );
  });

  it('interval: plural minutes (>1)', () => {
    expect(
      composeAlarmFiredBody({
        kind: 'interval',
        minutes: 73,
        prompt: 'Ping the team',
        alarmId: 'alarm_int1',
      })
    ).toBe('Your interval alarm alarm_int1 (every 73 minutes) just fired. Note: "Ping the team".');
  });

  it('interval: singular minute (1)', () => {
    expect(
      composeAlarmFiredBody({
        kind: 'interval',
        minutes: 1,
        prompt: 'Heartbeat',
        alarmId: 'alarm_int2',
      })
    ).toBe('Your interval alarm alarm_int2 (every 1 minute) just fired. Note: "Heartbeat".');
  });
});

describe('composeAlarmExpiredBody', () => {
  it('cron: shows expr, zone, formatted endTime', () => {
    expect(
      composeAlarmExpiredBody({
        kind: 'cron',
        expr: '0 9 * * *',
        timezone: 'America/Los_Angeles',
        endTime: Date.parse('2027-01-01T00:00:00Z'),
        endTimezone: 'UTC',
        prompt: 'check standup',
        alarmId: 'alarm_cron1',
      })
    ).toBe(
      'Your cron alarm alarm_cron1 (0 9 * * * in America/Los_Angeles) reached its end time (2027-01-01T00:00:00+00:00 (UTC)) and won\'t fire again. Last note: "check standup".'
    );
  });

  it('interval: pluralizes correctly', () => {
    expect(
      composeAlarmExpiredBody({
        kind: 'interval',
        minutes: 73,
        endTime: Date.parse('2027-01-01T00:00:00Z'),
        endTimezone: 'UTC',
        prompt: 'pings',
        alarmId: 'alarm_int1',
      })
    ).toBe(
      'Your interval alarm alarm_int1 (every 73 minutes) reached its end time (2027-01-01T00:00:00+00:00 (UTC)) and won\'t fire again. Last note: "pings".'
    );
  });
});

describe('composers', () => {
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

  it('job-progress: truncates lines >200 chars with ... suffix', () => {
    const longLine = 'x'.repeat(250);
    const body = composeJobProgressBody({
      jobId: 'job_p',
      durationMs: 1000,
      outputBytes: 500,
      deltaBytes: 100,
      lastLines: [longLine],
    });
    // Each line is prefixed with two spaces; truncated content is 197 chars + '...'
    expect(body).toContain('  ' + 'x'.repeat(197) + '...');
    expect(body).not.toContain('  ' + 'x'.repeat(250));
  });

  it('job-completed: omits "Last line:" hint when lastLines is empty', () => {
    const body = composeJobCompletedBody({
      jobId: 'job_e',
      jobType: 'bash',
      exitCode: 0,
      durationMs: 1000,
      outputBytes: 0,
      lastLines: [],
    });
    expect(body).not.toContain('Last line');
    expect(body).toContain('Call job_output');
  });

  it('job-progress: omits "Recent output:" block when lastLines is empty', () => {
    const body = composeJobProgressBody({
      jobId: 'job_p',
      durationMs: 1000,
      outputBytes: 50,
      deltaBytes: 10,
      lastLines: [],
    });
    expect(body).not.toContain('Recent output');
    expect(body).toContain('Call job_output');
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
