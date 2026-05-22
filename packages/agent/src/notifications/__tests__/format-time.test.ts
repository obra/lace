// ABOUTME: Unit tests for the formatAbsoluteTime helper — full ISO with explicit
// ABOUTME: offset + IANA zone name in parens.

import { describe, it, expect } from 'vitest';
import { formatAbsoluteTime } from '../format-time';

describe('formatAbsoluteTime', () => {
  it('formats UTC midnight with Z offset and zone name', () => {
    const epoch = Date.parse('2026-12-25T00:00:00Z');
    expect(formatAbsoluteTime(epoch, 'UTC')).toBe('2026-12-25T00:00:00+00:00 (UTC)');
  });

  it('formats LA time on a winter date (PST, -08:00)', () => {
    // Same instant: 2026-12-25T09:00:00Z = 01:00 PST
    const epoch = Date.parse('2026-12-25T09:00:00Z');
    expect(formatAbsoluteTime(epoch, 'America/Los_Angeles')).toBe(
      '2026-12-25T01:00:00-08:00 (America/Los_Angeles)'
    );
  });

  it('formats LA time on a summer date (PDT, -07:00)', () => {
    // 2026-07-04T17:00:00Z = 10:00 PDT
    const epoch = Date.parse('2026-07-04T17:00:00Z');
    expect(formatAbsoluteTime(epoch, 'America/Los_Angeles')).toBe(
      '2026-07-04T10:00:00-07:00 (America/Los_Angeles)'
    );
  });

  it('formats Tokyo time (JST, +09:00, no DST)', () => {
    const epoch = Date.parse('2026-12-25T09:00:00Z');
    expect(formatAbsoluteTime(epoch, 'Asia/Tokyo')).toBe('2026-12-25T18:00:00+09:00 (Asia/Tokyo)');
  });

  it('defaults to UTC when no timezone provided', () => {
    const epoch = Date.parse('2026-12-25T00:00:00Z');
    expect(formatAbsoluteTime(epoch)).toBe('2026-12-25T00:00:00+00:00 (UTC)');
  });

  it('rejects invalid IANA timezone with a clear error', () => {
    const epoch = Date.parse('2026-12-25T00:00:00Z');
    expect(() => formatAbsoluteTime(epoch, 'Not/A/Zone')).toThrow(/timezone/i);
  });
});
