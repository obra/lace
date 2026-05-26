import { describe, it, expect, afterEach } from 'vitest';
import { computeNextCronFire, assertCronAtLeast5MinInterval, getAgentTimezone } from '../cron';

describe('getAgentTimezone', () => {
  const origTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = origTZ;
  });
  it('returns process.env.TZ when set', () => {
    process.env.TZ = 'America/New_York';
    expect(getAgentTimezone()).toBe('America/New_York');
  });
  it('falls back to Intl when TZ is unset', () => {
    delete process.env.TZ;
    const tz = getAgentTimezone();
    // Just assert it's a non-empty IANA-looking string.
    expect(tz).toMatch(/\w+\/\w+|UTC/);
  });
});

describe('computeNextCronFire', () => {
  it('returns next match strictly > after', () => {
    const after = new Date('2026-05-22T09:00:00-07:00');
    const next = computeNextCronFire('0 9 * * *', 'America/Los_Angeles', after);
    // Same-instant match must NOT count; expect next day.
    expect(new Date(next).toISOString()).toBe('2026-05-23T16:00:00.000Z');
  });
});

describe('assertCronAtLeast5MinInterval', () => {
  it('accepts cron with min delta >= 5 minutes', () => {
    expect(() => assertCronAtLeast5MinInterval('*/5 * * * *', 'UTC')).not.toThrow();
    expect(() => assertCronAtLeast5MinInterval('0 9 * * 1-5', 'UTC')).not.toThrow();
    expect(() => assertCronAtLeast5MinInterval('0,30 9-17 * * 1-5', 'UTC')).not.toThrow();
  });
  it('rejects cron with min delta < 5 minutes', () => {
    expect(() => assertCronAtLeast5MinInterval('*/1 * * * *', 'UTC')).toThrow(
      /minimum interval is 5 minutes/i
    );
    expect(() => assertCronAtLeast5MinInterval('* * * * *', 'UTC')).toThrow(
      /minimum interval is 5 minutes/i
    );
  });
  it('rejects cron with tight cluster across 20-sample window', () => {
    // `0,1 9 * * *` fires at 9:00 and 9:01 daily — 1-min gap inside cluster, 23h59m gap between clusters.
    // 20 samples spans ~10 days and sees the 1-min gap.
    expect(() => assertCronAtLeast5MinInterval('0,1 9 * * *', 'UTC')).toThrow(
      /minimum interval is 5 minutes/i
    );
  });
  it('rejects invalid cron syntax', () => {
    expect(() => assertCronAtLeast5MinInterval('not a cron', 'UTC')).toThrow(
      /invalid cron expression/i
    );
    expect(() => assertCronAtLeast5MinInterval('0 9', 'UTC')).toThrow(/invalid cron expression/i);
  });
});
