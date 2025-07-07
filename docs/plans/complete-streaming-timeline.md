# Complete Streaming Timeline Implementation: Fix Catastrophic Performance

## Overview

This plan addresses the **catastrophic performance issue** where timeline rendering causes 100% CPU load during long sessions. The root cause is that ThreadProcessor still reprocesses entire conversation history (85+ events) on every new event, causing O(n) performance that scales horribly with conversation length.

**Problem**: Two timeline processors running in parallel - old O(n) ThreadProcessor still active alongside new O(1) StreamingTimelineProcessor, causing worst-of-both-worlds performance.

**Solution**: Complete replacement of ThreadProcessor with StreamingTimelineProcessor, ensuring pure O(1) incremental processing for real-time events.

## Background Context

### What is the Performance Issue?

During long conversations (85+ events), every new event triggers:
1. **Full event array fetch**: Interface gets ALL historical events
2. **Complete reprocessing**: ThreadProcessor processes entire conversation from scratch
3. **Full timeline rebuild**: UI regenerates every timeline item from beginning
4. **100% CPU load**: Process pegs CPU for minutes per new event

### Current Dual Processor Problem

**ThreadProcessor** (Old - O(n) per event):
- Processes entire event history on every call
- Used by ConversationDisplay via `useMemo(() => threadProcessor.processThreads(events), [events])`
- Creates "rerender storms" that rebuild entire timeline

**StreamingTimelineProcessor** (New - O(1) per event):
- Processes only new events incrementally
- Partially implemented but not replacing ThreadProcessor
- Should be the ONLY timeline processor

### Why This is Catastrophic

**Performance Scaling**:
- 10 events: Slow but manageable
- 50 events: Noticeable lag on every keystroke
- 85+ events: 100% CPU load, unusable interface
- 200+ events: System becomes completely unresponsive

**User Impact**:
- Cannot use Lace for long coding sessions
- Interface freezes on every interaction
- Productivity completely destroyed

## Target Architecture

### Single Timeline Processor: StreamingTimelineProcessor Only

**Real-time Event Flow**:
```
User Input → Agent → ThreadManager.addEvent() (silent)
         → Agent.emit('thread_event_added') 
         → StreamingTimelineProcessor.appendEvent() (O(1))
         → UI incremental update
```

**Session Resumption Flow**:
```
--continue → Agent.replaySessionEvents()
          → StreamingTimelineProcessor.loadEvents() (O(n), one time)
          → UI complete rebuild (unavoidable for resumption)
```

### Timeline Type Abstraction

Clean separation between timeline structure and processing implementation:

```typescript
// Shared timeline types
interface Timeline {
  items: TimelineItem[];
  metadata: TimelineMetadata;
}

interface TimelineProcessor {
  // Incremental processing (O(1))
  appendEvent(event: ThreadEvent): void;
  
  // Bulk loading for session resumption (O(n))
  loadEvents(events: ThreadEvent[]): void;
  
  // State access
  getTimeline(): Timeline;
  reset(): void;
}
```

### Performance Goals

**Real-time Processing**: O(1) per event
- New events processed in constant time
- No reprocessing of historical events
- CPU usage remains low regardless of conversation length

**Session Resumption**: O(n) one time only
- Bulk loading only during --continue operations
- After resumption, returns to O(1) incremental processing

## Current State Problems

### Dual Processor Architecture

**File**: `src/interfaces/terminal/components/events/ConversationDisplay.tsx:31`
```typescript
// PROBLEM: Still using ThreadProcessor
const threadProcessor = useThreadProcessor();
const mainThreadProcessed = useMemo(() => {
  return threadProcessor.processThreads(events); // O(n) reprocessing!
}, [events, threadProcessor]);
```

**File**: `src/interfaces/terminal/terminal-interface.tsx:169`
```typescript
// StreamingTimelineProcessor exists but doesn't replace ThreadProcessor
const streamingTimelineProcessor = useMemo(() => new StreamingTimelineProcessor(), []);
```

### Event Array Dependencies

**File**: `src/interfaces/terminal/components/events/ConversationDisplay.tsx:35`
```typescript
// PROBLEM: Depends on entire events array
}, [events, threadProcessor]);
```

React sees the events array change (even by one event) and triggers complete reprocessing.

### ThreadProcessor Still Exists

**File**: `src/interfaces/thread-processor.ts`
- Old O(n) processor still exists and being used
- Should be completely removed, not just replaced

## Implementation Plan

### Phase 1: Complete StreamingTimelineProcessor

#### Task 1.1: Extract Timeline Types to Shared Location
**File**: `src/interfaces/timeline-types.ts` (NEW)
**Test**: Type definitions and imports work correctly

**TDD Steps**:
1. Write test importing timeline types from new location
2. Create shared timeline types file
3. Export Timeline, TimelineItem, TimelineProcessor interfaces
4. Update imports in existing files
5. Commit: "feat: extract timeline types to shared location"

**Implementation**:
```typescript
// src/interfaces/timeline-types.ts - NEW FILE
export interface Timeline {
  items: TimelineItem[];
  metadata: TimelineMetadata;
}

export interface TimelineItem {
  // All existing timeline item types
  type: 'user_message' | 'agent_message' | 'tool_call' | 'tool_result' | 'ephemeral_message';
  // ... other fields
}

export interface TimelineProcessor {
  appendEvent(event: ThreadEvent): void;
  loadEvents(events: ThreadEvent[]): void;
  getTimeline(): Timeline;
  reset(): void;
}
```

**Files to examine**:
- `src/interfaces/thread-processor.ts` - Current Timeline type definition
- `src/interfaces/streaming-timeline-processor.ts` - Current StreamingTimelineProcessor interface

#### Task 1.2: Ensure StreamingTimelineProcessor Feature Parity
**File**: `src/interfaces/streaming-timeline-processor.ts`
**Test**: Comprehensive test suite matching ThreadProcessor functionality

**TDD Steps**:
1. Write test comparing StreamingTimelineProcessor output with ThreadProcessor
2. Write test for all event types (USER_MESSAGE, AGENT_MESSAGE, TOOL_CALL, TOOL_RESULT)
3. Write test for tool call/result correlation
4. Write test for ephemeral message handling
5. Commit: "feat: ensure StreamingTimelineProcessor feature parity"

**Functionality Requirements**:
- ✅ Process all event types correctly
- ✅ Handle tool call/result pairing and correlation
- ✅ Support ephemeral messages (system messages, etc.)
- ✅ Maintain timeline item order and structure
- ✅ Handle orphaned tool results gracefully
- ✅ Preserve thinking block processing

**Files to examine**:
- `src/interfaces/thread-processor.ts` - All functionality to replicate
- `src/interfaces/streaming-timeline-processor.ts` - Current implementation gaps

#### Task 1.3: Add Performance Optimization to StreamingTimelineProcessor
**File**: `src/interfaces/streaming-timeline-processor.ts`
**Test**: Performance tests showing O(1) behavior

**TDD Steps**:
1. Write performance test measuring appendEvent() time with varying timeline sizes
2. Write test verifying memory usage doesn't grow unbounded
3. Implement optimizations for large timelines
4. Add metrics and monitoring for performance tracking
5. Commit: "feat: optimize StreamingTimelineProcessor for large conversations"

**Optimizations**:
- **Efficient tool correlation**: Use Map for O(1) tool call lookups
- **Memory management**: Clean up old correlation state
- **Timeline structure**: Optimize for append operations
- **Event validation**: Fast path for known-good events

### Phase 2: Replace ThreadProcessor Usage

#### Task 2.1: Update ConversationDisplay to Use StreamingTimelineProcessor Only
**File**: `src/interfaces/terminal/components/events/ConversationDisplay.tsx`
**Test**: Integration test for conversation display using streaming processor

**TDD Steps**:
1. Write test for ConversationDisplay using only StreamingTimelineProcessor
2. Write test for incremental updates without full reprocessing
3. Replace ThreadProcessor usage with StreamingTimelineProcessor
4. Remove events array dependency from useMemo
5. Commit: "feat: migrate ConversationDisplay to StreamingTimelineProcessor"

**Implementation**:
```typescript
// BEFORE: ThreadProcessor with full reprocessing
const threadProcessor = useThreadProcessor();
const mainThreadProcessed = useMemo(() => {
  return threadProcessor.processThreads(events); // O(n) BAD!
}, [events, threadProcessor]);

// AFTER: StreamingTimelineProcessor with incremental updates
const streamingProcessor = useStreamingTimelineProcessor();
const timeline = useMemo(() => {
  return streamingProcessor.getTimeline(); // O(1) GOOD!
}, [streamingProcessor]); // No events dependency!
```

**Key Changes**:
- Remove `events` from React dependencies
- Use `streamingProcessor.getTimeline()` instead of processing events
- Events flow through Agent → StreamingTimelineProcessor, not through React props

**Files to examine**:
- `src/interfaces/terminal/components/events/ConversationDisplay.tsx:30-42` - Current ThreadProcessor usage
- `src/interfaces/terminal/terminal-interface.tsx` - StreamingTimelineProcessor context

#### Task 2.2: Update Terminal Interface Event Flow
**File**: `src/interfaces/terminal/terminal-interface.tsx`
**Test**: Test terminal interface with pure streaming event flow

**TDD Steps**:
1. Write test for Agent events flowing to StreamingTimelineProcessor
2. Write test for timeline updates without events array changes
3. Update event handlers to call StreamingTimelineProcessor.appendEvent()
4. Remove events array state (major change!)
5. Commit: "feat: implement pure streaming event flow in terminal interface"

**Implementation**:
```typescript
// BEFORE: Events stored in React state
const [events, setEvents] = useState<ThreadEvent[]>([]);

// AFTER: No events array - pure streaming
// Remove events state entirely!

// BEFORE: Event handler updates events array
const handleEventAdded = (data: { event: ThreadEvent; threadId: string }) => {
  const currentThreadId = agent.getCurrentThreadId();
  if (data.threadId === currentThreadId) {
    streamingTimelineProcessor.appendEvent(data.event); // Direct to processor
    setEvents([...threadEvents]); // REMOVE THIS
  }
};

// AFTER: Event handler updates processor only
const handleEventAdded = (data: { event: ThreadEvent; threadId: string }) => {
  const currentThreadId = agent.getCurrentThreadId();
  if (data.threadId === currentThreadId) {
    streamingTimelineProcessor.appendEvent(data.event); // Only this!
    // No React state updates needed - processor handles timeline state
  }
};
```

**Major Architectural Change**:
- **Remove events array from React state entirely**
- **StreamingTimelineProcessor becomes the timeline state holder**
- **React components read from processor, not from events array**

**Files to examine**:
- `src/interfaces/terminal/terminal-interface.tsx:190-291` - Current events state management
- `src/interfaces/terminal/terminal-interface.tsx:172-184` - Event handlers

#### Task 2.3: Implement Session Resumption with Streaming
**File**: `src/interfaces/terminal/terminal-interface.tsx`
**Test**: Test session resumption using StreamingTimelineProcessor

**TDD Steps**:
1. Write test for --continue using StreamingTimelineProcessor.loadEvents()
2. Write test for conversation resumption performance
3. Update session initialization to use streaming bulk load
4. Remove old syncEvents() pattern
5. Commit: "feat: implement session resumption with StreamingTimelineProcessor"

**Implementation**:
```typescript
// BEFORE: syncEvents with ThreadProcessor
const syncEvents = useCallback(() => {
  const threadId = agent.getCurrentThreadId();
  if (threadId) {
    const threadEvents = agent.getThreadEvents(threadId);
    setEvents([...threadEvents]); // BAD: Triggers React reprocessing
  }
}, [agent]);

// AFTER: Direct streaming processor load
const initializeSession = useCallback(async (threadId?: string) => {
  try {
    const result = await agent.resumeOrCreateThread(threadId);
    
    if (result.isResumed) {
      // Load historical events directly into streaming processor
      const historicalEvents = agent.getThreadEvents(result.threadId);
      streamingTimelineProcessor.reset();
      streamingTimelineProcessor.loadEvents(historicalEvents); // Bulk load once
    }
    
    // No React state updates needed
  } catch (error) {
    logger.error('Session initialization failed', { error });
  }
}, [agent, streamingTimelineProcessor]);
```

**Key Changes**:
- Use `StreamingTimelineProcessor.loadEvents()` for bulk historical data
- No React state updates during session resumption
- One-time O(n) cost for resumption, then pure O(1) incremental

### Phase 3: Remove ThreadProcessor Completely

#### Task 3.1: Remove ThreadProcessor Implementation
**File**: `src/interfaces/thread-processor.ts`
**Test**: Test that removal doesn't break any remaining functionality

**TDD Steps**:
1. Write test confirming no code still imports ThreadProcessor
2. Search codebase for any remaining ThreadProcessor usage
3. Delete `src/interfaces/thread-processor.ts` file entirely
4. Update any remaining imports to use StreamingTimelineProcessor
5. Commit: "refactor: remove ThreadProcessor implementation entirely"

**Verification Commands**:
```bash
# Verify no ThreadProcessor imports
grep -r "thread-processor" src/ && echo "FAIL: ThreadProcessor still imported" || echo "PASS: ThreadProcessor removed"

# Verify no ThreadProcessor usage
grep -r "ThreadProcessor" src/ && echo "FAIL: ThreadProcessor still used" || echo "PASS: ThreadProcessor usage removed"
```

**Files to examine**:
- `src/interfaces/thread-processor.ts` - File to delete
- All files that might import ThreadProcessor

#### Task 3.2: Remove ThreadProcessor Context
**File**: `src/interfaces/terminal/terminal-interface.tsx`
**Test**: Test React context tree without ThreadProcessor

**TDD Steps**:
1. Write test for React component tree using only StreamingTimelineProcessor context
2. Remove ThreadProcessorContext and useThreadProcessor hook
3. Remove ThreadProcessor from React context providers
4. Test all React components work without ThreadProcessor context
5. Commit: "refactor: remove ThreadProcessor from React context"

**Implementation**:
```typescript
// REMOVE: ThreadProcessor context entirely
// const ThreadProcessorContext = createContext<ThreadProcessor | null>(null);
// export const useThreadProcessor = (): ThreadProcessor => { ... }

// KEEP: Only StreamingTimelineProcessor context
const StreamingTimelineProcessorContext = createContext<StreamingTimelineProcessor | null>(null);
export const useStreamingTimelineProcessor = (): StreamingTimelineProcessor => { ... }
```

**Files to examine**:
- `src/interfaces/terminal/terminal-interface.tsx:36-44` - ThreadProcessor context
- React components that use useThreadProcessor hook

#### Task 3.3: Update All Remaining References
**File**: Multiple files throughout codebase
**Test**: Comprehensive test that all timeline functionality works

**TDD Steps**:
1. Write integration test for complete timeline functionality
2. Search and replace any remaining ThreadProcessor references
3. Update imports to use timeline-types and StreamingTimelineProcessor
4. Update tests to use new processor
5. Commit: "refactor: complete ThreadProcessor to StreamingTimelineProcessor migration"

**Files to examine**:
- Any test files that might reference ThreadProcessor
- Documentation that mentions ThreadProcessor
- Type definitions that might reference old interfaces

### Phase 4: Performance Optimization and Validation

#### Task 4.1: Add Performance Monitoring
**File**: `src/interfaces/streaming-timeline-processor.ts`
**Test**: Performance benchmarks and monitoring

**TDD Steps**:
1. Write performance test measuring timeline processing time vs conversation length
2. Write test measuring memory usage over time
3. Add performance metrics to StreamingTimelineProcessor
4. Add performance monitoring to timeline rendering
5. Commit: "feat: add performance monitoring to timeline processing"

**Metrics to Track**:
- Time per appendEvent() call (should be O(1))
- Timeline size vs processing time (should be constant)
- Memory usage growth (should be linear with conversation length)
- UI rendering time per event (should be minimal)

#### Task 4.2: Fix Delegate Thread Performance Issue
**File**: `src/interfaces/terminal/terminal-interface.tsx`
**Test**: Test that delegate threads don't contaminate main timeline processing

**TDD Steps**:
1. Write test confirming main timeline only processes main thread events
2. Write test that delegate threads are processed separately
3. Verify Agent.getThreadEvents() returns only main thread events
4. Test that delegate tool rendering works independently
5. Commit: "fix: ensure delegate threads don't contaminate main timeline processing"

**Implementation Check**:
```typescript
// VERIFY: Agent should use getEvents(), not getMainAndDelegateEvents()
const events = agent.getThreadEvents(threadId); // Should be main thread only
```

This was identified as a major performance contributor in the original analysis.

**Files to examine**:
- `src/agents/agent.ts` - Thread event fetching methods
- `src/interfaces/terminal/components/events/tool-renderers/DelegateToolRenderer.tsx` - Independent delegate processing

#### Task 4.3: Load Testing and Optimization
**File**: `src/__tests__/streaming-timeline-performance.test.ts` (NEW)
**Test**: Comprehensive performance testing

**TDD Steps**:
1. Write load test with 1000+ events to simulate very long conversations
2. Write test measuring CPU usage during event processing
3. Write test for memory leak detection over extended use
4. Implement any needed optimizations based on test results
5. Commit: "test: add comprehensive streaming timeline performance tests"

**Load Test Scenarios**:
- **Small conversation**: 10 events, verify O(1) behavior
- **Medium conversation**: 100 events, verify stable performance
- **Large conversation**: 1000+ events, verify no performance degradation
- **Sustained usage**: Add events continuously, verify no memory leaks

## Success Criteria

### Performance Requirements
- **O(1) processing**: New events processed in constant time regardless of conversation length
- **Low CPU usage**: No sustained high CPU usage during timeline updates
- **Responsive UI**: Timeline updates complete within 100ms
- **Memory efficiency**: Linear memory growth with conversation length, no leaks

### Functional Requirements
- **Complete feature parity**: All ThreadProcessor functionality preserved
- **Session resumption**: --continue works correctly with streaming processor
- **Tool integration**: All tool call/result processing works correctly
- **Error handling**: Graceful handling of malformed events

### Architecture Requirements
- **Single processor**: Only StreamingTimelineProcessor exists, ThreadProcessor completely removed
- **Clean separation**: Timeline types shared, processor implementation separate
- **Event flow**: Pure streaming for real-time, bulk load only for resumption
- **No React dependencies**: Timeline processing independent of React state

## Testing Strategy

### Performance Tests
- **Scalability**: Verify O(1) behavior with conversations of varying length
- **Memory usage**: Monitor memory growth over extended conversations
- **CPU utilization**: Measure CPU usage during timeline processing
- **Load testing**: Stress test with rapid event generation

### Functional Tests
- **Feature parity**: All ThreadProcessor functionality works in StreamingTimelineProcessor
- **Event types**: All event types processed correctly
- **Tool correlation**: Tool call/result pairing works correctly
- **Session resumption**: Historical events loaded correctly on --continue

### Integration Tests
- **End-to-end**: Complete conversation flow using only streaming processor
- **UI updates**: Timeline updates correctly without full reprocessing
- **Agent integration**: Event flow from Agent to StreamingTimelineProcessor works
- **Error scenarios**: Malformed events handled gracefully

### Regression Tests
- **Existing features**: All timeline features continue to work
- **Visual consistency**: Timeline appearance unchanged
- **Interaction patterns**: All timeline interactions (focus, expansion) work
- **Tool renderers**: All tool result rendering works correctly

## Risk Mitigation

### Performance Regression
**Risk**: New implementation could be slower than expected
**Mitigation**: Comprehensive performance testing before rollout
- Benchmark against old implementation
- Load testing with realistic conversation sizes
- Performance monitoring in production

### Feature Loss
**Risk**: Some ThreadProcessor functionality could be missed
**Mitigation**: Comprehensive feature parity testing
- Test all event types and combinations
- Test all timeline interactions
- Compare output with ThreadProcessor before removal

### Memory Leaks
**Risk**: Streaming processor could accumulate memory over time
**Mitigation**: Memory monitoring and leak detection
- Extended runtime testing
- Memory profiling during long conversations
- Cleanup verification for timeline state

### Session Resumption
**Risk**: Historical event loading could break
**Mitigation**: Comprehensive resumption testing
- Test --continue with conversations of various sizes
- Test session resumption after compaction
- Verify timeline state consistency after resumption

## Files to Study

### Current Performance Problem
- `src/interfaces/thread-processor.ts` - O(n) processor to remove
- `src/interfaces/terminal/components/events/ConversationDisplay.tsx` - Still using ThreadProcessor
- `src/interfaces/terminal/terminal-interface.tsx` - Events array state causing React reprocessing

### Streaming Implementation
- `src/interfaces/streaming-timeline-processor.ts` - O(1) processor implementation
- `src/interfaces/terminal/terminal-interface.tsx:169` - StreamingTimelineProcessor context

### Event Flow
- `src/agents/agent.ts` - Agent event emission for timeline updates
- `src/interfaces/terminal/terminal-interface.tsx:172-184` - Event handlers

### Timeline Rendering
- `src/interfaces/terminal/components/events/TimelineDisplay.tsx` - Timeline UI rendering
- `src/interfaces/terminal/components/events/TimelineContent.tsx` - Timeline content rendering

## Verification Commands

### Performance Verification
```bash
# Test with large conversation
npm start -- --continue [large-conversation-id]

# Monitor CPU usage during typing
top -p $(pgrep -f "npm start")

# Run performance tests
npm test -- --grep "performance"
```

### Architecture Verification
```bash
# Verify ThreadProcessor removed
find src/ -name "*thread-processor*" && echo "FAIL: ThreadProcessor still exists" || echo "PASS: ThreadProcessor removed"

# Verify no dual processors
grep -r "ThreadProcessor" src/ && echo "FAIL: ThreadProcessor still referenced" || echo "PASS: ThreadProcessor references removed"

# Verify streaming only
grep -r "StreamingTimelineProcessor" src/ | wc -l # Should be the only processor
```

### Functional Verification
```bash
# Test all functionality
npm test

# Test timeline functionality specifically
npm test timeline

# Test conversation resumption
npm test -- --grep "resumption"
```

This complete replacement strategy eliminates the O(n) performance bottleneck by removing ThreadProcessor entirely and ensuring pure O(1) incremental processing through StreamingTimelineProcessor. The phased approach ensures no functionality is lost while systematically improving performance to handle conversations of any length without performance degradation.