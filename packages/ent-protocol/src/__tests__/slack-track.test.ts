/**
 * Tests for the canonical Slack conversation-track helper.
 *
 * Grammar (label-free, NO pipe, NO @):
 *   slack:<teamId>:<channelId>            # channel-level
 *   slack:<teamId>:<channelId>/<threadTs> # threaded
 *
 * Assumptions (documented here):
 * - teamId and channelId are Slack IDs (e.g. T0ABC, C0XYZ); they MUST NOT
 *   contain ':' or '/' because the parser splits on the first ':' after 'slack:'
 *   for teamId, the next ':' for channelId, and '/' for threadTs.
 * - threadTs is a Slack thread timestamp (e.g. "1678886400.000200"); it MUST NOT
 *   contain '/' because the parser splits on the first '/' after channelId.
 * - The format is DISTINCT from per-message refs (which contain '|' and '@').
 */

import { describe, expect, it } from 'vitest';
import { deriveSendTrack, formatSlackConvTrack, parseSlackConvTrack } from '../slack-track';

describe('formatSlackConvTrack', () => {
  it('formats a channel-level conversation (no threadTs)', () => {
    const result = formatSlackConvTrack({ teamId: 'T0ABC', channelId: 'C0XYZ' });
    expect(result).toBe('slack:T0ABC:C0XYZ');
  });

  it('formats a threaded conversation', () => {
    const result = formatSlackConvTrack({
      teamId: 'T0ABC',
      channelId: 'C0XYZ',
      threadTs: '1678886400.000200',
    });
    expect(result).toBe('slack:T0ABC:C0XYZ/1678886400.000200');
  });

  it('output starts with "slack:"', () => {
    expect(formatSlackConvTrack({ teamId: 'T123', channelId: 'C456' })).toMatch(/^slack:/);
  });

  it('output contains NO pipe character (label-free)', () => {
    const result = formatSlackConvTrack({
      teamId: 'T0ABC',
      channelId: 'C0XYZ',
      threadTs: '1678886400.000200',
    });
    expect(result).not.toContain('|');
  });

  it('output contains NO @ character (not a per-message ref)', () => {
    const result = formatSlackConvTrack({
      teamId: 'T0ABC',
      channelId: 'C0XYZ',
      threadTs: '1678886400.000200',
    });
    expect(result).not.toContain('@');
  });

  it('throws on empty teamId', () => {
    expect(() => formatSlackConvTrack({ teamId: '', channelId: 'C0XYZ' })).toThrow();
  });

  it('throws on empty channelId', () => {
    expect(() => formatSlackConvTrack({ teamId: 'T0ABC', channelId: '' })).toThrow();
  });

  it('throws on whitespace-only teamId', () => {
    expect(() => formatSlackConvTrack({ teamId: '   ', channelId: 'C0XYZ' })).toThrow();
  });

  it('throws on whitespace-only channelId', () => {
    expect(() => formatSlackConvTrack({ teamId: 'T0ABC', channelId: '   ' })).toThrow();
  });

  it('throws if teamId contains ":"', () => {
    expect(() => formatSlackConvTrack({ teamId: 'T:BAD', channelId: 'C0XYZ' })).toThrow();
  });

  it('throws if channelId contains ":"', () => {
    expect(() => formatSlackConvTrack({ teamId: 'T0ABC', channelId: 'C:BAD' })).toThrow();
  });

  it('throws if channelId contains "/"', () => {
    expect(() => formatSlackConvTrack({ teamId: 'T0ABC', channelId: 'C/BAD' })).toThrow();
  });

  it('throws if threadTs contains "/"', () => {
    expect(() =>
      formatSlackConvTrack({ teamId: 'T0ABC', channelId: 'C0XYZ', threadTs: '1678/bad' })
    ).toThrow();
  });
});

describe('parseSlackConvTrack', () => {
  it('round-trips a channel-level track (no threadTs)', () => {
    const parts = { teamId: 'T0ABC', channelId: 'C0XYZ' };
    const parsed = parseSlackConvTrack(formatSlackConvTrack(parts));
    expect(parsed).toEqual({ teamId: 'T0ABC', channelId: 'C0XYZ' });
    expect(parsed).not.toHaveProperty('threadTs'); // threadTs absent, not undefined
  });

  it('round-trips a threaded conversation', () => {
    const parts = { teamId: 'T0ABC', channelId: 'C0XYZ', threadTs: '1678886400.000200' };
    const parsed = parseSlackConvTrack(formatSlackConvTrack(parts));
    expect(parsed).toEqual(parts);
  });

  it('round-trip: threadTs absent on channel-level (property not present)', () => {
    const parts = { teamId: 'T0ABC', channelId: 'C0XYZ' };
    const result = parseSlackConvTrack(formatSlackConvTrack(parts));
    // threadTs must be absent (undefined property), not explicitly set to undefined
    expect(result).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(result, 'threadTs')).toBe(false);
  });

  it('parses a canonical channel-level string', () => {
    expect(parseSlackConvTrack('slack:T0ABC:C0XYZ')).toEqual({
      teamId: 'T0ABC',
      channelId: 'C0XYZ',
    });
  });

  it('parses a canonical threaded string', () => {
    expect(parseSlackConvTrack('slack:T0ABC:C0XYZ/1678886400.000200')).toEqual({
      teamId: 'T0ABC',
      channelId: 'C0XYZ',
      threadTs: '1678886400.000200',
    });
  });

  it('returns null for non-slack prefix', () => {
    expect(parseSlackConvTrack('job:jobid-123')).toBeNull();
    expect(parseSlackConvTrack('alarm:alert-1')).toBeNull();
    expect(parseSlackConvTrack('https://example.com')).toBeNull();
  });

  it('returns null for missing channelId (only teamId after slack:)', () => {
    expect(parseSlackConvTrack('slack:T0ABC')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSlackConvTrack('')).toBeNull();
  });

  it('returns null for empty teamId segment', () => {
    expect(parseSlackConvTrack('slack::C0XYZ')).toBeNull();
  });

  it('returns null for empty channelId segment', () => {
    expect(parseSlackConvTrack('slack:T0ABC:')).toBeNull();
  });

  it('returns null for empty threadTs segment when slash present', () => {
    // "slack:T0ABC:C0XYZ/" — slash present but empty threadTs
    expect(parseSlackConvTrack('slack:T0ABC:C0XYZ/')).toBeNull();
  });

  it('returns null for a string with a pipe label (per-message ref style)', () => {
    // e.g. what formatSlackMessageRef produces
    expect(parseSlackConvTrack('slack:T0ABC:C0XYZ|#general@1678886400.000200')).toBeNull();
  });

  it('returns null for a per-message ref with @ but no pipe', () => {
    expect(parseSlackConvTrack('slack:T0ABC:C0XYZ@1678886400.000200')).toBeNull();
  });

  it('returns null for a bare slack: with nothing after', () => {
    expect(parseSlackConvTrack('slack:')).toBeNull();
  });

  it('returns null for whitespace/garbage', () => {
    expect(parseSlackConvTrack('   ')).toBeNull();
    expect(parseSlackConvTrack('not-a-track')).toBeNull();
  });
});

describe('deriveSendTrack', () => {
  it('derives a channel-level track from channel + teamId', () => {
    expect(deriveSendTrack({ channel: 'C0XYZ' }, 'T0ABC')).toBe('slack:T0ABC:C0XYZ');
  });

  it('derives a threaded track when thread_ts is present', () => {
    expect(deriveSendTrack({ channel: 'C0XYZ', thread_ts: '1678886400.000200' }, 'T0ABC')).toBe(
      'slack:T0ABC:C0XYZ/1678886400.000200'
    );
  });

  it('returns null when channel is missing', () => {
    expect(deriveSendTrack({ thread_ts: '1678886400.000200' }, 'T0ABC')).toBeNull();
  });

  it('returns null when channel is not a string', () => {
    expect(deriveSendTrack({ channel: 123 }, 'T0ABC')).toBeNull();
  });

  it('returns null when teamId is undefined', () => {
    expect(deriveSendTrack({ channel: 'C0XYZ' }, undefined)).toBeNull();
  });

  it('returns null when teamId is empty', () => {
    expect(deriveSendTrack({ channel: 'C0XYZ' }, '')).toBeNull();
  });

  it('returns null when parts violate the grammar (channel contains "/")', () => {
    expect(deriveSendTrack({ channel: 'C/BAD' }, 'T0ABC')).toBeNull();
  });

  it('ignores a non-string thread_ts (treats as channel-level)', () => {
    expect(deriveSendTrack({ channel: 'C0XYZ', thread_ts: 42 }, 'T0ABC')).toBe('slack:T0ABC:C0XYZ');
  });

  it('treats an empty thread_ts as channel-level (derived track round-trips)', () => {
    const track = deriveSendTrack({ channel: 'C0XYZ', thread_ts: '' }, 'T0ABC');
    expect(track).toBe('slack:T0ABC:C0XYZ');
    expect(parseSlackConvTrack(track as string)).toEqual({ teamId: 'T0ABC', channelId: 'C0XYZ' });
  });
});
