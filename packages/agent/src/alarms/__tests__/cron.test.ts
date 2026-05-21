// ABOUTME: Tests for cron parsing, min-interval validation, jitter application, and IANA timezone
// ABOUTME: validation. The cron module is pure — clock and randomness are injected.

import { describe, expect, it } from 'vitest';
import {
  assertValidCronMinInterval,
  assertValidIanaTimezone,
  computeNextCronFire,
  computeNextOnceFire,
} from '../cron';

const HOUR_MS = 60 * 60 * 1000;

describe('assertValidIanaTimezone', () => {
  it('accepts canonical IANA names', () => {
    expect(() => assertValidIanaTimezone('America/Los_Angeles')).not.toThrow();
    expect(() => assertValidIanaTimezone('UTC')).not.toThrow();
    expect(() => assertValidIanaTimezone('Europe/London')).not.toThrow();
  });

  it('rejects common abbreviations like PST/EST/GMT', () => {
    expect(() => assertValidIanaTimezone('PST')).toThrow(/IANA/);
    expect(() => assertValidIanaTimezone('EST')).toThrow(/IANA/);
    expect(() => assertValidIanaTimezone('GMT')).toThrow(/IANA/);
    expect(() => assertValidIanaTimezone('pst')).toThrow(/IANA/);
  });

  it('rejects nonsense strings', () => {
    expect(() => assertValidIanaTimezone('Not/A_Zone')).toThrow();
    expect(() => assertValidIanaTimezone('')).toThrow();
  });
});

describe('assertValidCronMinInterval', () => {
  it('accepts exactly-hourly (0 * * * *)', () => {
    expect(() => assertValidCronMinInterval('0 * * * *', 'UTC')).not.toThrow();
  });

  it('accepts daily (0 9 * * *)', () => {
    expect(() => assertValidCronMinInterval('0 9 * * *', 'America/Los_Angeles')).not.toThrow();
  });

  it('rejects every-30-minutes (*/30 * * * *)', () => {
    expect(() => assertValidCronMinInterval('*/30 * * * *', 'UTC')).toThrow(/minimum.*hour/i);
  });

  it('rejects every-minute (* * * * *)', () => {
    expect(() => assertValidCronMinInterval('* * * * *', 'UTC')).toThrow(/minimum.*hour/i);
  });

  it('rejects malformed cron with a clear error', () => {
    expect(() => assertValidCronMinInterval('not a cron', 'UTC')).toThrow();
  });
});

describe('computeNextCronFire', () => {
  it('returns the next cron fire after `after`, jittered by 0..jitterMaxMs (positive only)', () => {
    const after = new Date('2026-01-01T00:00:00Z');
    // 0 jitter — deterministic
    const out = computeNextCronFire({
      expr: '0 * * * *',
      timezone: 'UTC',
      after,
      jitterMaxMs: 0,
      randomFn: () => 0.5,
    });
    expect(out.rawMs).toBe(new Date('2026-01-01T01:00:00Z').getTime());
    expect(out.jitteredMs).toBe(out.rawMs);
  });

  it('adds jitter in [0, jitterMaxMs) when jitterMaxMs > 0', () => {
    const after = new Date('2026-01-01T00:00:00Z');
    const out = computeNextCronFire({
      expr: '0 * * * *',
      timezone: 'UTC',
      after,
      jitterMaxMs: 60_000,
      randomFn: () => 0.5,
    });
    expect(out.rawMs).toBe(new Date('2026-01-01T01:00:00Z').getTime());
    expect(out.jitteredMs - out.rawMs).toBe(30_000);
  });

  it('never produces negative jitter (jitter is positive-only)', () => {
    const after = new Date('2026-01-01T00:00:00Z');
    const out = computeNextCronFire({
      expr: '0 * * * *',
      timezone: 'UTC',
      after,
      jitterMaxMs: 60_000,
      randomFn: () => 0,
    });
    expect(out.jitteredMs).toBe(out.rawMs);
    expect(out.jitteredMs - out.rawMs).toBeGreaterThanOrEqual(0);
  });

  it('respects timezone — 9am in America/Los_Angeles fires at 17:00 UTC standard time', () => {
    const after = new Date('2026-01-01T00:00:00Z');
    const out = computeNextCronFire({
      expr: '0 9 * * *',
      timezone: 'America/Los_Angeles',
      after,
      jitterMaxMs: 0,
      randomFn: () => 0,
    });
    // 9am PST = 17:00 UTC; first such after 2026-01-01T00Z is 2026-01-01T17:00Z.
    expect(out.rawMs).toBe(new Date('2026-01-01T17:00:00Z').getTime());
  });
});

describe('computeNextOnceFire', () => {
  it('parses ISO and returns epoch ms', () => {
    const out = computeNextOnceFire('2026-06-01T15:00:00Z');
    expect(out).toBe(new Date('2026-06-01T15:00:00Z').getTime());
  });

  it('rejects non-ISO strings', () => {
    expect(() => computeNextOnceFire('next tuesday')).toThrow();
  });

  it('rejects past timestamps when `now` is provided and past', () => {
    const now = new Date('2026-01-01T00:00:00Z').getTime();
    expect(() => computeNextOnceFire('2025-01-01T00:00:00Z', now)).toThrow(/past/i);
  });
});

// Min-interval check at the cron-helper boundary
describe('min-interval boundary', () => {
  it('accepts exactly 1 hour delta', () => {
    // 0 * * * * → delta is exactly HOUR_MS
    expect(() => assertValidCronMinInterval('0 * * * *', 'UTC')).not.toThrow();
    // Sanity: delta is exactly HOUR_MS
    const after = new Date('2026-01-01T00:30:00Z');
    const a = computeNextCronFire({
      expr: '0 * * * *',
      timezone: 'UTC',
      after,
      jitterMaxMs: 0,
      randomFn: () => 0,
    });
    const b = computeNextCronFire({
      expr: '0 * * * *',
      timezone: 'UTC',
      after: new Date(a.rawMs),
      jitterMaxMs: 0,
      randomFn: () => 0,
    });
    expect(b.rawMs - a.rawMs).toBe(HOUR_MS);
  });
});
