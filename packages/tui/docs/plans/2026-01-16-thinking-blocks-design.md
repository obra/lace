# Extended Thinking Reporting Design

## Overview

Display extended thinking/reasoning content from LLMs in the TUI. Shows what the model is thinking, with progressive disclosure: indicator while streaming, full content always visible when complete.

## Goals

- **Visibility**: Users see that the model is thinking
- **Transparency**: Users see what the model is thinking  
- **Debugging**: Developers can inspect reasoning to debug agent behavior
- Full support with always-expanded display

## Protocol Events

Three new event types for thinking:

```typescript
// Signals thinking has started
{ "type": "thinking_start", "turnId": "...", "turnSeq": N }

// Streaming thinking content (throttled ~100ms batches)
{ "type": "thinking_delta", "text": "...", "turnId": "...", "turnSeq": N }

// Thinking complete with final token count
{ "type": "thinking_end", "tokens": 2345, "turnId": "...", "turnSeq": N }
```

### Event Ordering

Thinking can be interleaved with text and tools within a turn. Each block is distinct:

```
turn_start
  → thinking_start → thinking_delta(s) → thinking_end
  → text_delta(s)
  → tool_use
  → thinking_start → thinking_delta(s) → thinking_end  // more thinking after tool
  → text_delta(s)
  → tool_use
turn_end
```

Each thinking block identified by `(turn_id, turn_seq)` stays distinct - no merging.

## TUI State

```rust
pub struct ThinkingBlock {
    pub turn_id: Option<String>,
    pub turn_seq: Option<i64>,
    pub text: String,
    pub tokens: Option<u64>,  // Set when thinking_end arrives
    pub streaming: bool,      // True until thinking_end
}

// In AppState
pub thinking_blocks: Vec<ThinkingBlock>,
```

Reducer:
- `thinking_start` → Push new ThinkingBlock with `streaming: true`
- `thinking_delta` → Append text to current streaming block
- `thinking_end` → Set `tokens`, mark `streaming: false`

## Rendering

Thinking blocks render inline in chat, positioned by `turn_seq` relative to other content. Always expanded (never collapsed).

**Display format:**
```
Thinking (2.3K tokens):
I need to understand the codebase structure first.
Let me check what files exist in src/...
The main entry point appears to be main.rs.

Here's what I found in the codebase...

✓ file_read src/main.rs
```

**Styling:**
- Header: `Thinking (N tokens):` or `Thinking...` while streaming, in `fg_muted`
- Content: `fg_muted` + italic modifier (dimmed italic)
- No collapse affordance

**Ordering:**
All content within a turn (thinking, text, tools) sorted by `turn_seq` to preserve interleaved order.

## Provider Implementations

### Base Provider

Add new event types to EventEmitter:
- `thinking_start` - `{}`
- `thinking_delta` - `{ text: string }`
- `thinking_end` - `{ tokens: number }`

### Anthropic Provider

Listen for thinking blocks in stream events:

```typescript
stream.on('streamEvent', (event) => {
  if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
    this.emit('thinking_start', {});
  }
  if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
    this.emit('thinking_delta', { text: event.delta.thinking });
  }
  if (event.type === 'content_block_stop' && /* was thinking block */) {
    this.emit('thinking_end', { tokens: /* from usage or estimate */ });
  }
});
```

### OpenAI Provider

Handle reasoning tokens for o1/o3 models:

```typescript
// OpenAI reasoning is not streamed, returned in response
if (response.reasoning_content) {
  this.emit('thinking_start', {});
  this.emit('thinking_delta', { text: response.reasoning_content });
  this.emit('thinking_end', { tokens: response.reasoning_tokens || 0 });
}
```

### Gemini Provider

Handle thinking mode in response parts:

```typescript
// Check for thinking content in response
for (const part of response.candidates[0].content.parts) {
  if (part.thought) {
    this.emit('thinking_start', {});
    this.emit('thinking_delta', { text: part.thought });
    this.emit('thinking_end', { tokens: /* estimate */ });
  }
}
```

### Ollama/LMStudio

No standard thinking format. Skip for now, can be added for specific models later.

## Runner Changes

Forward thinking events from provider to client:

```typescript
provider.on('thinking_start', () => {
  await onUpdate(streamTurnSeq++, { type: 'thinking_start', turnId, turnSeq: durableTurnSeq++ });
});

provider.on('thinking_delta', ({ text }) => {
  // Throttle to ~100ms batches to reduce render churn
  await onUpdate(streamTurnSeq, { type: 'thinking_delta', text, turnId, turnSeq: currentThinkingSeq });
});

provider.on('thinking_end', ({ tokens }) => {
  await onUpdate(streamTurnSeq++, { type: 'thinking_end', tokens, turnId, turnSeq: durableTurnSeq++ });
});
```

## Implementation Order

1. Base provider event types
2. Anthropic provider (primary, has streaming thinking)
3. TUI state and reducer
4. TUI rendering
5. OpenAI provider (o1/o3 reasoning)
6. Gemini provider
7. Runner throttling refinement
