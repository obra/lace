// ABOUTME: Unit tests for the AlarmRow.spec → AlarmFiredCompose / AlarmExpiredCompose
// ABOUTME: mapping in server.ts. This is the wiring that makes once-relative produce
// ABOUTME: "Your N-minute timer just fired" wording in production. It covers what the
// ABOUTME: deleted alarms.relative-minutes.e2e.test.ts exercised, without real-clock waits.

import { describe, it, expect } from 'vitest';
import { specToFiredCompose, specToExpiredCompose } from '../server';
import { composeAlarmFiredBody, composeAlarmExpiredBody } from '../notifications';
import type { AlarmRow } from '../alarms/types';

function baseRow(overrides: Partial<AlarmRow>): AlarmRow {
  return {
    id: 'alarm_x',
    kind: 'once',
    spec: { kind: 'once-relative', minutes: 1 },
    timezone: 'UTC',
    prompt: 'ping',
    status: 'firing',
    next_fire_at: 0,
    created_at: 0,
    fired_at: null,
    end_at: null,
    ...overrides,
  };
}

describe('specToFiredCompose + composeAlarmFiredBody (PRI-1744 server wiring)', () => {
  it('once-relative: N-minute timer wording', () => {
    const row = baseRow({
      kind: 'once',
      spec: { kind: 'once-relative', minutes: 5 },
      prompt: 'stretch',
    });
    const body = composeAlarmFiredBody(specToFiredCompose(row));
    expect(body).toBe('Your 5-minute timer just fired. Note: "stretch".');
  });

  it('once-relative: singular minute form', () => {
    const row = baseRow({
      kind: 'once',
      spec: { kind: 'once-relative', minutes: 1 },
      prompt: 'now',
    });
    const body = composeAlarmFiredBody(specToFiredCompose(row));
    expect(body).toBe('Your 1-minute timer just fired. Note: "now".');
  });

  it('once-absolute: formatted ISO with timezone', () => {
    const fireAt = Date.parse('2026-12-25T09:00:00Z');
    const row = baseRow({
      kind: 'once',
      spec: { kind: 'once-absolute', iso: '2026-12-25T09:00:00Z' },
      timezone: 'UTC',
      next_fire_at: fireAt,
      prompt: 'eggnog',
    });
    const body = composeAlarmFiredBody(specToFiredCompose(row));
    expect(body).toBe('Your alarm for 2026-12-25T09:00:00+00:00 (UTC) just fired. Note: "eggnog".');
  });

  it('cron: includes alarm id, expr, timezone', () => {
    const row = baseRow({
      id: 'alarm_cron1',
      kind: 'cron',
      spec: { kind: 'cron', expr: '0 9 * * *' },
      timezone: 'America/Los_Angeles',
      prompt: 'standup',
    });
    const body = composeAlarmFiredBody(specToFiredCompose(row));
    expect(body).toBe(
      'Your cron alarm alarm_cron1 (0 9 * * * in America/Los_Angeles) just fired. Note: "standup".'
    );
  });

  it('interval: pluralizes minutes > 1', () => {
    const row = baseRow({
      id: 'alarm_int1',
      kind: 'interval',
      spec: { kind: 'interval', minutes: 73 },
      prompt: 'ping',
    });
    const body = composeAlarmFiredBody(specToFiredCompose(row));
    expect(body).toBe(
      'Your interval alarm alarm_int1 (every 73 minutes) just fired. Note: "ping".'
    );
  });

  it('interval: singular minute form', () => {
    const row = baseRow({
      id: 'alarm_int2',
      kind: 'interval',
      spec: { kind: 'interval', minutes: 1 },
      prompt: 'heartbeat',
    });
    const body = composeAlarmFiredBody(specToFiredCompose(row));
    expect(body).toBe(
      'Your interval alarm alarm_int2 (every 1 minute) just fired. Note: "heartbeat".'
    );
  });
});

describe('specToExpiredCompose + composeAlarmExpiredBody (PRI-1744 server wiring)', () => {
  it('cron with end_at produces expired body', () => {
    const endTime = Date.parse('2027-01-01T00:00:00Z');
    const row = baseRow({
      id: 'alarm_cron1',
      kind: 'cron',
      spec: { kind: 'cron', expr: '0 9 * * *' },
      timezone: 'America/Los_Angeles',
      end_at: endTime,
      prompt: 'standup',
    });
    const compose = specToExpiredCompose(row);
    expect(compose, 'cron with end_at must produce a compose object').not.toBeNull();
    const body = composeAlarmExpiredBody(compose!);
    expect(body).toContain('Your cron alarm alarm_cron1');
    expect(body).toContain('(0 9 * * * in America/Los_Angeles)');
    expect(body).toContain('reached its end time');
    // The end time is formatted in the alarm's timezone (America/Los_Angeles),
    // so 2027-01-01T00:00:00Z renders as 2026-12-31T16:00:00-08:00.
    expect(body).toContain('America/Los_Angeles');
    expect(body).toContain("won't fire again");
    expect(body).toContain('Last note: "standup".');
  });

  it('interval with end_at produces expired body', () => {
    const endTime = Date.parse('2026-07-01T00:00:00Z');
    const row = baseRow({
      id: 'alarm_int1',
      kind: 'interval',
      spec: { kind: 'interval', minutes: 73 },
      end_at: endTime,
      prompt: 'ping',
    });
    const compose = specToExpiredCompose(row);
    expect(compose, 'interval with end_at must produce a compose object').not.toBeNull();
    const body = composeAlarmExpiredBody(compose!);
    expect(body).toContain('Your interval alarm alarm_int1');
    expect(body).toContain('(every 73 minutes)');
    expect(body).toContain('reached its end time');
  });

  it('row without end_at returns null (no expiration possible)', () => {
    const row = baseRow({ end_at: null });
    expect(specToExpiredCompose(row)).toBeNull();
  });
});
