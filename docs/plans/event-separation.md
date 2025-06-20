# Thread Processing Architecture Refactor Plan

## Current Problems

1. **Mixed Responsibilities**: ThreadManager handles both storage and agent-specific formatting
2. **Scattered UI Logic**: User-facing thread processing is embedded in terminal components  
3. **Dual Purpose Confusion**: ThreadEvents trying to serve both agent and UI needs
4. **Tight Coupling**: UI components directly depend on ThreadManager's formatting decisions
5. **Performance Issues**: O(n) reprocessing on every streaming token with thousands of events

## Proposed Architecture

### Layer Separation

```
Raw ThreadEvents (storage)
    ↓
Agent Thread Processing          User Timeline Processing
    ↓                                  ↓
ProviderMessage[]               Timeline Items
    ↓                                  ↓
AI Model                        UI Components
```

### Component Responsibilities

#### 1. ThreadManager (Pure Data Layer)
**Responsibility**: Event storage and retrieval only
- `getEvents(threadId)` - returns raw ThreadEvents
- `addEvent(threadId, type, data)` - stores events
- **Remove**: `buildConversation()` method

#### 2. Agent (Agent Thread Processing)
**Responsibility**: Convert ThreadEvents to AI model format
- Calls `threadManager.getEvents()` directly
- Contains `buildConversationFromEvents()` (moved from thread-manager)
- Produces `ProviderMessage[]` for AI providers
- Preserves thinking blocks in assistant messages for model context

#### 3. ThreadProcessor (User Timeline Processing)
**Responsibility**: Convert ThreadEvents to UI-optimized timeline format
- **New component** that processes raw ThreadEvents for UI display
- **Performance optimized** with separate processing methods:
  - `processEvents(events)` - processes persisted thread events (cached)
  - `processEphemeralEvents(messages)` - processes streaming messages (frequent)  
  - `buildTimeline(processed, ephemeral)` - merges for final display
- Extracts thinking blocks for chronological display
- Groups tool calls with results
- Single source of truth for all timeline processing logic

#### 4. UI Components (Presentation Layer)
**Responsibility**: Render processed timeline data
- Consume timeline items from ThreadProcessor
- No direct ThreadEvent processing
- Pure rendering logic

## Implementation Plan

### Phase 1: Create ThreadProcessor
1. **Create**: `src/threads/thread-processor.ts`
2. **Define**: `Timeline` and `TimelineItem` types
3. **Implement**: Performance-optimized processing with split methods:
   - `processEvents(events)` - processes persisted ThreadEvents (cached)
   - `processEphemeralEvents(messages)` - processes streaming messages (frequent)
   - `buildTimeline(processed, ephemeral)` - merges for final display
4. **Features**:
   - Extract thinking blocks from raw AGENT_MESSAGE content
   - Group tool calls with results
   - Single source of truth for all timeline processing
   - Avoid O(n) reprocessing during streaming

### Phase 2: Move Agent Formatting ✅ COMPLETED
1. **Move**: `buildConversationFromEvents()` from thread-manager to agent ✅
2. **Update**: Agent to call `threadManager.getEvents()` directly ✅
3. **Remove**: `buildConversation()` method from ThreadManager ✅
4. **Ensure**: Thinking blocks preserved in agent-facing conversation ✅
5. **SAX Parser**: Updated ThreadProcessor to use SAX parser for thinking blocks ✅
6. **Test Coverage**: Added comprehensive Agent tests for edge cases ✅
7. **Cleanup**: Removed redundant conversation-builder tests and files ✅

### Phase 3: Update ThreadManager ✅ COMPLETED
1. **Simplify**: Remove `buildConversation()` method ✅
2. **Focus**: Pure storage and retrieval only ✅
3. **Clean**: Remove conversation-builder import ✅

### Phase 4: Refactor UI Components ✅ COMPLETED
1. **Update**: Terminal interface to use ThreadProcessor with caching ✅
2. **Cache**: `processEvents()` results, only update when thread changes ✅
3. **Optimize**: Call `processEphemeralEvents()` on streaming updates only ✅
4. **Remove**: Raw ThreadEvent processing logic from UI components ✅
5. **Test**: Ensure performance improvement and timeline accuracy ✅
6. **Implementation Notes**: ✅
   - ConversationDisplay now uses ThreadProcessor with React.useMemo for caching
   - Events hash-based cache prevents O(n) reprocessing during streaming
   - TimelineDisplay component renders processed timeline items
   - All tests pass with performance optimizations in place

### Phase 5: Update All Interfaces
1. **Terminal**: Implement ThreadProcessor with performance optimizations
2. **Future interfaces**: Can reuse ThreadProcessor for consistent timeline processing
3. **API endpoints**: Use ThreadProcessor for clean JSON timeline responses

## Data Flow Example

### Before (Current)
```
Agent → ThreadManager.buildConversation() → ProviderMessage[]
UI → ThreadManager.getEvents() → Raw processing in terminal components
```

### After (Proposed)
```
Agent → ThreadManager.getEvents() → Agent.buildThreadMessages() → ProviderMessage[]
UI → ThreadManager.getEvents() → ThreadProcessor → Timeline → UI Components
```

## Benefits

1. **Clear Separation**: Each component has single responsibility
2. **Reusable Logic**: ThreadProcessor works for any UI (terminal, web, mobile, API)
3. **Simplified ThreadManager**: Just storage, no formatting concerns
4. **Agent Autonomy**: Agent controls its own thread message formatting
5. **UI Performance**: Optimized for streaming with cached processing
6. **Single Source of Truth**: All timeline processing logic centralized
7. **No Data Loss**: Raw ThreadEvents preserved, multiple views derived

## Types to Define

```typescript
// User-facing timeline
interface Timeline {
  items: TimelineItem[];
  metadata: {
    eventCount: number;
    messageCount: number;
    lastActivity: Date;
  };
}

type TimelineItem = 
  | { type: 'user_message'; content: string; timestamp: Date; id: string }
  | { type: 'agent_message'; content: string; timestamp: Date; id: string }
  | { type: 'thinking'; content: string; timestamp: Date; id: string }
  | { type: 'tool_execution'; call: ToolCallData; result?: ToolResultData; timestamp: Date; callId: string }
  | { type: 'system_message'; content: string; timestamp: Date; id: string }
  | { type: 'ephemeral_message'; messageType: string; content: string; timestamp: Date };

// Cached processed events (from persisted ThreadEvents)
type ProcessedThreadItems = Omit<TimelineItem, 'ephemeral_message'>[];

// Fast processing for streaming messages
type EphemeralTimelineItems = Extract<TimelineItem, { type: 'ephemeral_message' }>[];
```

## Migration Strategy

1. **Incremental**: Implement new components alongside existing
2. **Feature Flag**: Toggle between old and new processing
3. **Test Parity**: Ensure new processor produces same UI results
4. **Gradual Switch**: Move components one by one
5. **Clean Up**: Remove old code after migration complete

This refactor creates a clean, testable, and **performance-optimized** architecture where each layer has clear responsibilities and the user-facing timeline logic can be shared across multiple UI implementations without O(n) processing during streaming.

## Post-Refactor: Completing Thinking Block Implementation

After the architecture refactor, we need to finish the thinking block functionality:

### Phase 6: Fix Thinking Block Storage and Streaming
1. **Store Raw Content**: Store raw `response.content` (with thinking blocks) in AGENT_MESSAGE ThreadEvents for model context
2. **SAX Parser for Streaming**: Use existing SAX parser to handle incomplete thinking blocks during streaming:
   - Parse `<think>` tags incrementally as tokens arrive
   - Create THINKING ThreadEvents when complete `</think>` tags are parsed
   - Handle incomplete thinking blocks gracefully (no closing tag yet)
   - Continue parsing across token boundaries
3. **Dual Thinking Sources**: 
   - **Streaming**: THINKING events created during streaming for real-time display
   - **Final**: Thinking blocks extracted from stored AGENT_MESSAGE content
4. **Preserve Model Context**: Agent's `buildThreadMessages()` includes full responses with thinking blocks

### Phase 7: Update ThreadProcessor for Streaming Thinking
1. **SAX Parser Integration**: Replace regex-based thinking extraction with SAX parser for consistency:
   - Handle incomplete thinking blocks (streaming edge case)
   - Parse thinking blocks from stored AGENT_MESSAGE content
   - Ensure identical parsing logic between streaming and storage processing
2. **Dual Processing Paths**:
   - **processEvents()**: Extract thinking from stored AGENT_MESSAGE content using SAX parser
   - **processEphemeralEvents()**: Handle streaming THINKING ThreadEvents directly
3. **Chronological Merging**: In `buildTimeline()`:
   - Merge extracted thinking blocks with streaming THINKING events
   - Handle deduplication (same thinking content from both sources)
   - Maintain proper chronological ordering during streaming
4. **Streaming Edge Cases**:
   - Incomplete thinking blocks at stream end
   - Malformed or nested thinking tags
   - Parser errors don't break timeline processing

### Phase 8: Complete Testing Suite
1. **THINKING ThreadEvent Tests**:
   - Creation and storage during streaming
   - Thread message builder ignores THINKING events
   - ThreadProcessor extracts thinking from raw content using SAX parser
   - Performance: cached vs fresh processing
2. **SAX Parser Tests**:
   - **Streaming Edge Cases**:
     - Incomplete thinking blocks (no closing tag)
     - Thinking blocks split across multiple tokens
     - Malformed thinking tags during streaming
     - Parser errors don't break conversation flow
   - **Complete Parsing**:
     - Complete thinking block detection
     - Multiple thinking blocks in single response
     - Nested or overlapping tags (error handling)
3. **Dual Source Processing Tests**:
   - **Deduplication**: Same thinking content from streaming and final storage
   - **Chronological Ordering**: Streaming THINKING events vs extracted thinking blocks
   - **Timeline Consistency**: Streaming vs non-streaming thinking block display
4. **Integration Tests**:
   - **End-to-End Streaming**: Complete thinking blocks appear in both streaming and final timeline
   - **Mixed Sequences**: Thinking blocks interspersed with tool calls during streaming
   - **Error Recovery**: Malformed thinking doesn't break subsequent processing
5. **Component Tests**:
   - ThinkingDisplay renders correctly from both sources
   - AgentMessageDisplay strips thinking blocks using SAX parser
   - ThreadProcessor deduplication logic for dual sources
   - Performance optimization tests (caching, streaming, SAX parsing)

### Phase 9: Handle Edge Cases
1. **Streaming Consistency**:
   - Ensure streaming THINKING events match final raw content
   - Handle incomplete thinking blocks at stream end
   - Deal with malformed thinking tags
2. **Non-Streaming Support**:
   - Extract thinking blocks from non-streaming responses
   - Ensure chronological ordering without streaming events
3. **Error Handling**:
   - SAX parser errors don't break streaming
   - Malformed thinking blocks are handled gracefully

### Phase 10: Cleanup and Polish
1. **Remove Dead Code**:
   - Old thinking block handling in terminal interface
   - Unused ephemeral message thinking logic
2. **Update Event Interfaces**:
   - Clean up agent event types
   - Update TypeScript interfaces
3. **Documentation**:
   - Update CLAUDE.md with new thinking block architecture
   - Document ThreadProcessor API and performance characteristics
   - Add examples of timeline processing flow

### Success Criteria

After completion, the thinking block system should:
- ✅ Preserve raw agent responses with thinking blocks for model context
- ✅ Display thinking blocks chronologically with other events in UI
- ✅ Work consistently for both streaming and non-streaming responses
- ✅ Handle edge cases gracefully without breaking conversation flow
- ✅ Be fully tested with comprehensive test coverage
- ✅ Have clean separation between agent and UI concerns

The refactor provides the foundation for a clean thinking block implementation where raw data is preserved but processed differently for agent vs UI consumption.