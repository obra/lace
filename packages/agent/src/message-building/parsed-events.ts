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

/**
 * Parse a single JSONL line into a ParsedSessionEvent, or `null` for a
 * blank/malformed line. The byte-offset tail reader uses this so a tail-parsed
 * event is field-for-field identical to one from `readParsedSessionEvents`.
 */
export function parseSessionEventLine(line: string): ParsedSessionEvent | null {
  if (!line) return null;
  try {
    const p = JSON.parse(line) as { eventSeq?: unknown; type?: unknown; data?: unknown };
    return {
      eventSeq: typeof p.eventSeq === 'number' ? p.eventSeq : 0,
      type: typeof p.type === 'string' ? p.type : '',
      data: typeof p.data === 'object' && p.data ? (p.data as Record<string, unknown>) : {},
    };
  } catch {
    return null;
  }
}

export function readParsedSessionEvents(sessionDir: string): ParsedSessionEvent[] {
  const lines = readAllSessionEventLines(sessionDir); // already shard+legacy aware, sorted
  const events: ParsedSessionEvent[] = [];
  for (const line of lines) {
    const parsed = parseSessionEventLine(line);
    if (parsed) events.push(parsed);
  }
  return events;
}
