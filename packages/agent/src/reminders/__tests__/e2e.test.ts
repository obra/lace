// ABOUTME: End-to-end smoke for reminders: schedule via tool → scheduler ticks
// ABOUTME: → notifier composes a valid <notification kind="reminder"> via wrapper.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReminderScheduler } from '../scheduler';
import { ManageRemindersTool } from '@lace/agent/tools/implementations/manage_reminders';
import { buildNotification, composeReminderBody } from '@lace/agent/notifications';
import type { ToolContext } from '@lace/agent/tools/types';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-reminders-e2e-'));
}

describe('Reminders end-to-end (tool → scheduler → notifier)', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });
  afterEach(() => {
    process.env.TZ = origTZ;
  });

  it('schedule via tool, fire, observe notification body', async () => {
    const dir = tempSessionDir();
    const observed: string[] = [];

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => Date.now(),
      notifier: async (ctx) => {
        const text = buildNotification({
          kind: 'reminder',
          identifiers: { id: ctx.row.id },
          attributes: {
            'set-at': new Date(ctx.row.created_at).toISOString(),
            'fired-at': new Date(ctx.firedAt).toISOString(),
            'fire-count': ctx.row.recurs === null ? undefined : ctx.fireCount,
            'last-fired-at':
              ctx.lastFiredAt !== null
                ? new Date(ctx.lastFiredAt).toISOString()
                : undefined,
            'next-fire-at':
              ctx.nextFireAt !== null
                ? new Date(ctx.nextFireAt).toISOString()
                : undefined,
          },
          body: composeReminderBody({ prompt: ctx.row.prompt }),
        });
        observed.push(text);
      },
    });
    await sched.start();

    const tool = new ManageRemindersTool();
    await tool.execute(
      { action: 'schedule', prompt: 'fire soon', next: 0 }, // 0-second delay
      { signal: new AbortController().signal, reminderScheduler: sched } as ToolContext
    );

    // The scheduler should fire it on its first tick. Wait briefly.
    await new Promise((r) => setTimeout(r, 100));

    expect(observed).toHaveLength(1);
    expect(observed[0]).toContain('<notification kind="reminder"');
    expect(observed[0]).toContain('fire soon');
    // One-shot: no fire-count, no last-fired-at, no next-fire-at attributes.
    expect(observed[0]).not.toContain('fire-count=');
    expect(observed[0]).not.toContain('last-fired-at=');
    expect(observed[0]).not.toContain('next-fire-at=');
    // But set-at and fired-at must be present.
    expect(observed[0]).toContain('set-at="');
    expect(observed[0]).toContain('fired-at="');

    await sched.stop();
  });
});
