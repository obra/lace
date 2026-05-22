// ABOUTME: Unit tests for list_alarms tool — returns active alarms sorted by next_fire_at.

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ScheduleAlarmTool } from '../schedule_alarm';
import { ListAlarmsTool } from '../list_alarms';
import { AlarmScheduler } from '../../../alarms/alarm-scheduler';
import { AlarmStore } from '../../../alarms/alarm-store';
import { writeSessionMeta } from '../../../storage/session-store';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'lace-list-tool-'));
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

describe('list_alarms', () => {
  it('returns active alarms sorted by next_fire_at ascending', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const ctx = {
      signal: new AbortController().signal,
      alarmScheduler: scheduler,
      activeSessionId: sessionId,
      activeSessionDir: sessionDir,
    };

    const scheduleTool = new ScheduleAlarmTool();

    // Insert 'b' first (fires 2030-01-03) then 'a' (fires 2030-01-02)
    await scheduleTool.execute(
      { kind: 'once', schedule: '2030-01-03T00:00:00Z', prompt: 'b' },
      ctx
    );
    await scheduleTool.execute(
      { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'a' },
      ctx
    );

    const listTool = new ListAlarmsTool();
    const result = await listTool.execute({}, ctx);
    expect(result.status).toBe('completed');

    const body = JSON.parse(result.content[0].text ?? '') as {
      alarms: Array<{
        prompt: string;
        spec: { kind: string };
        end_at_iso: string | null;
      }>;
    };
    expect(body.alarms.map((a) => a.prompt)).toEqual(['a', 'b']);
    expect(body.alarms[0].spec.kind).toBe('once-absolute');
    expect(body.alarms[0].end_at_iso).toBeNull();
  });

  it('returns empty alarms array when no active alarms', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const ctx = {
      signal: new AbortController().signal,
      alarmScheduler: scheduler,
      activeSessionId: sessionId,
      activeSessionDir: sessionDir,
    };

    const listTool = new ListAlarmsTool();
    const result = await listTool.execute({}, ctx);
    expect(result.status).toBe('completed');

    const body = JSON.parse(result.content[0].text ?? '') as {
      alarms: Array<unknown>;
    };
    expect(body.alarms).toEqual([]);
  });
});
