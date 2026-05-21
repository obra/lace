// ABOUTME: Unit tests for buildNotification — wrapper element, attribute escaping,
// ABOUTME: identifier preservation, body passed through verbatim.

import { describe, it, expect } from 'vitest';
import { buildNotification } from '../notification-wrapper';

describe('buildNotification', () => {
  it('wraps body in <notification kind="..."> with no attrs', () => {
    expect(buildNotification({ kind: 'alarm-fired', body: 'Hello.' })).toBe(
      '<notification kind="alarm-fired">\nHello.\n</notification>'
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
      kind: 'alarm-fired',
      identifiers: { 'alarm-id': 'a&b"<c>' },
      body: 'x',
    });
    expect(out).toContain('alarm-id="a&amp;b&quot;&lt;c&gt;"');
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
