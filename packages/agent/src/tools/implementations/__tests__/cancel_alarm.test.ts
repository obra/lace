// ABOUTME: Unit tests for cancel_alarm tool — success path and not-found path.

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ScheduleAlarmTool } from '../schedule_alarm';
import { CancelAlarmTool } from '../cancel_alarm';
import { AlarmScheduler } from '../../../alarms/alarm-scheduler';
import { AlarmStore } from '../../../alarms/alarm-store';
import { writeSessionMeta } from '../../../storage/session-store';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'lace-cancel-tool-'));
  const sessionId = 'sess_a';
  const sessionDir = join(root, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionMeta(sessionDir, { sessionId, workDir: '/tmp', created: new Date().toISOString() });
  const store = new AlarmStore(sessionDir);
  const scheduler = new AlarmScheduler({
    sessionDir,
    store,
    now: () => Date.parse('2030-01-01T00:00:00Z'),
    jitterMaxMs: 0,
    randomFn: () => 0,
    notifier: () => undefined,
  });
  return { sessionId, sessionDir, store, scheduler };
}

describe('cancel_alarm', () => {
  it('cancels an existing alarm', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const ctx = {
      signal: new AbortController().signal,
      alarmScheduler: scheduler,
      activeSessionId: sessionId,
      activeSessionDir: sessionDir,
    };

    // Schedule an alarm first
    const scheduleTool = new ScheduleAlarmTool();
    const schedResult = await scheduleTool.execute(
      { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'p' },
      ctx
    );
    expect(schedResult.status).toBe('completed');
    const schedBody = JSON.parse(schedResult.content[0].text ?? '') as { id: string };

    // Now cancel it
    const cancelTool = new CancelAlarmTool();
    const cancelResult = await cancelTool.execute({ id: schedBody.id }, ctx);
    expect(cancelResult.status).toBe('completed');
    const body = JSON.parse(cancelResult.content[0].text ?? '') as { cancelled: boolean };
    expect(body.cancelled).toBe(true);
  });

  it('returns cancelled:false with reason not_found for unknown id', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const ctx = {
      signal: new AbortController().signal,
      alarmScheduler: scheduler,
      activeSessionId: sessionId,
      activeSessionDir: sessionDir,
    };

    const cancelTool = new CancelAlarmTool();
    const result = await cancelTool.execute({ id: 'alarm_zzz' }, ctx);
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text ?? '') as {
      cancelled: boolean;
      reason: string;
    };
    expect(body.cancelled).toBe(false);
    expect(body.reason).toBe('not_found');
  });
});
