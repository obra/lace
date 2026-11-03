// ABOUTME: Selects retrieval-only message bodies without changing provider content or originals.

import type { RecallInput } from '@lace/ent-protocol';

export function recallInputForContent(recall: unknown, content: string): RecallInput {
  if (
    recall &&
    typeof recall === 'object' &&
    'query' in recall &&
    typeof recall.query === 'string'
  ) {
    return {
      query: recall.query,
      ...('context' in recall && typeof recall.context === 'string'
        ? { context: recall.context }
        : {}),
    };
  }
  return { query: content };
}

/** Catch-up bodies precede the current message in the conversational retrieval view. */
export function recallConversationText(input: RecallInput): string {
  return [input.context, input.query].filter(Boolean).join('\n');
}

export type OrdinaryCue = { ids: number[]; text: string };

/** Bound the first input at its start; coalesced arrivals give newer input priority. */
export function appendOrdinaryCue(
  cue: OrdinaryCue | undefined,
  eventSeq: number,
  query: string
): OrdinaryCue {
  return cue
    ? {
        ids: [...cue.ids, eventSeq],
        text: [cue.text, query].filter(Boolean).join('\n').slice(-2400),
      }
    : { ids: [eventSeq], text: query.slice(0, 2400) };
}
