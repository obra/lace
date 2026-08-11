// ABOUTME: The single turn-entry projection load. Reads + parses the durable log
// ONCE and derives everything a turn needs to start: the provider message prefix +
// system prompt, the files-read set, and the max folded seq (the inject
// watermark). Replaces three independent full-log reads at runner turn entry.

import * as pe from './parsed-events';
import {
  buildProviderMessagesFromParsedEvents,
  type BuiltProviderMessages,
} from './message-builder';
import { deriveFilesReadFromParsedEvents } from '@lace/agent/storage/files-from-events';

export type TurnEntryProjection = BuiltProviderMessages & {
  filesRead: Set<string>;
  // The highest eventSeq reflected in `messages`. The runner seeds the inject
  // tailer here: every event at or below this seq is already in the prefix, so
  // the tailer appending it again would double-deliver it to the model.
  maxFoldedSeq: number;
};

export function loadTurnEntryProjection(sessionDir: string, cwd: string): TurnEntryProjection {
  const events = pe.readParsedSessionEvents(sessionDir);
  const { messages, systemPrompt } = buildProviderMessagesFromParsedEvents(events);
  const filesRead = deriveFilesReadFromParsedEvents(events, cwd);
  const maxFoldedSeq = events.reduce((max, e) => (e.eventSeq > max ? e.eventSeq : max), 0);
  return { messages, systemPrompt, filesRead, maxFoldedSeq };
}
