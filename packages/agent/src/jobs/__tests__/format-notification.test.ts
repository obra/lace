// ABOUTME: Tests for job notification formatter

import { describe, expect, it } from 'vitest';
import { formatJobNotification } from '../format-notification';

describe('formatJobNotification', () => {
  it('formats completed notification', () => {
    const result = formatJobNotification({
      jobId: 'job_abc123',
      type: 'completed',
      exitCode: 0,
      durationMs: 12300,
      outputBytes: 2456,
      lastLines: ['Build successful'],
    });

    expect(result).toContain('<background-job-notification');
    expect(result).toContain('job-id="job_abc123"');
    expect(result).toContain('type="completed"');
    expect(result).toContain('Exit code: 0');
    expect(result).toContain('Duration: 12.3s');
    expect(result).toContain('Output: 2,456 bytes');
    expect(result).toContain('Build successful');
  });

  it('formats failed notification with 3 last lines', () => {
    const result = formatJobNotification({
      jobId: 'job_def456',
      type: 'failed',
      exitCode: 1,
      durationMs: 3100,
      outputBytes: 892,
      lastLines: [
        'src/main.ts:42 - Type error',
        'src/main.ts:58 - Type error',
        'Build failed with 2 errors',
      ],
    });

    expect(result).toContain('type="failed"');
    expect(result).toContain('Exit code: 1');
    expect(result).toContain('Duration: 3.1s');
    expect(result).toContain('Output: 892 bytes');
    expect(result).toContain('src/main.ts:42 - Type error');
    expect(result).toContain('src/main.ts:58 - Type error');
    expect(result).toContain('Build failed with 2 errors');
  });

  it('formats progress notification with delta bytes', () => {
    const result = formatJobNotification({
      jobId: 'job_ghi789',
      type: 'progress',
      durationMs: 300000, // 5 minutes
      outputBytes: 15234,
      deltaBytes: 2100,
      lastLines: [
        'Processing file 45/120...',
        'Processing file 46/120...',
        'Processing file 47/120...',
      ],
    });

    expect(result).toContain('type="progress"');
    expect(result).toContain('Status: running');
    expect(result).toContain('Duration: 5m 0.0s');
    expect(result).toContain('Output: 15,234 bytes');
    expect(result).toContain('+2,100 since last update');
    expect(result).toContain('Processing file 47/120...');
  });

  it('formats cancelled notification with reason', () => {
    const result = formatJobNotification({
      jobId: 'job_jkl012',
      type: 'cancelled',
      durationMs: 5200,
      outputBytes: 1024,
      lastLines: [],
      reason: 'Session switched',
    });

    expect(result).toContain('type="cancelled"');
    expect(result).toContain('Status: cancelled');
    expect(result).toContain('Duration: 5.2s');
    expect(result).toContain('Output: 1,024 bytes');
    expect(result).toContain('Reason: Session switched');
  });

  it('truncates lines longer than 200 chars', () => {
    const longLine = 'x'.repeat(250);
    const result = formatJobNotification({
      jobId: 'job_test',
      type: 'completed',
      exitCode: 0,
      durationMs: 1000,
      outputBytes: 250,
      lastLines: [longLine],
    });

    // The truncated line should be 200 chars with "..."
    expect(result).toContain('x'.repeat(197) + '...');
    expect(result).not.toContain('x'.repeat(250));
  });

  it('formats duration as minutes for long jobs', () => {
    const result = formatJobNotification({
      jobId: 'job_long',
      type: 'completed',
      exitCode: 0,
      durationMs: 125000, // 2m 5s
      outputBytes: 1000,
      lastLines: ['Done'],
    });

    expect(result).toContain('Duration: 2m 5.0s');
  });

  it('formats duration as seconds for short jobs', () => {
    const result = formatJobNotification({
      jobId: 'job_short',
      type: 'completed',
      exitCode: 0,
      durationMs: 45600, // 45.6 seconds
      outputBytes: 100,
      lastLines: ['Done'],
    });

    expect(result).toContain('Duration: 45.6s');
  });

  it('includes job_output tool hint', () => {
    const result = formatJobNotification({
      jobId: 'job_abc123',
      type: 'completed',
      exitCode: 0,
      durationMs: 1000,
      outputBytes: 100,
      lastLines: ['Done'],
    });

    expect(result).toContain('job_output');
    expect(result).toContain('job_abc123');
  });

  it('handles empty lastLines array', () => {
    const result = formatJobNotification({
      jobId: 'job_empty',
      type: 'completed',
      exitCode: 0,
      durationMs: 1000,
      outputBytes: 0,
      lastLines: [],
    });

    expect(result).toContain('<background-job-notification');
    expect(result).toContain('</background-job-notification>');
    expect(result).toContain('Output: 0 bytes');
  });

  it('uses "Last line" for single line, "Last 3 lines" for multiple', () => {
    const singleLine = formatJobNotification({
      jobId: 'job_single',
      type: 'completed',
      exitCode: 0,
      durationMs: 1000,
      outputBytes: 100,
      lastLines: ['Only one line'],
    });
    expect(singleLine).toContain('Last line:');

    const multiLine = formatJobNotification({
      jobId: 'job_multi',
      type: 'failed',
      exitCode: 1,
      durationMs: 1000,
      outputBytes: 300,
      lastLines: ['Line 1', 'Line 2', 'Line 3'],
    });
    expect(multiLine).toContain('Last 3 lines:');
  });
});
