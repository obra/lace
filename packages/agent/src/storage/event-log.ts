import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SessionState } from './session-store.js';

export type DurableEvent = {
  eventSeq: number;
  timestamp: string;
  turnId?: string;
  turnSeq?: number;
  type: string;
  data: Record<string, unknown>;
};

export function appendDurableEvent(
  sessionDir: string,
  state: SessionState,
  event: Omit<DurableEvent, 'eventSeq' | 'timestamp'>
): { nextState: SessionState; written: DurableEvent } {
  const eventsPath = path.join(sessionDir, 'events.jsonl');

  const written: DurableEvent = {
    eventSeq: state.nextEventSeq,
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
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as DurableEvent;
      if (typeof parsed.eventSeq !== 'number') continue;
      if (parsed.eventSeq <= after) continue;
      if (typeFilter && !typeFilter.has(parsed.type)) continue;
      events.push(parsed);
      if (events.length >= limit) break;
    } catch {
      // Ignore malformed line (e.g. partial write)
    }
  }

  const hasMore = events.length >= limit && lines.length > 0;
  return { events, hasMore };
}
