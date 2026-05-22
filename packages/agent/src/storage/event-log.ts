// ABOUTME: Durable event persistence layer for session events
// ABOUTME: Handles reading, writing, and summarizing events from events.jsonl files

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SessionState } from './session-store';

export function deriveNextEventSeqFromEventLog(sessionDir: string): number {
  const eventsPath = path.join(sessionDir, 'events.jsonl');

  let raw = '';
  try {
    raw = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return 1;
  }

  let maxSeq: number | undefined;
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Partial<DurableEvent>;
      const seq = parsed.eventSeq;
      if (typeof seq !== 'number' || !Number.isInteger(seq)) continue;
      if (maxSeq === undefined || seq > maxSeq) maxSeq = seq;
    } catch {
      // Ignore malformed line (e.g. partial write)
    }
  }

  return (maxSeq ?? 0) + 1;
}

/**
 * Returns true if there are any `context_injected` events with
 * `priority='immediate'` in events.jsonl whose `eventSeq` is strictly
 * greater than `afterEventSeq`. Used by the prompt handler to detect
 * notifications that landed during a turn but were not picked up
 * before turn_end was written (Bug 3 race condition).
 */
export function hasPendingImmediateInjects(sessionDir: string, afterEventSeq: number): boolean {
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return false;
  }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Partial<DurableEvent>;
      if (parsed.type !== 'context_injected') continue;
      if (typeof parsed.eventSeq !== 'number') continue;
      if (parsed.eventSeq <= afterEventSeq) continue;
      const data = parsed.data as { priority?: unknown } | undefined;
      if (data?.priority !== 'immediate') continue;
      return true;
    } catch {
      // ignore malformed line
    }
  }
  return false;
}

/**
 * Find the eventSeq of the most recent `turn_end` event in the log, or `null`
 * if no turn has completed yet. Used by the conversation runner to compute its
 * initial immediate-inject watermark — any context_injected event newer than
 * the last turn_end is unprocessed.
 */
export function findLastTurnEndEventSeq(sessionDir: string): number | null {
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return null;
  }
  let last: number | null = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Partial<DurableEvent>;
      if (parsed.type !== 'turn_end') continue;
      if (typeof parsed.eventSeq !== 'number') continue;
      if (last === null || parsed.eventSeq > last) last = parsed.eventSeq;
    } catch {
      // ignore malformed line
    }
  }
  return last;
}

export type DurableEvent = {
  eventSeq: number;
  timestamp: string;
  turnId?: string;
  turnSeq?: number;
  type: string;
  data: Record<string, unknown>;
};

export function summarizeDurableEvents(sessionDir: string): {
  messageCount: number;
  turnCount: number;
  lastActive?: string;
} {
  const eventsPath = path.join(sessionDir, 'events.jsonl');

  let raw = '';
  try {
    raw = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return { messageCount: 0, turnCount: 0, lastActive: undefined };
  }

  let messageCount = 0;
  let turnCount = 0;
  let lastActive: string | undefined;

  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Partial<DurableEvent>;
      if (parsed.type === 'prompt' || parsed.type === 'message') {
        messageCount++;
      }
      if (parsed.type === 'turn_start') {
        turnCount++;
      }
      if (typeof parsed.timestamp === 'string' && parsed.timestamp.length > 0) {
        if (!lastActive || parsed.timestamp > lastActive) lastActive = parsed.timestamp;
      }
    } catch {
      // Ignore malformed line (e.g. partial write)
    }
  }

  return { messageCount, turnCount, lastActive };
}

export function appendDurableEvent(
  sessionDir: string,
  state: SessionState,
  event: Omit<DurableEvent, 'eventSeq' | 'timestamp'>
): { nextState: SessionState; written: DurableEvent } {
  const eventsPath = path.join(sessionDir, 'events.jsonl');

  // Derive from the durable log in case state.json was stale/corrupted.
  const eventSeq = deriveNextEventSeqFromEventLog(sessionDir);

  // Ensure we never accidentally join JSON objects when the previous write was truncated
  // and did not end with a newline.
  try {
    const stat = fs.statSync(eventsPath);
    if (stat.size > 0) {
      const fd = fs.openSync(eventsPath, 'r');
      try {
        const buf = Buffer.alloc(1);
        fs.readSync(fd, buf, 0, 1, stat.size - 1);
        if (buf.toString('utf8') !== '\n') {
          fs.appendFileSync(eventsPath, '\n', { encoding: 'utf8' });
        }
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch {
    // If the file doesn't exist or can't be read, we'll let appendFileSync below create it.
  }

  const written: DurableEvent = {
    eventSeq,
    timestamp: new Date().toISOString(),
    ...event,
  };

  fs.appendFileSync(eventsPath, `${JSON.stringify(written)}\n`, { encoding: 'utf8' });

  return {
    written,
    nextState: { ...state, nextEventSeq: state.nextEventSeq + 1 },
  };
}

export function readDurableEvents(
  sessionDir: string,
  options: { afterEventSeq?: number; limit?: number; types?: string[] }
): { events: DurableEvent[]; hasMore: boolean } {
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  const after = options.afterEventSeq ?? 0;
  const limit = options.limit ?? 100;
  const typeFilter = options.types ? new Set(options.types) : null;

  let raw = '';
  try {
    raw = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return { events: [], hasMore: false };
  }

  const events: DurableEvent[] = [];
  let hasMore = false;
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as DurableEvent;
      if (typeof parsed.eventSeq !== 'number') continue;
      if (parsed.eventSeq <= after) continue;
      if (typeFilter && !typeFilter.has(parsed.type)) continue;
      if (events.length < limit) {
        events.push(parsed);
        continue;
      }

      hasMore = true;
      break;
    } catch {
      // Ignore malformed line (e.g. partial write)
    }
  }

  return { events, hasMore };
}

// Export typed versions for callers that want type safety
export type { TypedDurableEvent, DurableEventData } from './event-types';
