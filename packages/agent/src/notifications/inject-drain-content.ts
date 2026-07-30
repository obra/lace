// ABOUTME: Decides what content an inject-drain follow-up turn should carry.
// ABOUTME: An empty prompt only surfaces an inject while it is still the last
// ABOUTME: message; once an assistant message trails it, an empty prompt yields
// ABOUTME: a request ending on the assistant, which some models reject outright.

import { buildProviderMessagesFromDurableEvents } from '../message-building/message-builder';

export type DrainContentBlock = { type: 'text'; text: string };

/**
 * Nudge used when the injected notification is no longer the trailing message.
 *
 * The inject's own text is deliberately NOT repeated: it is already folded into
 * the conversation at its own position, so re-sending it would duplicate a
 * potentially large payload. This only has to give the turn a valid trailing
 * user message and point the model at what it has not dealt with.
 */
const UNHANDLED_INJECT_NUDGE =
  '<system-reminder>A notification arrived while you were mid-turn and has not been ' +
  'handled yet. It appears earlier in this conversation, before your last message. ' +
  'Read it and handle it — reply, act on it, or explicitly defer it.</system-reminder>';

/**
 * Content for the follow-up turn that drains a pending immediate inject.
 *
 * The drain exists because an inject that races the turn boundary must still
 * wake the agent — under async-only delegation it is the only way a parent
 * learns a subagent finished. It has always prompted with EMPTY content, which
 * works only while the inject is the last thing in the transcript: it then folds
 * into the trailing user message and the model sees it.
 *
 * When the turn emitted an assistant message after the inject landed, the
 * conversation ends on the assistant instead. Dispatching that is an assistant
 * prefill, which claude-opus-4-8 rejects with a non-retryable 400 — the turn
 * dies and the notification is dropped with no visible failure. In that case the
 * drain must carry a real user message.
 *
 * The tail role is computed with the same reducer used to build the dispatched
 * request, so this cannot drift from what is actually sent. Any failure to read
 * the transcript yields `[]` — the pre-existing behaviour — because a drain that
 * throws is worse than a drain that under-nudges.
 */
export function injectDrainContent(sessionDir: string): DrainContentBlock[] {
  let endsWithAssistant = false;
  try {
    const { messages } = buildProviderMessagesFromDurableEvents(sessionDir);
    endsWithAssistant = messages[messages.length - 1]?.role === 'assistant';
  } catch {
    return [];
  }
  return endsWithAssistant ? [{ type: 'text', text: UNHANDLED_INJECT_NUDGE }] : [];
}
