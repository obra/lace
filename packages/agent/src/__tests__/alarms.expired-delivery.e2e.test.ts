// ABOUTME: Integration test for alarm expiry — verifies the alarm-expired
// ABOUTME: notification body lands in events.jsonl with the correct shape,
// ABOUTME: using a fake clock instead of real-time waits (PRI-1744 reviewer #7).

import { mkdtempSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AlarmScheduler } from '@lace/agent/alarms/alarm-scheduler';
import { AlarmStore } from '@lace/agent/alarms/alarm-store';
import {
  composeAlarmFiredBody,
  composeAlarmExpiredBody,
} from '@lace/agent/notifications/composers';
import { injectNotification } from '@lace/agent/notifications/inject-notification';
import { specToFiredCompose, specToExpiredCompose } from '../server';

interface DurableEvent {
  type: string;
  data?: { priority?: string; content?: Array<{ type?: string; text?: string }> };
}

function readEvents(sessionDir: string): DurableEvent[] {
  const eventsPath = join(sessionDir, 'events.jsonl');
  try {
    return readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DurableEvent);
  } catch {
    return [];
  }
}

function notificationTexts(events: DurableEvent[]): string[] {
  return events
    .filter((e) => e.type === 'context_injected' && e.data?.priority === 'immediate')
    .flatMap((e) => (e.data?.content ?? []).map((c) => c.text ?? ''))
    .filter(Boolean);
}

describe('alarm expired-delivery (fake-clock integration)', () => {
  let sessionDir: string;
  let currentNow: number;
  let scheduler: AlarmScheduler;
  let store: AlarmStore;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'lace-alarm-expired-'));
    mkdirSync(sessionDir, { recursive: true });
    // Anchor "now" at a fixed point so end_at math is deterministic.
    currentNow = Date.parse('2030-01-01T00:00:00Z');
    store = new AlarmStore(sessionDir);

    scheduler = new AlarmScheduler({
      sessionDir,
      store,
      now: () => currentNow,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: ({ row }) => {
        injectNotification({
          sessionDir,
          kind: 'alarm-fired',
          identifiers: { 'alarm-id': row.id },
          body: composeAlarmFiredBody(specToFiredCompose(row)),
        });
      },
      expiredNotifier: ({ row }) => {
        const compose = specToExpiredCompose(row);
        if (!compose) return;
        injectNotification({
          sessionDir,
          kind: 'alarm-expired',
          identifiers: { 'alarm-id': row.id },
          body: composeAlarmExpiredBody(compose),
        });
      },
    });
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('interval alarm fires once then expires; both alarm-fired and alarm-expired bodies land', async () => {
    // minutes=5, end_at = now + 5min. First fire is at now+5min, which equals
    // end_at. Second fire would be at now+10min > end_at → expiry on that tick.
    const fiveMin = 5 * 60_000;
    const row = store.insert({
      kind: 'interval',
      spec: { kind: 'interval', minutes: 5 },
      timezone: 'UTC',
      prompt: 'ping',
      next_fire_at: currentNow + fiveMin,
      end_at: currentNow + fiveMin,
      now: currentNow,
    });
    scheduler.bootRecover();

    // Advance to fire time and tick — first fire should land.
    currentNow += fiveMin;
    await scheduler.tickForTest();

    // Confirm one alarm-fired body landed.
    let texts = notificationTexts(readEvents(sessionDir));
    expect(texts.some((t) => t.includes('<notification kind="alarm-fired"'))).toBe(true);
    expect(texts.some((t) => t.includes('Your interval alarm'))).toBe(true);
    expect(texts.some((t) => t.includes('every 5 minutes'))).toBe(true);

    // On the first fire the next fire (firedAt + 5min) exceeds end_at, so the
    // scheduler should immediately detect expiry, emit alarm-expired, and delete
    // the row — all within the same tick.
    texts = notificationTexts(readEvents(sessionDir));
    const expiredText = texts.find((t) => t.includes('<notification kind="alarm-expired"'));
    expect(expiredText, 'alarm-expired notification should land').toBeDefined();
    expect(expiredText!).toContain('Your interval alarm');
    expect(expiredText!).toContain('every 5 minutes');
    expect(expiredText!).toContain('reached its end time');
    expect(expiredText!).toContain("won't fire again");
    expect(expiredText!).toContain('Last note: "ping".');

    // Row should be deleted from the store.
    expect(store.get(row.id)).toBeNull();
  });

  it('cron alarm fires once then expires; alarm-expired body has correct shape', async () => {
    // Cron '0 9 * * *' at UTC → fires at 09:00 UTC. Set end_at to that exact
    // moment so the first fire fires (== boundary, INCLUSIVE) and the computed
    // next fire (next day at 09:00 UTC) exceeds end_at → expiry on the same tick.
    const ninthHour = Date.parse('2030-01-01T09:00:00Z');
    store.insert({
      kind: 'cron',
      spec: { kind: 'cron', expr: '0 9 * * *' },
      timezone: 'UTC',
      prompt: 'standup',
      next_fire_at: ninthHour,
      end_at: ninthHour,
      now: currentNow,
    });
    scheduler.bootRecover();

    // Advance to fire time and tick — fires + detects expiry in same tick.
    currentNow = ninthHour;
    await scheduler.tickForTest();

    const texts = notificationTexts(readEvents(sessionDir));
    const expiredText = texts.find((t) => t.includes('<notification kind="alarm-expired"'));
    expect(expiredText, 'alarm-expired body must land').toBeDefined();
    expect(expiredText!).toContain('Your cron alarm');
    expect(expiredText!).toContain('(0 9 * * * in UTC)');
    expect(expiredText!).toContain('reached its end time');
    expect(expiredText!).toContain("won't fire again");
    expect(expiredText!).toContain('Last note: "standup".');
  });
});
