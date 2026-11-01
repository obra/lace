// ABOUTME: Native settlement observations carry identity and an update watermark.
// ABOUTME: Completion updates only wake a fresh status read and carry no certificate.

import { describe, expect, it } from 'vitest';
import { EntAgentStatusResponseSchema, SessionUpdateNotificationSchema } from '../methods';

const sessionId = 'sess_00000000-0000-0000-0000-000000000001';
const completion = {
  sessionId,
  terminalTurnId: 'turn_terminal',
  observedStreamSeq: 7,
  settled: true,
};
const response = (observation: unknown) => ({
  jsonrpc: '2.0',
  id: 1,
  result: {
    models: [],
    mcpServers: [],
    pendingPermissions: [],
    limits: { budgetUsedUsd: 0 },
    completion: observation,
  },
});

describe('native completion protocol', () => {
  it('preserves the session, terminal turn and stream observation in status', () => {
    expect(EntAgentStatusResponseSchema.parse(response(completion)).result).toMatchObject({
      completion,
    });
  });

  it('accepts an unsettled session without a terminal turn', () => {
    expect(
      EntAgentStatusResponseSchema.parse(
        response({ sessionId, observedStreamSeq: 0, settled: false })
      ).result
    ).toMatchObject({ completion: { sessionId, observedStreamSeq: 0, settled: false } });
  });

  it.each([-1, 1.5])('rejects invalid observed stream sequence %s', (observedStreamSeq) => {
    expect(
      EntAgentStatusResponseSchema.safeParse(response({ ...completion, observedStreamSeq })).success
    ).toBe(false);
  });

  it('accepts a completion wake without asserting settlement', () => {
    const update = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId, streamSeq: 8, type: 'completion_status' },
    };
    expect(SessionUpdateNotificationSchema.parse(update)).toEqual(update);
    expect(
      SessionUpdateNotificationSchema.safeParse({
        ...update,
        params: { ...update.params, settled: true },
      }).success
    ).toBe(false);
  });
});
