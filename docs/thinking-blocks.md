# Thinking Block Architecture

## Overview
Thinking blocks (`<think>...</think>`) are processed with dual-path architecture supporting both streaming and non-streaming responses:

1. **Agent Layer**: Stores raw content (including thinking blocks) in AGENT_MESSAGE events for model context
2. **UI Layer**: Extracts thinking blocks using ThreadProcessor for chronological timeline display

## Data Flow
```
Raw Agent Response: '<think>Planning...</think>I will help you.'
    ↓
Agent Storage: Raw content → AGENT_MESSAGE ThreadEvent (model context)
    ↓
Agent Events: Clean content → agent_response_complete({ content: 'I will help you.' })
    ↓  
UI Processing: ThreadProcessor extracts thinking → Timeline with separate thinking items
```

## Key Components

### ThreadProcessor (`src/interfaces/thread-processor.ts`)
- **Purpose**: UI-optimized event processing with performance caching
- **Methods**:
  - `processEvents(events)` - Cached processing of persisted ThreadEvents
  - `processEphemeralEvents(messages)` - Real-time processing of streaming content  
  - `buildTimeline(processed, ephemeral)` - Merge for final UI display
- **Thinking Block Extraction**: Uses SAX parser to extract thinking blocks from both stored and streaming content
- **Deduplication**: Prevents duplicate thinking blocks from streaming vs stored sources

### Agent (`src/agents/agent.ts`)
- **Thread Messages**: `buildThreadMessages()` preserves raw content with thinking blocks for model context
- **Event Emissions**: `agent_response_complete` contains clean content (thinking blocks removed)
- **Streaming**: `agent_token` events contain raw tokens including thinking block content

## Performance Characteristics
- **Cached Processing**: ThreadProcessor caches processed events, only reprocessing when thread changes
- **Streaming Optimization**: Ephemeral messages processed separately to avoid O(n) reprocessing
- **SAX Parser**: Handles incomplete thinking blocks during streaming gracefully

## Timeline Item Types
```typescript
type TimelineItem = 
  | { type: 'thinking'; content: string; timestamp: Date; id: string }
  | { type: 'agent_message'; content: string; timestamp: Date; id: string }
  | { type: 'user_message'; content: string; timestamp: Date; id: string }
  | { type: 'tool_execution'; call: ToolCallData; result?: ToolResultData; ... }
  | { type: 'system_message'; content: string; timestamp: Date; id: string }
  | { type: 'ephemeral_message'; messageType: string; content: string; timestamp: Date };
```

## Streaming vs Non-Streaming

### Streaming Responses
1. **Real-time Processing**: Agent emits `agent_token` events containing raw tokens
2. **Streaming Extraction**: ThreadProcessor extracts thinking blocks from ephemeral assistant messages
3. **Timeline Display**: Thinking blocks appear in real-time as separate timeline items
4. **Deduplication**: When final AGENT_MESSAGE is stored, duplicate thinking blocks are filtered out

### Non-Streaming Responses  
1. **Batch Processing**: Agent stores complete response in AGENT_MESSAGE event
2. **Extraction on Display**: ThreadProcessor extracts thinking blocks when building timeline
3. **Timeline Display**: Thinking blocks appear as separate timeline items

## Error Handling
- **Malformed Tags**: SAX parser falls back to regex extraction
- **Incomplete Blocks**: Streaming handles partial thinking blocks gracefully
- **Parse Errors**: Don't break conversation flow - content preserved even if extraction fails

## Implementation Details

### SAX Parser Usage
```typescript
// Consistent parsing for both streaming and stored content
const { content: cleanContent, thinkingBlocks } = this.extractThinkingBlocks(rawContent);
```

### Deduplication Logic
```typescript
// Prioritizes streaming THINKING events over extracted blocks
const deduplicatedEvents = this._deduplicateThinkingBlocks(processedEvents);
```

### Performance Optimization
```typescript
// Cached processing prevents O(n) reprocessing during streaming
const processedEvents = useMemo(() => {
  const eventsHash = JSON.stringify(events.map(e => ({ id: e.id, type: e.type, timestamp: e.timestamp })));
  if (eventsHashRef.current === eventsHash && processedEventsRef.current) {
    return processedEventsRef.current;
  }
  // ... processing logic
}, [events]);
```

## Testing Coverage
- Thinking block extraction from both streaming and stored content
- SAX parser edge cases (incomplete blocks, malformed tags)
- Deduplication scenarios with dual sources
- Performance characteristics and caching behavior
- Integration tests for complex mixed event sequences