import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseManageRemindersInput } from '../manage_reminders';

describe('parseManageRemindersInput', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'UTC'; });
  afterEach(() => { process.env.TZ = origTZ; });

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
    expect(() =>
      parseManageRemindersInput({ action: 'frobnicate' } as never)
    ).toThrow(/action/i);
  });
});
