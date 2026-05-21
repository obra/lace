// ABOUTME: Unit tests for schedule_alarm tool — input validation, cap, success shape.

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ScheduleAlarmTool } from '../schedule_alarm';
import { AlarmScheduler } from '../../../alarms/alarm-scheduler';
import { AlarmStore } from '../../../alarms/alarm-store';
import { writeSessionMeta } from '../../../storage/session-store';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'lace-sched-tool-'));
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

describe('schedule_alarm', () => {
  it('schedules a one-shot in the future', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'p' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text ?? '') as {
      id: string;
      next_fire_at_iso: string;
    };
    expect(body.id).toMatch(/^alarm_/);
    expect(body.next_fire_at_iso).toBe('2030-01-02T00:00:00.000Z');
  });

  it('rejects past one-shot', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'once', schedule: '2020-01-01T00:00:00Z', prompt: 'p' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('failed');
  });

  it('rejects when cap is reached', async () => {
    const { sessionId, sessionDir, scheduler, store } = setup();
    for (let i = 0; i < 50; i++) {
      store.insert({
        kind: 'once',
        schedule: '2030-01-02T00:00:00Z',
        timezone: 'UTC',
        prompt: `p${i}`,
        next_fire_at: Date.parse('2030-01-02T00:00:00Z') + i,
        now: 0,
      });
    }
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'once', schedule: '2030-01-02T00:00:00Z', prompt: 'extra' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('50');
  });
});
