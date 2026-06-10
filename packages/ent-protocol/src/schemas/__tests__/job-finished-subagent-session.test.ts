// ABOUTME: job_finished SessionUpdate carries an optional subagentSessionId (delegation id).
import { describe, it, expect } from 'vitest';
import { SessionUpdateNotificationSchema } from '../methods';

// The session/update notification flattens the per-type union directly under
// `params` (params.type === 'job_finished', plus the base params fields like
// sessionId/streamSeq) — there is no params.update wrapper for notifications.
const base = {
  sessionId: 'sess_00000000-0000-0000-0000-000000000001',
  streamSeq: 0,
  type: 'job_finished' as const,
  jobId: 'job_1',
  outcome: 'completed' as const,
};

describe('job_finished subagentSessionId', () => {
  it('accepts a job_finished update carrying subagentSessionId', () => {
    const params = { ...base, subagentSessionId: 'sess_child_42' };
    const parsed = SessionUpdateNotificationSchema.shape.params.parse(params);
    const u = parsed as { type: string; subagentSessionId?: string };
    expect(u.type).toBe('job_finished');
    expect(u.subagentSessionId).toBe('sess_child_42');
  });

  it('still accepts a job_finished update with no subagentSessionId', () => {
    const parsed = SessionUpdateNotificationSchema.shape.params.parse(base);
    expect((parsed as { type: string }).type).toBe('job_finished');
  });

  it('still rejects an unknown field (strict)', () => {
    const params = { ...base, bogusField: 'x' };
    expect(() => SessionUpdateNotificationSchema.shape.params.parse(params)).toThrow();
  });
});
