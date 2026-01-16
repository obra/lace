# Extended Thinking Blocks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display extended thinking/reasoning content from LLMs inline in the TUI chat, with streaming support and proper interleaving with text and tools.

**Architecture:** Provider layer emits thinking events, runner forwards them to TUI via session updates, TUI renders thinking blocks inline with dimmed italic styling. Each thinking block is distinct (no merging), positioned by turn_seq.

**Tech Stack:** TypeScript (agent), Rust (TUI), JSON-RPC protocol

---

## Task 1: Add Thinking Event Types to Base Provider

**Files:**
- Modify: `packages/agent/src/providers/base-provider.ts`
- Test: `packages/agent/src/providers/base-provider.test.ts`

**Step 1: Write the failing test**

Add to `base-provider.test.ts`:

```typescript
describe('thinking events', () => {
  it('should emit thinking_start event', async () => {
    const provider = new TestProvider({ apiKey: 'test' });
    const events: string[] = [];
    provider.on('thinking_start', () => events.push('thinking_start'));
    provider.emit('thinking_start', {});
    expect(events).toContain('thinking_start');
  });

  it('should emit thinking_delta event with text', async () => {
    const provider = new TestProvider({ apiKey: 'test' });
    let receivedText = '';
    provider.on('thinking_delta', ({ text }) => { receivedText = text; });
    provider.emit('thinking_delta', { text: 'reasoning about the problem' });
    expect(receivedText).toBe('reasoning about the problem');
  });

  it('should emit thinking_end event with token count', async () => {
    const provider = new TestProvider({ apiKey: 'test' });
    let receivedTokens = 0;
    provider.on('thinking_end', ({ tokens }) => { receivedTokens = tokens; });
    provider.emit('thinking_end', { tokens: 1234 });
    expect(receivedTokens).toBe(1234);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npm test -- -t "thinking events"`
Expected: PASS (EventEmitter already supports arbitrary events, but we're documenting the contract)

**Step 3: Add type declarations for thinking events**

In `base-provider.ts`, add after the existing event type comments (around line 58):

```typescript
/**
 * Event types emitted by providers:
 * - 'token': { token: string } - Streaming text token
 * - 'token_usage_update': { inputTokens, outputTokens } - Token usage update
 * - 'complete': { response: ProviderResponse } - Response complete
 * - 'thinking_start': {} - Extended thinking has started
 * - 'thinking_delta': { text: string } - Streaming thinking content
 * - 'thinking_end': { tokens: number } - Extended thinking complete with token count
 */
```

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && npm test -- -t "thinking events"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/providers/base-provider.ts packages/agent/src/providers/base-provider.test.ts
git commit -m "feat(agent): add thinking event types to base provider"
```

---

## Task 2: Implement Thinking Events in Anthropic Provider

**Files:**
- Modify: `packages/agent/src/providers/anthropic-provider.ts`
- Test: `packages/agent/src/providers/anthropic-provider.test.ts`

**Step 1: Write the failing test**

Add to `anthropic-provider.test.ts`:

```typescript
describe('extended thinking', () => {
  it('should emit thinking events for thinking blocks', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const events: Array<{ type: string; data?: unknown }> = [];
    
    provider.on('thinking_start', () => events.push({ type: 'thinking_start' }));
    provider.on('thinking_delta', (data) => events.push({ type: 'thinking_delta', data }));
    provider.on('thinking_end', (data) => events.push({ type: 'thinking_end', data }));

    // Mock the Anthropic client to return a thinking block
    // (implementation depends on how mocking is set up in existing tests)
    
    expect(events.some(e => e.type === 'thinking_start')).toBe(true);
    expect(events.some(e => e.type === 'thinking_delta')).toBe(true);
    expect(events.some(e => e.type === 'thinking_end')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npm test -- -t "extended thinking"`
Expected: FAIL - no thinking events emitted

**Step 3: Implement thinking event emission**

In `anthropic-provider.ts`, find the `stream.on('streamEvent')` handler (around line 290) and add thinking block handling:

```typescript
// Track current block type to know when thinking ends
let currentBlockIndex = -1;
let currentBlockType: string | null = null;

stream.on('streamEvent', (event: MessageStreamEvent) => {
  if (event.type === 'content_block_start') {
    currentBlockIndex = event.index;
    currentBlockType = event.content_block?.type || null;
    if (currentBlockType === 'thinking') {
      this.emit('thinking_start', {});
    }
  }
  
  if (event.type === 'content_block_delta') {
    if (event.delta?.type === 'thinking_delta' && 'thinking' in event.delta) {
      this.emit('thinking_delta', { text: event.delta.thinking });
    }
  }
  
  if (event.type === 'content_block_stop') {
    if (currentBlockType === 'thinking') {
      // Token count will come from final message usage
      this.emit('thinking_end', { tokens: 0 });
    }
    currentBlockType = null;
  }
});
```

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && npm test -- -t "extended thinking"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/providers/anthropic-provider.ts packages/agent/src/providers/anthropic-provider.test.ts
git commit -m "feat(agent): emit thinking events from Anthropic provider"
```

---

## Task 3: Implement Thinking Events in OpenAI Provider

**Files:**
- Modify: `packages/agent/src/providers/openai-provider.ts`
- Test: `packages/agent/src/providers/openai-provider.test.ts`

**Step 1: Write the failing test**

Add to `openai-provider.test.ts`:

```typescript
describe('reasoning tokens (o1/o3)', () => {
  it('should emit thinking events for reasoning content', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    const events: Array<{ type: string; data?: unknown }> = [];
    
    provider.on('thinking_start', () => events.push({ type: 'thinking_start' }));
    provider.on('thinking_delta', (data) => events.push({ type: 'thinking_delta', data }));
    provider.on('thinking_end', (data) => events.push({ type: 'thinking_end', data }));

    // Mock response with reasoning_content field
    // (for o1/o3 models)
    
    expect(events.some(e => e.type === 'thinking_start')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npm test -- -t "reasoning tokens"`
Expected: FAIL

**Step 3: Implement thinking event emission**

In `openai-provider.ts`, after receiving the response, check for reasoning content:

```typescript
// After getting response, check for reasoning content (o1/o3 models)
if (response.reasoning_content) {
  this.emit('thinking_start', {});
  this.emit('thinking_delta', { text: response.reasoning_content });
  this.emit('thinking_end', { 
    tokens: response.usage?.reasoning_tokens || 0 
  });
}
```

Note: OpenAI's reasoning is not streamed as of now, so we emit all at once.

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && npm test -- -t "reasoning tokens"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/providers/openai-provider.ts packages/agent/src/providers/openai-provider.test.ts
git commit -m "feat(agent): emit thinking events from OpenAI provider for o1/o3 models"
```

---

## Task 4: Implement Thinking Events in Gemini Provider

**Files:**
- Modify: `packages/agent/src/providers/gemini-provider.ts`
- Test: `packages/agent/src/providers/gemini-provider.test.ts`

**Step 1: Write the failing test**

Add to `gemini-provider.test.ts`:

```typescript
describe('thinking mode', () => {
  it('should emit thinking events for thought parts', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const events: Array<{ type: string; data?: unknown }> = [];
    
    provider.on('thinking_start', () => events.push({ type: 'thinking_start' }));
    provider.on('thinking_delta', (data) => events.push({ type: 'thinking_delta', data }));
    provider.on('thinking_end', (data) => events.push({ type: 'thinking_end', data }));

    // Mock response with thought content
    
    expect(events.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npm test -- -t "thinking mode"`
Expected: FAIL

**Step 3: Implement thinking event emission**

In `gemini-provider.ts`, check response parts for thought content:

```typescript
// Check for thinking/thought content in response parts
for (const part of response.candidates?.[0]?.content?.parts || []) {
  if (part.thought) {
    this.emit('thinking_start', {});
    this.emit('thinking_delta', { text: part.thought });
    this.emit('thinking_end', { tokens: 0 }); // Gemini doesn't provide thinking token count
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && npm test -- -t "thinking mode"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/providers/gemini-provider.ts packages/agent/src/providers/gemini-provider.test.ts
git commit -m "feat(agent): emit thinking events from Gemini provider"
```

---

## Task 5: Forward Thinking Events in Runner

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts`
- Test: `packages/agent/src/core/conversation/__tests__/runner.test.ts`

**Step 1: Write the failing test**

Add to `runner.test.ts`:

```typescript
describe('thinking events', () => {
  it('should forward thinking events via onUpdate', async () => {
    const updates: Array<{ type: string }> = [];
    const runner = new ConversationRunner(config, {
      ...deps,
      onUpdate: async (seq, update) => {
        updates.push(update);
      },
    });
    
    // Trigger provider to emit thinking events
    // ...
    
    expect(updates.some(u => u.type === 'thinking_start')).toBe(true);
    expect(updates.some(u => u.type === 'thinking_delta')).toBe(true);
    expect(updates.some(u => u.type === 'thinking_end')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npm test -- -t "thinking events"`
Expected: FAIL

**Step 3: Implement thinking event forwarding**

In `runner.ts`, add event handlers after the `onToken` handler (around line 165):

```typescript
let thinkingTurnSeq = streamTurnSeq;

const onThinkingStart = () => {
  if (abortController.signal.aborted) return;
  thinkingTurnSeq = streamTurnSeq++;
  this.deps.onUpdate(thinkingTurnSeq, { 
    type: 'thinking_start',
    turnId,
    turnSeq: durableTurnSeq++,
  });
};

const onThinkingDelta = ({ text }: { text: string }) => {
  if (abortController.signal.aborted) return;
  this.deps.onUpdate(thinkingTurnSeq, {
    type: 'thinking_delta',
    text,
    turnId,
    turnSeq: thinkingTurnSeq, // Same seq for all deltas in this block
  });
};

const onThinkingEnd = ({ tokens }: { tokens: number }) => {
  if (abortController.signal.aborted) return;
  this.deps.onUpdate(thinkingTurnSeq, {
    type: 'thinking_end',
    tokens,
    turnId,
    turnSeq: durableTurnSeq++,
  });
};

provider.on('thinking_start', onThinkingStart);
provider.on('thinking_delta', onThinkingDelta);
provider.on('thinking_end', onThinkingEnd);
```

And clean up after the response:

```typescript
provider.off('thinking_start', onThinkingStart);
provider.off('thinking_delta', onThinkingDelta);
provider.off('thinking_end', onThinkingEnd);
```

**Step 4: Run test to verify it passes**

Run: `cd packages/agent && npm test -- -t "thinking events"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts packages/agent/src/core/conversation/__tests__/runner.test.ts
git commit -m "feat(agent): forward thinking events from runner to client"
```

---

## Task 6: Add ThinkingBlock State to TUI

**Files:**
- Modify: `packages/tui/src/app/mod.rs`

**Step 1: Add ThinkingBlock struct**

In `mod.rs`, add after the `ActivityItem` struct:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThinkingBlock {
    pub turn_id: Option<String>,
    pub turn_seq: Option<i64>,
    pub text: String,
    pub tokens: Option<u64>,
    pub streaming: bool,
}
```

**Step 2: Add thinking_blocks to AppState**

In the `AppState` struct, add:

```rust
pub thinking_blocks: Vec<ThinkingBlock>,
```

**Step 3: Initialize in AppState::new()**

In `AppState::new()`:

```rust
thinking_blocks: Vec::new(),
```

**Step 4: Build and verify**

Run: `cargo build`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/tui/src/app/mod.rs
git commit -m "feat(tui): add ThinkingBlock state struct"
```

---

## Task 7: Add Thinking Events to AppEvent and Reducer

**Files:**
- Modify: `packages/tui/src/app/reducer.rs`
- Test: Add tests in same file

**Step 1: Add thinking event variants to AppEvent**

In `reducer.rs`, add to the `AppEvent` enum:

```rust
ThinkingStart {
    turn_id: Option<String>,
    turn_seq: Option<i64>,
},
ThinkingDelta {
    text: String,
    turn_id: Option<String>,
    turn_seq: Option<i64>,
},
ThinkingEnd {
    tokens: u64,
    turn_id: Option<String>,
    turn_seq: Option<i64>,
},
```

**Step 2: Add match arms in reduce function**

```rust
AppEvent::ThinkingStart { turn_id, turn_seq } => {
    state.thinking_blocks.push(ThinkingBlock {
        turn_id,
        turn_seq,
        text: String::new(),
        tokens: None,
        streaming: true,
    });
    Vec::new()
}
AppEvent::ThinkingDelta { text, turn_id, turn_seq } => {
    // Find the current streaming block matching turn_id
    if let Some(block) = state.thinking_blocks.iter_mut().rev().find(|b| {
        b.streaming && b.turn_id == turn_id
    }) {
        block.text.push_str(&text);
    }
    Vec::new()
}
AppEvent::ThinkingEnd { tokens, turn_id, turn_seq } => {
    if let Some(block) = state.thinking_blocks.iter_mut().rev().find(|b| {
        b.streaming && b.turn_id == turn_id
    }) {
        block.tokens = Some(tokens);
        block.streaming = false;
    }
    Vec::new()
}
```

**Step 3: Write tests**

```rust
#[test]
fn thinking_events_create_and_update_block() {
    let mut state = AppState::new();
    
    reduce(&mut state, AppEvent::ThinkingStart {
        turn_id: Some("turn_1".to_string()),
        turn_seq: Some(1),
    });
    assert_eq!(state.thinking_blocks.len(), 1);
    assert!(state.thinking_blocks[0].streaming);
    
    reduce(&mut state, AppEvent::ThinkingDelta {
        text: "Let me think...".to_string(),
        turn_id: Some("turn_1".to_string()),
        turn_seq: Some(1),
    });
    assert_eq!(state.thinking_blocks[0].text, "Let me think...");
    
    reduce(&mut state, AppEvent::ThinkingEnd {
        tokens: 42,
        turn_id: Some("turn_1".to_string()),
        turn_seq: Some(2),
    });
    assert!(!state.thinking_blocks[0].streaming);
    assert_eq!(state.thinking_blocks[0].tokens, Some(42));
}
```

**Step 4: Run tests**

Run: `cargo test thinking_events`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/tui/src/app/reducer.rs
git commit -m "feat(tui): handle thinking events in reducer"
```

---

## Task 8: Parse Thinking Events from Protocol

**Files:**
- Modify: `packages/tui/src/protocol/ent.rs`
- Test: Add tests in same file

**Step 1: Add thinking event parsing**

In `decode_session_update_inner`, add match arms:

```rust
"thinking_start" => {
    out.push(AppEvent::ThinkingStart { turn_id, turn_seq });
}
"thinking_delta" => {
    if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
        out.push(AppEvent::ThinkingDelta {
            text: text.to_string(),
            turn_id,
            turn_seq,
        });
    }
}
"thinking_end" => {
    let tokens = obj.get("tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    out.push(AppEvent::ThinkingEnd {
        tokens,
        turn_id,
        turn_seq,
    });
}
```

**Step 2: Write tests**

```rust
#[test]
fn parses_thinking_events() {
    let update = json!({
        "type": "thinking_start",
        "turnId": "turn_1",
        "turnSeq": 1
    });
    let events = decode_session_update(&update);
    assert!(matches!(events[0], AppEvent::ThinkingStart { .. }));
    
    let update = json!({
        "type": "thinking_delta",
        "text": "reasoning...",
        "turnId": "turn_1",
        "turnSeq": 1
    });
    let events = decode_session_update(&update);
    assert!(matches!(events[0], AppEvent::ThinkingDelta { .. }));
    
    let update = json!({
        "type": "thinking_end",
        "tokens": 100,
        "turnId": "turn_1",
        "turnSeq": 2
    });
    let events = decode_session_update(&update);
    assert!(matches!(events[0], AppEvent::ThinkingEnd { .. }));
}
```

**Step 3: Run tests**

Run: `cargo test parses_thinking`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/tui/src/protocol/ent.rs
git commit -m "feat(tui): parse thinking events from protocol"
```

---

## Task 9: Render Thinking Blocks in Chat

**Files:**
- Modify: `packages/tui/src/ui/mod.rs`

**Step 1: Create render_thinking_block function**

Add near `render_tool_call_line`:

```rust
fn render_thinking_block<'a>(
    block: &ThinkingBlock,
    colors: &ThemeColors,
) -> Vec<Line<'a>> {
    let mut lines = Vec::new();
    
    // Header line
    let header = if block.streaming {
        "Thinking...".to_string()
    } else if let Some(tokens) = block.tokens {
        format!("Thinking ({} tokens):", format_token_count(tokens))
    } else {
        "Thinking:".to_string()
    };
    
    lines.push(Line::from(Span::styled(
        header,
        Style::default().fg(colors.fg_muted),
    )));
    
    // Content lines - dimmed and italic
    let style = Style::default()
        .fg(colors.fg_muted)
        .add_modifier(Modifier::ITALIC);
    
    for line in block.text.lines() {
        lines.push(Line::from(Span::styled(line.to_string(), style)));
    }
    
    // Add streaming cursor if still thinking
    if block.streaming && !block.text.is_empty() {
        if let Some(last) = lines.last_mut() {
            last.spans.push(Span::styled(" ▌", Style::default().fg(colors.accent)));
        }
    }
    
    lines
}

fn format_token_count(tokens: u64) -> String {
    if tokens >= 1000 {
        format!("{:.1}K", tokens as f64 / 1000.0)
    } else {
        tokens.to_string()
    }
}
```

**Step 2: Integrate into render_chat_area**

In `render_chat_area`, build a map of thinking blocks by turn_id similar to tools:

```rust
// Build thinking blocks by turn_id
let mut thinking_by_turn_id: HashMap<String, Vec<(usize, &ThinkingBlock)>> = HashMap::new();
for (idx, block) in state.thinking_blocks.iter().enumerate() {
    if let Some(turn_id) = &block.turn_id {
        thinking_by_turn_id
            .entry(turn_id.clone())
            .or_default()
            .push((idx, block));
    }
}
```

Then in the message loop, render thinking blocks sorted by turn_seq alongside text and tools:

```rust
// For each message, collect all content (thinking, text, tools) and sort by turn_seq
// Render thinking blocks with their turn_seq ordering
if let Some(turn_id) = &m.turn_id {
    if let Some(blocks) = thinking_by_turn_id.get(turn_id) {
        for (_, block) in blocks {
            // Check if this block's turn_seq comes before the current content
            lines.extend(render_thinking_block(block, colors));
        }
    }
}
```

**Step 3: Build and verify**

Run: `cargo build`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "feat(tui): render thinking blocks in chat with dimmed italic styling"
```

---

## Task 10: Add Throttling for Thinking Deltas

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts`

**Step 1: Implement throttled thinking delta emission**

In `runner.ts`, add throttling for thinking deltas:

```typescript
// Throttle thinking deltas to ~100ms batches
let thinkingBuffer = '';
let thinkingFlushTimeout: NodeJS.Timeout | null = null;

const flushThinkingBuffer = () => {
  if (thinkingBuffer && !abortController.signal.aborted) {
    this.deps.onUpdate(thinkingTurnSeq, {
      type: 'thinking_delta',
      text: thinkingBuffer,
      turnId,
      turnSeq: thinkingTurnSeq,
    });
    thinkingBuffer = '';
  }
  thinkingFlushTimeout = null;
};

const onThinkingDelta = ({ text }: { text: string }) => {
  if (abortController.signal.aborted) return;
  thinkingBuffer += text;
  
  if (!thinkingFlushTimeout) {
    thinkingFlushTimeout = setTimeout(flushThinkingBuffer, 100);
  }
};

const onThinkingEnd = ({ tokens }: { tokens: number }) => {
  // Flush any remaining buffer before end
  if (thinkingFlushTimeout) {
    clearTimeout(thinkingFlushTimeout);
    thinkingFlushTimeout = null;
  }
  flushThinkingBuffer();
  
  if (abortController.signal.aborted) return;
  this.deps.onUpdate(thinkingTurnSeq, {
    type: 'thinking_end',
    tokens,
    turnId,
    turnSeq: durableTurnSeq++,
  });
};
```

**Step 2: Build and verify**

Run: `cd packages/agent && npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts
git commit -m "feat(agent): throttle thinking delta events to 100ms batches"
```

---

## Task 11: Integration Test

**Files:**
- Create: `packages/tui/tests/e2e_thinking_blocks.rs`

**Step 1: Write integration test**

```rust
//! E2E test for thinking block display

use common::TestHarness;

mod common;

#[test]
fn thinking_blocks_display_inline() {
    let mut harness = TestHarness::new();
    
    // Simulate thinking events
    harness.send_session_update(json!({
        "type": "turn_start",
        "turnId": "turn_1",
        "turnSeq": 0
    }));
    
    harness.send_session_update(json!({
        "type": "thinking_start",
        "turnId": "turn_1",
        "turnSeq": 1
    }));
    
    harness.send_session_update(json!({
        "type": "thinking_delta",
        "text": "Let me analyze this problem...",
        "turnId": "turn_1",
        "turnSeq": 1
    }));
    
    harness.send_session_update(json!({
        "type": "thinking_end",
        "tokens": 50,
        "turnId": "turn_1",
        "turnSeq": 2
    }));
    
    harness.send_session_update(json!({
        "type": "text_delta",
        "text": "Here's what I found...",
        "turnId": "turn_1",
        "turnSeq": 3
    }));
    
    // Verify thinking block appears before text
    let output = harness.render();
    let thinking_pos = output.find("Thinking (50 tokens):");
    let text_pos = output.find("Here's what I found");
    
    assert!(thinking_pos.is_some());
    assert!(text_pos.is_some());
    assert!(thinking_pos.unwrap() < text_pos.unwrap());
}
```

**Step 2: Run integration test**

Run: `cargo test e2e_thinking`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/tui/tests/e2e_thinking_blocks.rs
git commit -m "test(tui): add e2e test for thinking block display"
```

---

## Task 12: Final Cleanup and Documentation

**Files:**
- Modify: `docs/plans/2026-01-16-thinking-blocks-design.md` (mark complete)

**Step 1: Update design doc**

Add to top of design doc:

```markdown
**Status:** ✅ Implemented
```

**Step 2: Run full test suite**

Run: `cd packages/agent && npm test && cd ../tui && cargo test`
Expected: All tests PASS

**Step 3: Final commit**

```bash
git add docs/plans/2026-01-16-thinking-blocks-design.md
git commit -m "docs: mark thinking blocks design as implemented"
```

---

## Summary

This plan implements extended thinking block support across:
- **Agent providers**: Anthropic (streaming), OpenAI (o1/o3), Gemini
- **Runner**: Forwards thinking events with throttling
- **TUI protocol**: Parses thinking events
- **TUI state**: Tracks thinking blocks
- **TUI rendering**: Displays with dimmed italic styling, sorted by turn_seq

Each thinking block is distinct and properly interleaved with text and tools based on turn_seq.
