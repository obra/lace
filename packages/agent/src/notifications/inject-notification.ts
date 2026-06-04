// ABOUTME: injectNotification — the single utility for writing agent-facing
// ABOUTME: <notification> blocks into a session's events.jsonl as a context_injected
// ABOUTME: durable event with priority='immediate'. Optionally triggers an internal
// ABOUTME: turn when the target is the active session and the agent is idle.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendDurableEvent } from '../storage/event-log';
import type { SessionState } from '../storage/session-store';
import { buildNotification, type NotificationKind } from './notification-wrapper';

export interface IdleWakeHooks {
  /** Is `sessionDir` the current lace process's active session? */
  isActive: (sessionDir: string) => boolean;
  /** Is the agent currently in a turn? */
  hasActiveTurn: () => boolean;
  /** Kick the agent to run one internal turn so it picks up the just-written event. */
  triggerInternalTurn: () => void;
}

export interface InjectNotificationOptions {
  sessionDir: string;
  kind: NotificationKind;
  identifiers?: Record<string, string>;
  attributes?: Record<string, string | number | null | undefined>;
  body: string;
  /**
   * Producer-defined demux key. When supplied, written onto the
   * `context_injected` event's `data.track` so track-based compaction and
   * analytics can attribute the notification to the correct conversation track.
   * Optional — omit for notifications that are not tied to a specific track
   * (e.g. internal breakpoints, system notifications).
   */
  track?: string;
  /** Optional — omit for cross-process writes (e.g. subagent → parent). */
  idleWake?: IdleWakeHooks;
}

function readSessionStateBestEffort(sessionDir: string): SessionState {
  try {
    const parsed = JSON.parse(
      readFileSync(join(sessionDir, 'state.json'), 'utf8')
    ) as Partial<SessionState>;
    return {
      nextEventSeq: typeof parsed.nextEventSeq === 'number' ? parsed.nextEventSeq : 1,
      nextStreamSeq: typeof parsed.nextStreamSeq === 'number' ? parsed.nextStreamSeq : 1,
    };
  } catch {
    return { nextEventSeq: 1, nextStreamSeq: 1 };
  }
}

export function injectNotification(opts: InjectNotificationOptions): void {
  const text = buildNotification({
    kind: opts.kind,
    ...(opts.identifiers ? { identifiers: opts.identifiers } : {}),
    ...(opts.attributes ? { attributes: opts.attributes } : {}),
    body: opts.body,
  });
  const state = readSessionStateBestEffort(opts.sessionDir);
  appendDurableEvent(opts.sessionDir, state, {
    type: 'context_injected',
    data: {
      content: [{ type: 'text', text }],
      priority: 'immediate',
      ...(opts.track !== undefined ? { track: opts.track } : {}),
    },
  });
  // We intentionally do not rewrite state.json: appendDurableEvent's nextState
  // is purely a sequence accounting; the runner's authoritative position is
  // recomputed via deriveNextEventSeqFromEventLog. For cross-process writes
  // (subagent → parent), the parent's process owns state.json and will
  // observe the new eventSeq on its next read.

  if (opts.idleWake && opts.idleWake.isActive(opts.sessionDir) && !opts.idleWake.hasActiveTurn()) {
    opts.idleWake.triggerInternalTurn();
  }
}
