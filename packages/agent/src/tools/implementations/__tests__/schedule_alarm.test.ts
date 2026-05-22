// ABOUTME: Unit tests for schedule_alarm tool — input validation, cap, success shape
// ABOUTME: across all alarm kinds: once-absolute, once-relative, cron, interval.

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScheduleAlarmTool } from '../schedule_alarm';
import { AlarmScheduler } from '../../../alarms/alarm-scheduler';
import { AlarmStore } from '../../../alarms/alarm-store';
import { writeSessionMeta } from '../../../storage/session-store';

const FROZEN_NOW = Date.parse('2030-01-01T00:00:00Z');

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
    now: () => FROZEN_NOW,
    jitterMaxMs: 0,
    randomFn: () => 0,
    notifier: () => undefined,
  });
  return { sessionId, sessionDir, store, scheduler };
}

interface ScheduleBody {
  id: string;
  kind: string;
  spec: { kind: string; minutes?: number; iso?: string; expr?: string };
  next_fire_at_iso: string;
  end_at_iso: string | null;
}

function parseBody(text: string | undefined): ScheduleBody {
  return JSON.parse(text ?? '') as ScheduleBody;
}

describe('schedule_alarm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('once + schedule: schedules a one-shot at the absolute time', async () => {
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
    const body = parseBody(result.content[0].text);
    expect(body.id).toMatch(/^alarm_/);
    expect(body.spec).toEqual({ kind: 'once-absolute', iso: '2030-01-02T00:00:00Z' });
    expect(body.next_fire_at_iso).toBe('2030-01-02T00:00:00+00:00 (UTC)');
    expect(body.end_at_iso).toBeNull();
  });

  it('once + minutes: relative timer 5 minutes ahead', async () => {
    const { sessionId, sessionDir, scheduler, store } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'once', minutes: 5, prompt: 'stretch' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('completed');
    const body = parseBody(result.content[0].text);
    expect(body.spec).toEqual({ kind: 'once-relative', minutes: 5 });
    const row = store.get(body.id);
    expect(row?.next_fire_at).toBe(FROZEN_NOW + 5 * 60_000);
  });

  it('once with both schedule and minutes: fails', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'once', schedule: '2030-01-02T00:00:00Z', minutes: 5, prompt: 'p' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('exactly one of schedule or minutes');
  });

  it('once with neither schedule nor minutes: fails', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'once', prompt: 'p' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('requires either schedule');
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
        spec: { kind: 'once-absolute', iso: '2030-01-02T00:00:00Z' },
        timezone: 'UTC',
        prompt: `p${i}`,
        next_fire_at: Date.parse('2030-01-02T00:00:00Z') + i,
        end_at: null,
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

  it('cron + endTime: stores end_at populated', async () => {
    const { sessionId, sessionDir, scheduler, store } = setup();
    const tool = new ScheduleAlarmTool();
    const endIso = '2031-01-01T00:00:00Z';
    const result = await tool.execute(
      {
        kind: 'cron',
        schedule: '0 9 * * *',
        timezone: 'America/Los_Angeles',
        endTime: endIso,
        prompt: 'check',
      },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('completed');
    const body = parseBody(result.content[0].text);
    expect(body.spec).toEqual({ kind: 'cron', expr: '0 9 * * *' });
    const row = store.get(body.id);
    expect(row?.end_at).toBe(Date.parse(endIso));
    expect(body.end_at_iso).not.toBeNull();
  });

  it('cron + endTime in the past: fails', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      {
        kind: 'cron',
        schedule: '0 9 * * *',
        timezone: 'UTC',
        endTime: '2020-01-01T00:00:00Z',
        prompt: 'check',
      },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('past');
  });

  it('cron + endTime before next fire: fails', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    // next cron fire is 2030-01-01 09:00 UTC. endTime before that is rejected.
    const result = await tool.execute(
      {
        kind: 'cron',
        schedule: '0 9 * * *',
        timezone: 'UTC',
        endTime: '2030-01-01T05:00:00Z',
        prompt: 'check',
      },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('before the first scheduled fire');
  });

  it('cron without endTime: end_at null', async () => {
    const { sessionId, sessionDir, scheduler, store } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'cron', schedule: '0 9 * * *', timezone: 'UTC', prompt: 'p' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('completed');
    const body = parseBody(result.content[0].text);
    expect(body.end_at_iso).toBeNull();
    expect(store.get(body.id)?.end_at).toBeNull();
  });

  it('interval + minutes=5: success', async () => {
    const { sessionId, sessionDir, scheduler, store } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'interval', minutes: 5, prompt: 'ping' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('completed');
    const body = parseBody(result.content[0].text);
    expect(body.spec).toEqual({ kind: 'interval', minutes: 5 });
    expect(store.get(body.id)?.next_fire_at).toBe(FROZEN_NOW + 5 * 60_000);
    expect(store.get(body.id)?.end_at).toBeNull();
  });

  it('interval + minutes=4: fails (below minimum)', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'interval', minutes: 4, prompt: 'p' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('>= 5');
  });

  it('interval + both endTime and durationMinutes: fails', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      {
        kind: 'interval',
        minutes: 10,
        endTime: '2030-01-02T00:00:00Z',
        durationMinutes: 60,
        prompt: 'p',
      },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('at most one of endTime or durationMinutes');
  });

  it('interval + durationMinutes: end_at = now + durationMinutes*60_000', async () => {
    const { sessionId, sessionDir, scheduler, store } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'interval', minutes: 10, durationMinutes: 360, prompt: 'six hours' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('completed');
    const body = parseBody(result.content[0].text);
    expect(store.get(body.id)?.end_at).toBe(FROZEN_NOW + 360 * 60_000);
  });

  it('once-relative: caller-supplied timezone is used for next_fire_at_iso display', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'once', minutes: 5, timezone: 'America/Los_Angeles', prompt: 'stretch' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('completed');
    const body = parseBody(result.content[0].text);
    // The next_fire_at_iso should show an LA offset (-07:00 or -08:00 depending
    // on DST), not the UTC '+00:00' offset, and the zone name in parens.
    expect(body.next_fire_at_iso).toMatch(/-0[78]:00 \(America\/Los_Angeles\)$/);
    expect(body.timezone).toBe('America/Los_Angeles');
  });

  it('once-relative: defaults to UTC when no timezone is provided', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'once', minutes: 5, prompt: 'stretch' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('completed');
    const body = parseBody(result.content[0].text);
    expect(body.next_fire_at_iso).toContain('+00:00 (UTC)');
    expect(body.timezone).toBe('UTC');
  });

  it('once-relative: invalid timezone is rejected', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'once', minutes: 5, timezone: 'Not/A/Zone', prompt: 'p' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toMatch(/timezone/i);
  });

  it('interval rejects schedule/timezone fields', async () => {
    const { sessionId, sessionDir, scheduler } = setup();
    const tool = new ScheduleAlarmTool();
    const result = await tool.execute(
      { kind: 'interval', minutes: 5, schedule: '0 9 * * *', prompt: 'p' },
      {
        signal: new AbortController().signal,
        alarmScheduler: scheduler,
        activeSessionId: sessionId,
        activeSessionDir: sessionDir,
      }
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('does not accept schedule');
  });
});
