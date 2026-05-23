// ABOUTME: Unit tests for body composers — pure functions producing prose bodies
// ABOUTME: for each notification kind. Snapshots locked to the bodies in the spec.

import { describe, it, expect } from 'vitest';
import {
  composeJobCompletedBody,
  composeJobFailedBody,
  composeJobCancelledBody,
  composeJobProgressBody,
} from '../composers';

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

});

import { composeReminderBody, composeSubagentExitedBody as composeSubagentExitedBodyReminders } from '../composers';

describe('composeReminderBody', () => {
  it("returns the prompt verbatim (escaping is the wrapper's job)", () => {
    expect(composeReminderBody({ prompt: 'follow up' })).toBe('follow up');
  });
});

describe('composeSubagentExitedBody (reminders)', () => {
  it('full list when ≤5 reminders', () => {
    const body = composeSubagentExitedBodyReminders({
      persona: 'sen-box',
      pendingReminders: [
        { id: 'reminder_aaaa', prompt: 'check the deploy', next_fire_at_iso: '2026-05-22T16:00:00-07:00' },
        { id: 'reminder_bbbb', prompt: 'ping ops', next_fire_at_iso: '2026-05-22T17:00:00-07:00' },
      ],
    });
    expect(body).toContain('check the deploy');
    expect(body).toContain('ping ops');
  });

  it('compact format when >5 reminders, no truncation past 200 chars and no silent drops', () => {
    const longPrompt = 'a'.repeat(250);
    const body = composeSubagentExitedBodyReminders({
      persona: 'sen-box',
      pendingReminders: Array.from({ length: 7 }).map((_, i) => ({
        id: `reminder_${i.toString().padStart(12, '0')}`,
        prompt: i === 0 ? longPrompt : `prompt ${i}`,
        next_fire_at_iso: '2026-05-22T16:00:00-07:00',
      })),
    });
    // Long prompt is truncated to 200 chars with ellipsis.
    expect(body).toMatch(/^.{200}\.\.\./m);
    // Bubble does not silently drop any of the 7 reminders.
    for (let i = 0; i < 7; i++) {
      expect(body).toContain(`reminder_${i.toString().padStart(12, '0')}`);
    }
  });
});
