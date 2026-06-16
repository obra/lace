# Thinking-Block Round-Tripping + Adaptive Thinking Implementation Plan

**Goal:** Persist and replay Anthropic adaptive-thinking blocks across turns so
adaptive thinking can be safely enabled (today lace drops thinking blocks, which
would 400 on tool-use continuations), and surface Ada's thinking in Slack as
italics.

**Architecture:** Thread a new `ThinkingBlock[]` through the full loop —
provider response → `message` event → history rebuild → `convertToAnthropicFormat`
— and emit thinking blocks first in the assistant content array. Enable
`thinking:{type:'adaptive', display:'summarized'}` gated exactly like reasoning
effort (so only the opus-4-8 main persona gets it; compaction haiku/sonnet and the
opus-4-7 arbiter are untouched).

**Branch:** `feat/opus-4-8-reasoning-effort` (builds on the effort commit; the
deploy ships effort + thinking + opus-4-8 together).

## The hard invariant

Anthropic requires thinking blocks (with their opaque `signature`) replayed
**verbatim** on the assistant turn carrying `tool_use`, in wire order
`[thinking…, text?, tool_use…]`. Modified thinking blocks 400. So:
- Store thinking blocks exactly (text + signature), no redaction/truncation.
- `sanitizeLoneSurrogates` must not touch thinking-block fields.
- Support `redacted_thinking` (`{type, data}`) blocks too — replay verbatim.

## Type

```ts
export type ThinkingBlock =
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };
```

## Tasks (bottom-up, each TDD + commit)

1. **Types** (`base-provider.ts`): export `ThinkingBlock`; add
   `thinkingBlocks?: ThinkingBlock[]` to `ProviderResponse` (48-125) and
   `ProviderMessage` (908-913).

2. **Anthropic provider** (`anthropic-provider.ts`):
   - Parse thinking + redacted_thinking from `response.content` / `finalMessage.content`
     into `response.thinkingBlocks`, preserving order (non-stream ~376-389, stream ~564-576).
   - Enable `thinking:{type:'adaptive', display:'summarized'}`, gated on the same
     `reasoningEffort !== undefined` condition already computed for effort.
   - Test: payload.thinking set for opus-4-8 (catalog effort), absent for haiku
     (has_reasoning_effort:false); response.thinkingBlocks populated from content.

3. **Format converter** (`format-converters.ts:122-161`): when `msg.thinkingBlocks`
   present, unshift them (in order) before text/tool_use in BOTH the tool-call
   branch and the pure-text branch. Test: thinking block emitted first, signature intact.

4. **Surrogate guard** (`anthropic/well-formed-json.ts`): confirm/ensure
   `sanitizeLoneSurrogates` leaves thinking/redacted_thinking blocks byte-identical.
   Test: a payload with a thinking block whose text has no surrogate is unchanged;
   signature preserved.

5. **Event schema + writer** (`event-types.ts` `MessageEventData`; `runner.ts:701-705`):
   add `thinkingBlocks?` to `MessageEventData`; runner extracts from response and
   writes them on the `message` event; **write the message event when text OR
   thinkingBlocks present** (today skipped when text empty — the tool-only turn).

6. **History rebuild** (`message-builder.ts:329-336` + preserved-tail 300-322 +
   `PreservedMessage` type + `buildPreservedTail`): attach `thinkingBlocks` to the
   rebuilt assistant message; thread through the compacted preserved tail.

7. **End-to-end test**: response(thinkingBlocks) → write message event → rebuild →
   `convertToAnthropicFormat` emits thinking-first with signature intact. Include the
   tool-only (empty-text) turn.

8. **Re-enable in effort change**: the effort commit currently omits thinking; step 2
   re-introduces it. Verify the reasoning-effort test file still green (update the
   `thinking` assertions there to expect adaptive when effort is set).

9. **Slack italics** (sen-core): render streamed/persisted thinking as italics in the
   Slack output. Investigate sen-core's agent→Slack streaming path; thinking text comes
   from the provider `thinking_delta` events / the persisted thinkingBlocks.

## Compaction safety

Only the verbatim tail needs thinking blocks (live tool cycle). Compacted-away turns
become prose (no tool_use → no thinking requirement). `trimTailToolIO` only touches
tool_use events; message-event thinking survives.

## Deploy (after all green)

`core.md` model → `claude-opus-4-8`; build lace; pin-bump sen-core; persona-refresh Ada;
verify a live request shows model=opus-4-8 + effort=medium + thinking adaptive, and a
tool-use turn round-trips without 400.
