import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReminderStore } from '../store';
import type { ReminderRow } from '../types';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-reminders-'));
}

function exampleRow(id = 'reminder_abc123abc123'): ReminderRow {
  return {
    id,
    created_at: 1_700_000_000_000,
    next_fire_at: 1_700_000_300_000,
    prompt: 'follow up',
    recurs: null,
    fired_at: null,
    fire_count: 0,
  };
}

describe('ReminderStore', () => {
  it('empty when no file exists', () => {
    const s = new ReminderStore(tempSessionDir());
    expect(s.list()).toEqual([]);
  });

  it('save writes reminders.json atomically', () => {
    const dir = tempSessionDir();
    const s = new ReminderStore(dir);
    s.save([exampleRow()]);
    expect(existsSync(join(dir, 'reminders.json'))).toBe(true);
    const raw = JSON.parse(readFileSync(join(dir, 'reminders.json'), 'utf8')) as {
      reminders: ReminderRow[];
    };
    expect(raw.reminders).toHaveLength(1);
    expect(raw.reminders[0].id).toBe('reminder_abc123abc123');
  });

  it('load reads previously-saved snapshot', () => {
    const dir = tempSessionDir();
    const s = new ReminderStore(dir);
    s.save([exampleRow('reminder_111111111111'), exampleRow('reminder_222222222222')]);
    const s2 = new ReminderStore(dir);
    const rows = s2.list();
    expect(rows.map((r) => r.id).sort()).toEqual([
      'reminder_111111111111',
      'reminder_222222222222',
    ]);
  });

  it('load tolerates malformed json without crashing', () => {
    const dir = tempSessionDir();
    writeFileSync(join(dir, 'reminders.json'), 'not json{{{');
    const s = new ReminderStore(dir);
    expect(s.list()).toEqual([]);
  });

  it('load discards rows with non-string id', () => {
    const dir = tempSessionDir();
    writeFileSync(
      join(dir, 'reminders.json'),
      JSON.stringify({ reminders: [{ id: 42, prompt: 'bad' }, exampleRow()] })
    );
    const s = new ReminderStore(dir);
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0].id).toBe('reminder_abc123abc123');
  });

  it('save creates the session directory if missing', () => {
    const dir = join(tempSessionDir(), 'subdir', 'nested');
    const s = new ReminderStore(dir);
    s.save([exampleRow()]);
    expect(existsSync(join(dir, 'reminders.json'))).toBe(true);
  });
});
