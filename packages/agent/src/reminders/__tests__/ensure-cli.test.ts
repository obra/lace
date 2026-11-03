// ABOUTME: Tests for `lace-agent reminders ensure`: adds a cron reminder to a session's
// ABOUTME: reminders.json unless a matching cron reminder exists, never clobbering other rows.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRemindersCli } from '../ensure-cli';
import type { ReminderRow } from '../types';

const SESSION = 'sess_11111111-2222-3333-4444-555555555555';

let laceDir: string;
let sessionDir: string;
let promptFile: string;
const savedEnv = { LACE_DIR: process.env.LACE_DIR, TZ: process.env.TZ };

beforeEach(() => {
  laceDir = mkdtempSync(join(tmpdir(), 'lace-ensure-cli-'));
  sessionDir = join(laceDir, 'agent-sessions', SESSION);
  mkdirSync(sessionDir, { recursive: true });
  promptFile = join(laceDir, 'prompt.txt');
  writeFileSync(promptFile, 'NIGHTLY MISE-EN-PLACE (standing job). Use your mise-en-place skill.');
  process.env.LACE_DIR = laceDir;
  process.env.TZ = 'America/Los_Angeles';
});

afterEach(() => {
  rmSync(laceDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function remindersPath(): string {
  return join(sessionDir, 'reminders.json');
}

function readRows(): ReminderRow[] {
  return (JSON.parse(readFileSync(remindersPath(), 'utf8')) as { reminders: ReminderRow[] })
    .reminders;
}

function row(overrides: Partial<ReminderRow>): ReminderRow {
  return {
    id: 'reminder_aaaaaaaaaaaa',
    created_at: 1_700_000_000_000,
    next_fire_at: 1_700_000_300_000,
    prompt: 'WEEKLY SHIPPED post',
    recurs: { kind: 'cron', expr: '0 15 * * 5' },
    fired_at: null,
    fire_count: 0,
    ...overrides,
  };
}

async function run(extra: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runRemindersCli(
    [
      'ensure',
      '--session',
      SESSION,
      '--cron',
      '0 22 * * *',
      '--prompt-file',
      promptFile,
      '--match',
      'mise-en-place',
      ...extra,
    ],
    { stdout: (l) => out.push(l), stderr: (l) => err.push(l) }
  );
  return { code, out, err, last: out.length > 0 ? JSON.parse(out[out.length - 1]!) : undefined };
}

describe('lace-agent reminders ensure', () => {
  it('creates the cron reminder when the session has none', async () => {
    const { code, last } = await run();

    expect(code).toBe(0);
    expect(last).toMatchObject({ status: 'created' });
    const rows = readRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: last.id,
      prompt: 'NIGHTLY MISE-EN-PLACE (standing job). Use your mise-en-place skill.',
      recurs: { kind: 'cron', expr: '0 22 * * *' },
      fire_count: 0,
    });
    expect(rows[0]!.id).toMatch(/^reminder_[0-9a-f]{12}$/);
  });

  it('is a no-op on a second run', async () => {
    const first = await run();
    const before = readFileSync(remindersPath(), 'utf8');

    const second = await run();

    expect(second.code).toBe(0);
    expect(second.last).toEqual({ status: 'exists', id: first.last.id });
    expect(readFileSync(remindersPath(), 'utf8')).toBe(before);
  });

  it('treats a hand-made cron reminder mentioning the text (any case) as existing', async () => {
    writeFileSync(
      remindersPath(),
      JSON.stringify({
        reminders: [
          row({
            id: 'reminder_bbbbbbbbbbbb',
            prompt: 'Nightly MISE-EN-PLACE for JC',
            recurs: { kind: 'cron', expr: '0 22 * * *' },
          }),
        ],
      })
    );
    const before = readFileSync(remindersPath(), 'utf8');

    const { code, last } = await run();

    expect(code).toBe(0);
    expect(last).toEqual({ status: 'exists', id: 'reminder_bbbbbbbbbbbb' });
    expect(readFileSync(remindersPath(), 'utf8')).toBe(before);
  });

  it('does not count a one-shot reminder that mentions the text', async () => {
    writeFileSync(
      remindersPath(),
      JSON.stringify({
        reminders: [
          row({ id: 'reminder_cccccccccccc', prompt: 'check mise-en-place ran', recurs: null }),
        ],
      })
    );

    const { code, last } = await run();

    expect(code).toBe(0);
    expect(last).toMatchObject({ status: 'created' });
    expect(readRows().map((r) => r.id)).toEqual(['reminder_cccccccccccc', last.id]);
  });

  it('keeps every existing reminder when it adds one', async () => {
    const existing = [
      row({ id: 'reminder_dddddddddddd' }),
      row({
        id: 'reminder_eeeeeeeeeeee',
        prompt: 'MORNING WAKE',
        recurs: { kind: 'cron', expr: '0 9 * * 1-5' },
      }),
    ];
    writeFileSync(remindersPath(), JSON.stringify({ reminders: existing }));

    const { code } = await run();

    expect(code).toBe(0);
    expect(readRows().slice(0, 2)).toEqual(existing);
    expect(readRows()).toHaveLength(3);
  });

  it('refuses a malformed reminders.json without touching it', async () => {
    writeFileSync(remindersPath(), '{"reminders": [ {"id": "reminder_ffff');

    const { code, err } = await run();

    expect(code).toBe(3);
    expect(err.join('\n')).toContain('reminders.json');
    expect(readFileSync(remindersPath(), 'utf8')).toBe('{"reminders": [ {"id": "reminder_ffff');
  });

  it('refuses a reminders.json with a row that has no id', async () => {
    const content = JSON.stringify({ reminders: [{ ...row({}), id: 42 }] });
    writeFileSync(remindersPath(), content);

    const { code } = await run();

    expect(code).toBe(3);
    expect(readFileSync(remindersPath(), 'utf8')).toBe(content);
  });

  it('exits 2 for a session that does not exist', async () => {
    rmSync(sessionDir, { recursive: true, force: true });

    const { code, err } = await run();

    expect(code).toBe(2);
    expect(err.join('\n')).toContain(`session not found: ${SESSION}`);
    expect(existsSync(remindersPath())).toBe(false);
  });

  it('rejects an invalid cron expression', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runRemindersCli(
      [
        'ensure',
        '--session',
        SESSION,
        '--cron',
        'not a cron',
        '--prompt-file',
        promptFile,
        '--match',
        'x',
      ],
      { stdout: (l) => out.push(l), stderr: (l) => err.push(l) }
    );

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('invalid cron expression');
    expect(existsSync(remindersPath())).toBe(false);
  });

  it('rejects a cron that fires more often than every 5 minutes', async () => {
    const err: string[] = [];
    const code = await runRemindersCli(
      [
        'ensure',
        '--session',
        SESSION,
        '--cron',
        '* * * * *',
        '--prompt-file',
        promptFile,
        '--match',
        'x',
      ],
      { stdout: () => {}, stderr: (l) => err.push(l) }
    );

    expect(code).toBe(1);
    expect(existsSync(remindersPath())).toBe(false);
  });

  it('rejects when the session is at the 50-reminder cap', async () => {
    const full = Array.from({ length: 50 }, (_, i) =>
      row({ id: `reminder_${i.toString(16).padStart(12, '0')}`, prompt: `job ${i}` })
    );
    writeFileSync(remindersPath(), JSON.stringify({ reminders: full }));
    const before = readFileSync(remindersPath(), 'utf8');

    const { code, err } = await run();

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('50');
    expect(readFileSync(remindersPath(), 'utf8')).toBe(before);
  });

  it('fails with usage when a required flag is missing', async () => {
    const err: string[] = [];
    const code = await runRemindersCli(['ensure', '--session', SESSION], {
      stdout: () => {},
      stderr: (l) => err.push(l),
    });

    expect(code).toBe(64);
    expect(err.join('\n')).toContain('usage: lace-agent reminders ensure');
  });
});
