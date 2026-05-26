import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseManageRemindersInput, ManageRemindersTool } from '../manage_reminders';
import { ReminderScheduler, ReminderStore } from '@lace/agent/reminders';
import type { ReminderRow } from '@lace/agent/reminders';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '@lace/agent/tools/types';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-mr-tool-'));
}

function ctxWithScheduler(sched: ReminderScheduler): ToolContext {
  return {
    signal: new AbortController().signal,
    reminderScheduler: sched,
  } as ToolContext;
}

describe('parseManageRemindersInput', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });
  afterEach(() => {
    process.env.TZ = origTZ;
  });

  it('schedule with delaySeconds (number)', () => {
    const r = parseManageRemindersInput({
      action: 'schedule',
      prompt: 'hi',
      next: 300,
    });
    expect(r.kind).toBe('schedule');
    if (r.kind !== 'schedule') throw new Error();
    expect(r.delaySeconds).toBe(300);
    expect(r.recurs).toBe(null);
  });

  it('schedule coerces stringified integer next', () => {
    const r = parseManageRemindersInput({
      action: 'schedule',
      prompt: 'hi',
      next: '300',
    });
    if (r.kind !== 'schedule') throw new Error();
    expect(r.delaySeconds).toBe(300);
  });

  it('schedule rejects negative integer string', () => {
    expect(() =>
      parseManageRemindersInput({ action: 'schedule', prompt: 'hi', next: '-300' })
    ).toThrow(/negative/i);
  });

  it('schedule with absolute ISO next', () => {
    const r = parseManageRemindersInput({
      action: 'schedule',
      prompt: 'hi',
      next: '2026-05-23T16:00:00Z',
    });
    if (r.kind !== 'schedule') throw new Error();
    expect(r.absoluteFireAt).toBe(new Date('2026-05-23T16:00:00Z').getTime());
  });

  it('schedule rejects ISO without offset', () => {
    expect(() =>
      parseManageRemindersInput({ action: 'schedule', prompt: 'hi', next: '2026-05-23T09:00:00' })
    ).toThrow(/offset/i);
  });

  it('schedule with cron recurs (no next)', () => {
    const r = parseManageRemindersInput({
      action: 'schedule',
      prompt: 'hi',
      recurs: '0 9 * * 1-5',
    });
    if (r.kind !== 'schedule') throw new Error();
    expect(r.recurs).toEqual({ kind: 'cron', expr: '0 9 * * 1-5' });
  });

  it('schedule with count recurs requires next as number', () => {
    const r = parseManageRemindersInput({
      action: 'schedule',
      prompt: 'hi',
      next: 1800,
      recurs: 5,
    });
    if (r.kind !== 'schedule') throw new Error();
    expect(r.recurs).toEqual({ kind: 'count', interval_ms: 1_800_000, remaining: 5 });
  });

  it('schedule rejects recurs:1', () => {
    expect(() =>
      parseManageRemindersInput({ action: 'schedule', prompt: 'hi', next: 1800, recurs: 1 })
    ).toThrow(/recurs: 1.*one-shot/i);
  });

  it('schedule rejects cron + next', () => {
    expect(() =>
      parseManageRemindersInput({
        action: 'schedule',
        prompt: 'hi',
        next: 300,
        recurs: '0 9 * * *',
      })
    ).toThrow(/not used with cron/i);
  });

  it('schedule rejects count without next', () => {
    expect(() =>
      parseManageRemindersInput({ action: 'schedule', prompt: 'hi', recurs: 5 })
    ).toThrow(/requires `next`/);
  });

  it('cancel requires id', () => {
    const r = parseManageRemindersInput({ action: 'cancel', id: 'reminder_abc123abc123' });
    expect(r.kind).toBe('cancel');
    if (r.kind !== 'cancel') throw new Error();
    expect(r.id).toBe('reminder_abc123abc123');
  });

  it('list takes no params', () => {
    const r = parseManageRemindersInput({ action: 'list' });
    expect(r.kind).toBe('list');
  });

  it('unknown action rejected', () => {
    expect(() => parseManageRemindersInput({ action: 'frobnicate' } as never)).toThrow(/action/i);
  });
});

describe('ManageRemindersTool execution', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });
  afterEach(() => {
    process.env.TZ = origTZ;
  });

  it('schedule returns the new row as JSON', async () => {
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 1_700_000_000_000,
      notifier: async () => {},
    });
    await sched.start();
    const tool = new ManageRemindersTool();
    const result = await tool.execute(
      { action: 'schedule', prompt: 'hi', next: 300 },
      ctxWithScheduler(sched)
    );
    expect(result.status).toBe('completed');
    const body = JSON.parse((result.content?.[0] as { text: string }).text) as Record<
      string,
      unknown
    >;
    expect(body.id).toMatch(/^reminder_[0-9a-f]{12}$/);
    expect(body.next_fire_at).toBeDefined();
    expect(body.recurs).toBe(null);
    await sched.stop();
  });

  it('cancel returns cancelled:true for an existing reminder', async () => {
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    const { id } = await sched.schedule({
      prompt: 'p',
      delaySeconds: 300,
      recurs: null,
    });
    const tool = new ManageRemindersTool();
    const result = await tool.execute({ action: 'cancel', id }, ctxWithScheduler(sched));
    const body = JSON.parse((result.content?.[0] as { text: string }).text) as {
      cancelled: boolean;
    };
    expect(body.cancelled).toBe(true);
    await sched.stop();
  });

  it('list returns rows in next_fire_at order with wire-shape recurs', async () => {
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 1_700_000_000_000,
      notifier: async () => {},
    });
    await sched.start();
    await sched.schedule({
      prompt: 'cron',
      delaySeconds: null,
      recurs: { kind: 'cron', expr: '0 9 * * 1-5' },
    });
    await sched.schedule({
      prompt: 'count',
      delaySeconds: 1800,
      recurs: { kind: 'count', interval_ms: 1800_000, remaining: 5 },
    });
    await sched.schedule({ prompt: 'oneshot', delaySeconds: 300, recurs: null });

    const tool = new ManageRemindersTool();
    const result = await tool.execute({ action: 'list' }, ctxWithScheduler(sched));
    const body = JSON.parse((result.content?.[0] as { text: string }).text) as {
      reminders: Array<{ recurs: unknown }>;
    };
    expect(body.reminders).toHaveLength(3);
    // The cron row's recurs is the cron string; count is the remaining number; one-shot is null.
    expect(body.reminders.find((r) => r.recurs === '0 9 * * 1-5')).toBeDefined();
    expect(body.reminders.find((r) => r.recurs === 5)).toBeDefined();
    expect(body.reminders.find((r) => r.recurs === null)).toBeDefined();
    await sched.stop();
  });

  it('list returns recurs:null for count-interval rows with remaining=1', async () => {
    const dir = tempSessionDir();
    new ReminderStore(dir).save([
      {
        id: 'reminder_aaaaaaaaaaaa',
        created_at: 0,
        next_fire_at: 1000,
        prompt: 'p',
        recurs: { kind: 'count', interval_ms: 300_000, remaining: 1 },
        fired_at: null,
        fire_count: 0,
      } satisfies ReminderRow,
    ]);
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    const tool = new ManageRemindersTool();
    const result = await tool.execute({ action: 'list' }, ctxWithScheduler(sched));
    const body = JSON.parse((result.content?.[0] as { text: string }).text) as {
      reminders: Array<{ recurs: unknown; next?: number }>;
    };
    expect(body.reminders[0].recurs).toBe(null);
    expect(body.reminders[0].next).toBe(300);
    await sched.stop();
  });
});

describe('ManageRemindersTool cancel persist_failed', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });
  afterEach(() => {
    process.env.TZ = origTZ;
  });

  it('cancel surfaces retry_safe:true on persist_failed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lace-mr-tool-'));
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    const { id } = await sched.schedule({
      prompt: 'p',
      delaySeconds: 300,
      recurs: null,
    });

    // Force the next store.save to throw — the persist for the cancel.
    const origSave = sched.store.save.bind(sched.store);
    let saveCalls = 0;
    sched.store.save = ((rows: ReminderRow[]) => {
      saveCalls++;
      if (saveCalls === 1) throw new Error('disk full');
      return origSave(rows);
    }) as typeof origSave;

    const tool = new ManageRemindersTool();
    const result = await tool.execute({ action: 'cancel', id }, {
      signal: new AbortController().signal,
      reminderScheduler: sched,
    } as ToolContext);
    const body = JSON.parse((result.content?.[0] as { text: string }).text) as {
      cancelled: boolean;
      reason?: string;
      retry_safe?: boolean;
    };
    expect(body.cancelled).toBe(false);
    expect(body.reason).toBe('persist_failed');
    expect(body.retry_safe).toBe(true);

    await sched.stop();
  });
});

describe('ManageRemindersTool ISO absolute-time precision', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });
  afterEach(() => {
    process.env.TZ = origTZ;
  });

  it('preserves millisecond precision when given an ISO timestamp', async () => {
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => Date.now(),
      notifier: async () => {},
    });
    await sched.start();

    // A specific instant with non-zero milliseconds.
    const targetIso = '2030-06-01T09:00:00.500Z';
    const targetMs = new Date(targetIso).getTime();

    const tool = new ManageRemindersTool();
    const result = await tool.execute({ action: 'schedule', prompt: 'test', next: targetIso }, {
      signal: new AbortController().signal,
      reminderScheduler: sched,
    } as ToolContext);
    expect(result.status).toBe('completed');

    // Read the row back from disk and verify next_fire_at is EXACTLY targetMs.
    const rows = new ReminderStore(dir).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].next_fire_at).toBe(targetMs);

    await sched.stop();
  });
});
