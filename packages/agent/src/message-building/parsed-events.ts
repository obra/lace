// ABOUTME: Reads the durable session event log and parses every line ONCE into a
// sorted ParsedSessionEvent[]. The turn-entry derivers (messages, files-read,
// last-turn-end) all fold over this single parse instead of each re-reading and
// re-parsing the whole log. I/O + parse only — no wire bytes, no seq assignment.

import { readAllSessionEventLines } from '@lace/agent/storage/event-log';

export type ParsedSessionEvent = {
  eventSeq: number;
  type: string;
  data: Record<string, unknown>;
};

export function readParsedSessionEvents(sessionDir: string): ParsedSessionEvent[] {
  const lines = readAllSessionEventLines(sessionDir); // already shard+legacy aware, sorted
  const events: ParsedSessionEvent[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      const p = JSON.parse(line) as { eventSeq?: unknown; type?: unknown; data?: unknown };
      events.push({
        eventSeq: typeof p.eventSeq === 'number' ? p.eventSeq : 0,
        type: typeof p.type === 'string' ? p.type : '',
        data: typeof p.data === 'object' && p.data ? (p.data as Record<string, unknown>) : {},
      });
    } catch {
      // skip malformed
    }
  }
  return events;
}
