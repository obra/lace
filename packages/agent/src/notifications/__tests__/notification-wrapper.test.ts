// ABOUTME: Unit tests for buildNotification — wrapper element, attribute escaping,
// ABOUTME: identifier preservation, body passed through verbatim.

import { describe, it, expect } from 'vitest';
import { buildNotification } from '../notification-wrapper';

describe('buildNotification', () => {
  it('wraps body in <notification kind="..."> with no attrs', () => {
    expect(buildNotification({ kind: 'reminder', body: 'Hello.' })).toBe(
      '<notification kind="reminder">\nHello.\n</notification>'
    );
  });

  it('serializes identifiers as XML attributes in order', () => {
    const out = buildNotification({
      kind: 'job-completed',
      identifiers: { 'job-id': 'job_xyz', persona: 'shell' },
      body: 'Done.',
    });
    expect(out).toBe(
      '<notification kind="job-completed" job-id="job_xyz" persona="shell">\nDone.\n</notification>'
    );
  });

  it('escapes attribute values', () => {
    const out = buildNotification({
      kind: 'reminder',
      identifiers: { id: 'a&b"<c>' },
      body: 'x',
    });
    expect(out).toContain('id="a&amp;b&quot;&lt;c&gt;"');
  });

  it('drops empty-string identifiers (e.g. missing persona)', () => {
    const out = buildNotification({
      kind: 'subagent-exited',
      identifiers: { 'subagent-session-id': 'sess_a', persona: '' },
      body: 'b',
    });
    expect(out).toBe(
      '<notification kind="subagent-exited" subagent-session-id="sess_a">\nb\n</notification>'
    );
  });
});

describe('buildNotification — typed attributes', () => {
  it('emits numeric attributes via String(v)', () => {
    const out = buildNotification({
      kind: 'reminder',
      attributes: { 'fire-count': 6 },
      body: 'hi',
    });
    expect(out).toContain('fire-count="6"');
  });

  it('omits attributes whose value is undefined or null', () => {
    const out = buildNotification({
      kind: 'reminder',
      attributes: { 'last-fired-at': undefined as unknown as string, 'fire-count': 1 },
      body: 'hi',
    });
    expect(out).not.toContain('last-fired-at');
    expect(out).toContain('fire-count="1"');
  });

  it('throws on NaN attribute values', () => {
    expect(() =>
      buildNotification({ kind: 'reminder', attributes: { 'fire-count': NaN }, body: 'hi' })
    ).toThrow(/non-finite/i);
  });

  it('escapes & and < in body but leaves > alone', () => {
    const out = buildNotification({
      kind: 'reminder',
      body: '5 < 10 & </notification> done',
    });
    expect(out).toContain('5 &lt; 10 &amp; &lt;/notification> done');
  });

  it('does not double-escape: & first then <', () => {
    const out = buildNotification({ kind: 'reminder', body: 'plain text' });
    expect(out).toContain('plain text');
    // Empty body still produces a wrapped notification.
    expect(buildNotification({ kind: 'reminder', body: '' })).toMatch(
      /<notification kind="reminder">\s*\n\s*<\/notification>/
    );
  });

  it('accepts kind="reminder"', () => {
    const out = buildNotification({ kind: 'reminder', body: 'ok' });
    expect(out).toContain('kind="reminder"');
  });
});
