// ABOUTME: Best-effort GC reminder for per_invocation delegate scratch dirs
// ABOUTME: Schedules a daily cron reminder to clean up /var/sen/instance/work/<session-id> dirs

import type { ReminderScheduler } from '@lace/agent/reminders';
import { logger } from '@lace/agent/utils/logger';

export const SCRATCH_GC_REMINDER_SENTINEL = '<scratch-gc>';

export const SCRATCH_GC_REMINDER_PROMPT = `<scratch-gc>
Review the host directory /var/sen/instance/work/ for scratch dirs left behind by per_invocation delegates. Each subdir is named after a delegate's subagent session id (sess_...). Decide which can be removed — old artifacts you've already consumed, completed runs whose output is logged elsewhere, anything not load-bearing — and use delegate(persona='shell', prompt='rm -rf /var/sen/instance/work/<id> ...') to clean them up. Leave any dir whose contents you still need to read or pass to another subagent.`;

// In-memory dedup so we don't list reminders on every per_invocation delegate.
// Reset per session — the flag is a module-level Set keyed on sessionId.
const ensuredThisSession = new Set<string>();

export async function ensureScratchGcReminder(
  reminderScheduler: ReminderScheduler,
  sessionId: string
): Promise<void> {
  if (ensuredThisSession.has(sessionId)) return;
  try {
    const existing = reminderScheduler.store.list();
    const alreadyScheduled = existing.some((r) =>
      r.prompt.startsWith(SCRATCH_GC_REMINDER_SENTINEL)
    );
    if (!alreadyScheduled) {
      await reminderScheduler.schedule({
        prompt: SCRATCH_GC_REMINDER_PROMPT,
        delaySeconds: null,
        recurs: { kind: 'cron', expr: '0 6 * * *' },
      });
    }
    ensuredThisSession.add(sessionId);
  } catch (err) {
    logger.warn('delegate.scratch_gc_reminder.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // best-effort: do not block delegate
  }
}

/**
 * Reset the in-memory dedup set. For testing only — not exported in the main
 * package path, called directly in tests to isolate dedup state.
 */
export function _resetEnsuredThisSessionForTest(): void {
  ensuredThisSession.clear();
}
