// ABOUTME: A reminders.json that doesn't parse as {"reminders":[rows with string ids]} must never be
// ABOUTME: overwritten: listStrict() refuses it, and schedule() / boot recovery leave it untouched.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReminderScheduler } from '../scheduler';
import { ReminderStore, ReminderStoreUnreadableError } from '../store';
import type { ReminderRow } from '../types';

const dirs: string[] = [];
function sessionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lace-rstrict-'));
  dirs.push(dir);
  return dir;
}

const origTZ = process.env.TZ;
beforeEach(() => {
  process.env.TZ = 'UTC';
});
afterEach(() => {
  process.env.TZ = origTZ;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function row(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    id: 'reminder_aaaaaaaaaaaa',
    created_at: 1_700_000_000_000,
    next_fire_at: 1_700_000_000_500,
    prompt: 'keep me',
    recurs: { kind: 'cron', expr: '0 9 * * *' },
    fired_at: null,
    fire_count: 0,
    ...overrides,
  };
}

function scheduler(dir: string, now = 1_700_000_100_000): ReminderScheduler {
  return new ReminderScheduler({ sessionDir: dir, now: () => now, notifier: () => {} });
}

const UNREADABLE: Array<[string, string]> = [
  ['truncated JSON', '{"reminders": [ {"id": "reminder_aaaa'],
  ['a top-level array', '[]'],
  ['an object without a reminders array', '{"other": 1}'],
  ['a reminders value that is not an array', '{"reminders": {}}'],
  ['a row without a string id', JSON.stringify({ reminders: [{ ...row(), id: 7 }] })],
];

describe('ReminderStore.listStrict', () => {
  it('returns [] for a missing file and the rows for a good one', () => {
    const dir = sessionDir();
    const store = new ReminderStore(dir);
    expect(store.listStrict()).toEqual([]);

    store.save([row()]);
    expect(store.listStrict()).toEqual([row()]);
  });

  it.each(UNREADABLE)('throws ReminderStoreUnreadableError for %s', (_name, content) => {
    const dir = sessionDir();
    writeFileSync(join(dir, 'reminders.json'), content);

    let thrown: unknown;
    try {
      new ReminderStore(dir).listStrict();
    } catch (err) {
      thrown = err;
    }
    // Both checks: instanceof fails loudly if the class isn't exported at all.
    expect(thrown).toBeInstanceOf(ReminderStoreUnreadableError);
    expect(thrown).toMatchObject({ name: 'ReminderStoreUnreadableError' });
  });
});

/** One good row plus one row list() silently skips: the shape partial corruption leaves. */
function mixedFile(good: ReminderRow): string {
  return JSON.stringify({ reminders: [good, { ...row({ id: 'x' }), id: 42 }] });
}

describe('writers never overwrite an unreadable reminders.json', () => {
  it.each(UNREADABLE)(
    'schedule() refuses %s and leaves the file as it was',
    async (_name, content) => {
      const dir = sessionDir();
      const file = join(dir, 'reminders.json');
      writeFileSync(file, content);

      await expect(
        scheduler(dir).schedule({ prompt: 'new', delaySeconds: 600, recurs: null })
      ).rejects.toThrow(expect.objectContaining({ name: 'ReminderStoreUnreadableError' }));
      expect(readFileSync(file, 'utf8')).toBe(content);
    }
  );

  it('cancel() refuses a partly unreadable file instead of dropping the bad row', async () => {
    const dir = sessionDir();
    const file = join(dir, 'reminders.json');
    const content = mixedFile(row({ id: 'reminder_bbbbbbbbbbbb' }));
    writeFileSync(file, content);

    await expect(scheduler(dir).cancel('reminder_bbbbbbbbbbbb')).rejects.toThrow(
      expect.objectContaining({ name: 'ReminderStoreUnreadableError' })
    );
    expect(readFileSync(file, 'utf8')).toBe(content);
  });

  it('a due reminder in a partly unreadable file reports the error, does not fire, and leaves the file', async () => {
    const dir = sessionDir();
    const file = join(dir, 'reminders.json');
    const content = mixedFile(
      row({ id: 'reminder_cccccccccccc', next_fire_at: 1000, recurs: null })
    );
    writeFileSync(file, content);
    const errors: unknown[] = [];
    const fired: unknown[] = [];
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: (ctx) => {
        fired.push(ctx);
      },
      onError: (err) => errors.push(err),
    });

    await sched.start();
    await sched.tickForTest(2000);
    // Not put back on the heap, or the live timer would refire it on every tick.
    const heap = (sched as unknown as { heap: Array<{ id: string }> }).heap;
    await sched.stop();

    expect(fired).toEqual([]);
    expect(errors).toEqual([expect.objectContaining({ name: 'ReminderStoreUnreadableError' })]);
    expect(heap.find((e) => e.id === 'reminder_cccccccccccc')).toBeUndefined();
    expect(readFileSync(file, 'utf8')).toBe(content);
  });

  it('boot recovery does not rewrite a file with a row it cannot read', async () => {
    const dir = sessionDir();
    const file = join(dir, 'reminders.json');
    // The good cron row's next_fire_at is stale, so recovery would normally recompute and save,
    // which used to drop the id-less row.
    const content = JSON.stringify({
      reminders: [row({ next_fire_at: 1 }), { ...row({ id: 'x' }), id: 42 }],
    });
    writeFileSync(file, content);

    const sched = scheduler(dir);
    await sched.start();
    await sched.stop();

    expect(readFileSync(file, 'utf8')).toBe(content);
  });
});
