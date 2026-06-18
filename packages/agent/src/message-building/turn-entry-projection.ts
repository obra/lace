// ABOUTME: The single turn-entry projection load. Reads + parses the durable log
// ONCE and derives everything a turn needs to start: the provider message prefix +
// system prompt, the files-read set, and the last turn_end seq (the inject
// watermark). Replaces three independent full-log reads at runner turn entry.

import * as pe from './parsed-events';
import {
  buildProviderMessagesFromParsedEvents,
  type BuiltProviderMessages,
} from './message-builder';
import { deriveFilesReadFromParsedEvents } from '@lace/agent/storage/files-from-events';
import { findLastTurnEndSeqFromParsedEvents } from '@lace/agent/storage/event-log';

export type TurnEntryProjection = BuiltProviderMessages & {
  filesRead: Set<string>;
  lastTurnEndSeq: number | null;
};

export function loadTurnEntryProjection(sessionDir: string, cwd: string): TurnEntryProjection {
  const events = pe.readParsedSessionEvents(sessionDir);
  const { messages, systemPrompt } = buildProviderMessagesFromParsedEvents(events);
  const filesRead = deriveFilesReadFromParsedEvents(events, cwd);
  const lastTurnEndSeq = findLastTurnEndSeqFromParsedEvents(events);
  return { messages, systemPrompt, filesRead, lastTurnEndSeq };
}
