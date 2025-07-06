# Hide ThreadManager Behind Agent: Single Event Source Architecture

## Overview

This plan addresses a fundamental architectural violation in Lace's event system. Currently, interfaces access both Agent and ThreadManager directly, creating dual event sources and violating the documented three-layer architecture.

**Problem**: ThreadManager emits real-time events during normal operation, while Agent also emits events, creating dual event sources that interfaces must handle.

**Solution**: Make Agent the single event source by removing ThreadManager's real-time event emission and handling all event flows through Agent.

## Background Context

### What is Lace?

Lace is an AI coding assistant with:
- **Event-sourced conversations**: All interactions stored as immutable events in SQLite
- **Terminal interface**: React+Ink based CLI with real-time updates
- **Agent system**: AI conversation processing with tool execution
- **Thread management**: Conversations stored as event sequences

### Lace's Three-Layer Architecture

**Documented Design**:
- **Data Layer**: ThreadManager/Persistence (SQLite-based event storage)
- **Logic Layer**: Agent/Tools (conversation processing, AI interaction)  
- **Interface Layer**: Terminal/Web/API (user interaction)

**Intended Flow**: Interface → Agent → ThreadManager

### Current Architectural Violation

**The Problem**: Interfaces access both Agent AND ThreadManager directly, violating layer separation.

**Dual Event Sources**:
- **Agent**: 19 event types (thinking, tool execution, state changes, etc.)
- **ThreadManager**: 2 event types (`thread_updated` - unused, `event_added` - streaming)

**Current Event Flow**:
```
User Input → Agent → ThreadManager.addEvent() → ThreadManager emits events
                                           ↘ Interface subscribes to both
Agent also emits events → Interface        ↗
```

## Key Insight: Two Different Event Use Cases

### 1. **Real-time Events** (During Active Conversation)
- New events happening as conversation progresses
- Should come only from Agent
- Purpose: Update UI immediately as events occur

### 2. **Replay Events** (Session Resumption/Compaction)  
- Historical events loaded from database
- Needed for `--continue` and post-compaction state rebuilding
- Should be handled explicitly by Agent

## Target Architecture

### Single Event Source: Agent Only

**New Event Flow**:
```
User Input → Agent → ThreadManager.addEvent() (silent storage)
                  → Agent.emit() → Interface (single subscription)
```

**Replay Flow**:
```
Session Start → Agent.replayEvents() → Agent.emit() → Interface
```

### Benefits
- **Single event subscription**: Interfaces only listen to Agent
- **Clean layer separation**: ThreadManager becomes pure data storage
- **Explicit replay**: Session resumption handled explicitly by Agent
- **Simplified testing**: Mock only Agent, not Agent + ThreadManager

## Current Architecture Problems

### Direct ThreadManager Access Points

#### 1. Real-time Event Emission
**File**: `src/threads/thread-manager.ts:161`
```typescript
// PROBLEM: ThreadManager emits events during normal operation
this.emit('event_added', { event, threadId });
```

#### 2. Interface Event Subscriptions
**File**: `src/interfaces/terminal/terminal-interface.tsx:173-184`
```typescript
// PROBLEM: Interface subscribes to ThreadManager events
agent.threadManager.on('event_added', handleEventAdded);
```

#### 3. Public ThreadManager Exposure
**File**: `src/agents/agent.ts:50-52`
```typescript
// PROBLEM: Exposes entire ThreadManager to interfaces  
get threadManager(): ThreadManager {
  return this._threadManager;
}
```

#### 4. React Context Exposure
**File**: `src/interfaces/terminal/terminal-interface.tsx:47`
```typescript
// PROBLEM: Makes ThreadManager available to all React components
const ThreadManagerContext = createContext<ThreadManager | null>(null);
```

### Files with ThreadManager Dependencies

**Core Architecture**:
- `src/agents/agent.ts` - Agent implementation with ThreadManager access
- `src/threads/thread-manager.ts` - ThreadManager with event emission
- `src/interfaces/terminal/terminal-interface.tsx` - Direct ThreadManager usage

**Interface Files**:
- `src/interfaces/non-interactive-interface.ts` - CLI interface
- `src/interfaces/terminal/components/events/ConversationDisplay.tsx` - Timeline display

**Supporting Files**:
- Commands that create/manage threads
- Tools that create delegate threads
- CLI argument processing

## Implementation Plan

### Phase 1: Remove ThreadManager Real-time Events

#### Task 1.1: Remove Event Emission from ThreadManager.addEvent()
**File**: `src/threads/thread-manager.ts`
**Test**: Unit test verifying no events emitted during addEvent()

**TDD Steps**:
1. Write test verifying ThreadManager.addEvent() does NOT emit `event_added`
2. Write test verifying events are still properly stored in database
3. Remove `event_added` emission from addEvent() method
4. Run test to confirm events are stored but not emitted
5. Commit: "refactor: remove real-time event emission from ThreadManager.addEvent()"

**Implementation**:
```typescript
// BEFORE: ThreadManager emits events
addEvent(threadId: string, type: EventType, data: any): ThreadEvent {
  // ... create and store event ...
  this.emit('event_added', { event, threadId }); // REMOVE THIS
  return event;
}

// AFTER: Silent storage only
addEvent(threadId: string, type: EventType, data: any): ThreadEvent {
  // ... create and store event ...
  // No event emission - Agent will handle this
  return event;
}
```

**Files to examine**:
- `src/threads/thread-manager.ts:136-164` - Current addEvent() implementation
- `src/threads/__tests__/thread-manager.test.ts` - Existing ThreadManager tests

#### Task 1.2: Update Agent to Emit Events After ThreadManager Calls
**File**: `src/agents/agent.ts`
**Test**: Unit test verifying Agent emits thread_event_added

**TDD Steps**:
1. Write test for Agent emitting `thread_event_added` after addEvent() calls
2. Write test for event payload consistency with ThreadManager format
3. Add immediate event emission after each ThreadManager.addEvent() call
4. Verify both storage and Agent event emission work
5. Commit: "feat: Agent emits thread_event_added after ThreadManager operations"

**Implementation**:
```typescript
// Agent method - UPDATED
async sendMessage(content: string): Promise<void> {
  // Store event in ThreadManager (silent)
  const event = this._threadManager.addEvent(this._getActiveThreadId(), 'USER_MESSAGE', content);
  
  // Agent emits real-time event immediately
  this.emit('thread_event_added', { event, threadId: event.threadId });
  
  // Continue with processing...
}
```

**Agent Event Interface**:
```typescript
export interface AgentEvents {
  // ... existing events ...
  thread_event_added: [{ event: ThreadEvent; threadId: string }];
}
```

**Files to examine**:
- `src/agents/agent.ts:112, 152-157, 490, 787, 848` - All ThreadManager.addEvent() calls
- `src/agents/agent.ts:50-89` - Current event interface

### Phase 2: Add Agent Session Replay

#### Task 2.1: Add Agent Replay Method
**File**: `src/agents/agent.ts`
**Test**: Unit test for session replay functionality

**TDD Steps**:
1. Write test for Agent.replaySessionEvents() method
2. Write test verifying historical events are emitted as thread_event_added
3. Write test for replay during session resumption
4. Implement replaySessionEvents() method
5. Commit: "feat: add Agent session replay for historical events"

**Implementation**:
```typescript
class Agent {
  /**
   * Replay all historical events from current thread for session resumption
   * Used during --continue and post-compaction state rebuilding
   */
  async replaySessionEvents(): Promise<void> {
    const events = this._threadManager.getEvents(this._getActiveThreadId());
    
    logger.debug('Agent: Replaying session events', {
      threadId: this._threadId,
      eventCount: events.length,
    });
    
    // Emit each historical event for UI rebuilding
    for (const event of events) {
      this.emit('thread_event_added', { event, threadId: event.threadId });
    }
    
    logger.debug('Agent: Session replay complete', {
      threadId: this._threadId,
      eventsReplayed: events.length,
    });
  }
}
```

**Files to examine**:
- `src/cli.ts` - Conversation continuation logic for --continue flag
- `src/interfaces/terminal/terminal-interface.tsx:282-291` - Current syncEvents pattern

#### Task 2.2: Add Agent Thread Management API
**File**: `src/agents/agent.ts`
**Test**: Unit tests for Agent thread API methods

**TDD Steps**:
1. Write test for Agent.getCurrentThreadId()
2. Write test for Agent.getThreadEvents()
3. Write test for Agent.generateThreadId()
4. Implement Agent API methods that proxy ThreadManager
5. Commit: "feat: add Agent thread management API"

**Implementation**:
```typescript
class Agent {
  // Thread management API - proxies to ThreadManager
  getCurrentThreadId(): string | null {
    return this._threadManager.getCurrentThreadId();
  }
  
  getThreadEvents(threadId?: string): ThreadEvent[] {
    const targetThreadId = threadId || this._getActiveThreadId();
    return this._threadManager.getEvents(targetThreadId);
  }
  
  generateThreadId(): string {
    return this._threadManager.generateThreadId();
  }
  
  createThread(threadId: string): void {
    this._threadManager.createThread(threadId);
  }
  
  async resumeOrCreateThread(threadId?: string): Promise<ThreadSessionInfo> {
    const result = await this._threadManager.resumeOrCreate(threadId);
    
    // If resuming existing thread, replay events for UI
    if (result.isResumed) {
      await this.replaySessionEvents();
    }
    
    return result;
  }
}
```

**Files to examine**:
- `src/threads/thread-manager.ts` - ThreadManager API methods to proxy
- `src/threads/types.ts` - ThreadSessionInfo interface

### Phase 3: Update Interface Event Handling

#### Task 3.1: Update Terminal Interface to Use Agent Events Only
**File**: `src/interfaces/terminal/terminal-interface.tsx`
**Test**: Integration test for terminal interface using only Agent events

**TDD Steps**:
1. Write test for terminal interface subscribing only to Agent events
2. Write test for conversation resumption using Agent replay
3. Update terminal interface to remove ThreadManager event subscriptions
4. Update event handlers to use Agent events
5. Commit: "feat: migrate terminal interface to Agent-only events"

**Implementation**:
```typescript
// BEFORE: Dual event subscriptions
useEffect(() => {
  const handleEventAdded = (data: { event: ThreadEvent; threadId: string }) => {
    // ... handle event ...
  };
  
  agent.threadManager.on('event_added', handleEventAdded); // REMOVE
  return () => agent.threadManager.off('event_added', handleEventAdded);
}, []);

// AFTER: Single Agent event subscription
useEffect(() => {
  const handleEventAdded = (data: { event: ThreadEvent; threadId: string }) => {
    const currentThreadId = agent.getCurrentThreadId();
    if (data.threadId === currentThreadId) {
      // Process event for UI update
      // ... existing logic ...
    }
  };
  
  agent.on('thread_event_added', handleEventAdded);
  return () => agent.off('thread_event_added', handleEventAdded);
}, [agent]);
```

**Files to examine**:
- `src/interfaces/terminal/terminal-interface.tsx:173-184` - Current event subscriptions
- `src/interfaces/terminal/terminal-interface.tsx:282-291` - Current syncEvents method

#### Task 3.2: Update Session Resumption Logic
**File**: `src/interfaces/terminal/terminal-interface.tsx`
**Test**: Test session resumption with Agent replay

**TDD Steps**:
1. Write test for session resumption using Agent.resumeOrCreateThread()
2. Write test for conversation continuation with --continue flag
3. Update session initialization to use Agent API
4. Remove direct ThreadManager session access
5. Commit: "feat: update session resumption to use Agent API"

**Implementation**:
```typescript
// BEFORE: Direct ThreadManager access
const syncEvents = useCallback(() => {
  const threadId = agent.threadManager.getCurrentThreadId();
  if (threadId) {
    const threadEvents = agent.threadManager.getEvents(threadId);
    // ... process events ...
  }
}, [agent]);

// AFTER: Agent API with automatic replay
const initializeSession = useCallback(async (threadId?: string) => {
  try {
    const result = await agent.resumeOrCreateThread(threadId);
    
    if (result.resumeError) {
      logger.warn('Session resumption failed', { 
        error: result.resumeError,
        threadId 
      });
    }
    
    // Events automatically replayed by Agent.resumeOrCreateThread()
    setCurrentThreadId(result.threadId);
  } catch (error) {
    logger.error('Session initialization failed', { error });
  }
}, [agent]);
```

**Files to examine**:
- `src/cli.ts` - CLI continuation logic
- `src/interfaces/terminal/terminal-interface.tsx:294-304` - Session initialization

#### Task 3.3: Update Non-Interactive Interface
**File**: `src/interfaces/non-interactive-interface.ts`
**Test**: Test non-interactive interface using Agent API

**TDD Steps**:
1. Write test for non-interactive interface using Agent instead of ThreadManager
2. Update interface to use Agent API for thread operations
3. Remove direct ThreadManager access
4. Test CLI functionality works correctly
5. Commit: "feat: migrate non-interactive interface to Agent API"

**Implementation**:
```typescript
// BEFORE: Direct ThreadManager access
const threadId = agent.threadManager.generateThreadId();
agent.threadManager.createThread(threadId);

// AFTER: Agent API
const threadId = agent.generateThreadId();
agent.createThread(threadId);
```

**Files to examine**:
- `src/interfaces/non-interactive-interface.ts` - Current ThreadManager usage
- `src/cli.ts` - CLI argument processing and thread creation

### Phase 4: Remove ThreadManager Public Access

#### Task 4.1: Remove ThreadManager Public Getter from Agent
**File**: `src/agents/agent.ts`
**Test**: Test that Agent API provides all needed functionality

**TDD Steps**:
1. Write test verifying all interfaces can work through Agent API
2. Write test that Agent API covers all ThreadManager use cases
3. Remove public threadManager getter from Agent
4. Make _threadManager private
5. Commit: "refactor: remove ThreadManager public access from Agent"

**Implementation**:
```typescript
class Agent {
  // REMOVE: Public getter
  // get threadManager(): ThreadManager {
  //   return this._threadManager;
  // }
  
  // KEEP: Private field
  private readonly _threadManager: ThreadManager;
}
```

**Files to examine**:
- `src/agents/agent.ts:50-52` - Current public getter
- All files that access `agent.threadManager` to ensure they use Agent API

#### Task 4.2: Remove ThreadManager React Context
**File**: `src/interfaces/terminal/terminal-interface.tsx`
**Test**: Test React components work without ThreadManager context

**TDD Steps**:
1. Write test for React component tree without ThreadManager context
2. Remove ThreadManager context provider and hook
3. Update components to get thread data via Agent API or props
4. Test all React functionality works
5. Commit: "refactor: remove ThreadManager from React context"

**Implementation**:
```typescript
// REMOVE: ThreadManager context
// const ThreadManagerContext = createContext<ThreadManager | null>(null);
// export const useThreadManager = (): ThreadManager => { ... }

// KEEP: Only Agent context if needed for components
// Most components should receive data via props instead
```

**Files to examine**:
- `src/interfaces/terminal/terminal-interface.tsx:47-55` - ThreadManager context
- `src/interfaces/terminal/components/events/ConversationDisplay.tsx` - Components using context

#### Task 4.3: Update Commands and Tools
**File**: Various command and tool files
**Test**: Test commands and tools using Agent API

**TDD Steps**:
1. Write tests for commands using Agent API instead of ThreadManager
2. Update commands to use Agent thread methods
3. Update tools (especially delegate tool) to use Agent API
4. Test all command and tool functionality
5. Commit: "feat: migrate commands and tools to Agent API"

**Implementation**:
```typescript
// Commands - BEFORE
const threadId = agent.threadManager.generateThreadId();

// Commands - AFTER  
const threadId = agent.generateThreadId();

// Tools - delegate tool BEFORE
const delegateThread = agent.threadManager.createDelegateThreadFor(parentId);

// Tools - delegate tool AFTER (add to Agent API)
const delegateThread = agent.createDelegateThread(parentId);
```

**Files to examine**:
- `src/commands/system/` - System commands that manage threads
- `src/tools/implementations/delegate.ts` - Delegate tool that creates threads
- Any other tools that access thread data

### Phase 5: Clean Up Legacy Events

#### Task 5.1: Remove Unused thread_updated Event
**File**: `src/threads/thread-manager.ts`
**Test**: Test that removing thread_updated doesn't break anything

**TDD Steps**:
1. Write test confirming thread_updated is not used anywhere
2. Search codebase for any thread_updated usage
3. Remove thread_updated event emission from ThreadManager
4. Test that system works without thread_updated
5. Commit: "refactor: remove unused thread_updated event"

**Implementation**:
```typescript
// REMOVE: Unused event emission
// this.emit('thread_updated', { threadId, eventType: type });
```

**Verification Commands**:
```bash
# Verify no thread_updated usage
grep -r "thread_updated" src/ || echo "No thread_updated usage found"
```

**Files to examine**:
- `src/threads/thread-manager.ts:161` - Current thread_updated emission
- Search results for any thread_updated listeners

#### Task 5.2: Remove ThreadManager Event Infrastructure
**File**: `src/threads/thread-manager.ts`
**Test**: Test ThreadManager as pure data layer

**TDD Steps**:
1. Write test verifying ThreadManager has no event emission
2. Remove EventEmitter inheritance from ThreadManager
3. Remove all event-related code from ThreadManager
4. Test that ThreadManager works as pure data storage
5. Commit: "refactor: convert ThreadManager to pure data layer"

**Implementation**:
```typescript
// BEFORE: ThreadManager extends EventEmitter
export class ThreadManager extends EventEmitter {

// AFTER: Pure class with no event functionality
export class ThreadManager {
  // Remove EventEmitter inheritance
  // Remove all emit() calls
  // Remove event listener methods
}
```

**Files to examine**:
- `src/threads/thread-manager.ts:19` - EventEmitter inheritance
- All emit() calls within ThreadManager

### Phase 6: Documentation and Testing

#### Task 6.1: Update Architecture Documentation
**File**: `docs/architecture.md`
**Test**: Documentation review

**TDD Steps**:
1. Update architecture docs to reflect Agent as single event source
2. Document Agent event facade pattern
3. Update API documentation for Agent thread methods
4. Remove references to direct ThreadManager access
5. Commit: "docs: update architecture documentation for Agent event facade"

**Content Updates**:
- Three-layer architecture compliance
- Agent as single Logic Layer interface
- Event flow diagrams
- API patterns and best practices

#### Task 6.2: Add Comprehensive Integration Tests
**File**: `src/__tests__/agent-single-event-source.test.ts`
**Test**: End-to-end testing of single event source architecture

**TDD Steps**:
1. Write test for complete conversation flow using only Agent events
2. Write test for session resumption using Agent replay
3. Write test for post-compaction replay
4. Write test verifying no ThreadManager events during normal operation
5. Commit: "test: add comprehensive Agent event source integration tests"

**Test Scenarios**:
- Normal conversation flow with only Agent events
- Session resumption with historical event replay
- Tool execution with Agent event emission
- Error handling with Agent events only

## Testing Strategy

### Unit Tests
- ThreadManager addEvent() method emits no events
- Agent emits thread_event_added after ThreadManager operations
- Agent replay method processes historical events correctly
- Agent API methods proxy ThreadManager functionality correctly

### Integration Tests
- End-to-end conversation using only Agent events
- Session resumption with Agent replay
- Interface functionality without ThreadManager access
- Tool and command execution through Agent API

### Regression Tests
- All existing functionality works through Agent
- No performance degradation from event proxying
- Memory usage remains stable
- Complete feature parity with previous architecture

### Migration Tests
- Both old and new event patterns work during transition
- Gradual migration doesn't break functionality
- No data loss during migration

## Success Criteria

### Architectural Compliance
- **Single event source**: Interfaces only subscribe to Agent events
- **Layer separation**: ThreadManager is pure data storage with no event logic
- **Clean APIs**: All thread operations go through Agent methods
- **No dual access**: No interface accesses ThreadManager directly

### Functional Equivalence
- **All features work**: Every existing feature works through Agent API
- **Performance maintained**: No performance degradation from event proxying
- **Session resumption**: --continue flag works with Agent replay
- **Tool integration**: All tools work with Agent API

### Code Quality
- **Reduced coupling**: Interfaces depend only on Agent, not ThreadManager
- **Simplified testing**: Mock only Agent for interface tests
- **Clear boundaries**: Data/Logic/Interface layers properly separated
- **Consistent patterns**: All event handling follows same Agent pattern

## Risk Mitigation

### Breaking Changes
**Risk**: Migration could break existing functionality
**Mitigation**: Phased approach with backward compatibility
- Test each phase independently
- Keep both patterns working during transition
- Remove old patterns only after all consumers migrated

### Event Ordering
**Risk**: Event ordering could change with new architecture
**Mitigation**: Preserve exact event order
- Agent emits events in same order as ThreadManager storage
- Integration tests verify event ordering
- Session replay maintains chronological order

### Performance Impact
**Risk**: Additional event proxying could affect performance
**Mitigation**: Minimal overhead with monitoring
- Events are infrequent compared to rendering
- Performance tests verify no degradation
- Memory usage monitoring during migration

### Session Resumption
**Risk**: --continue functionality could break
**Mitigation**: Explicit testing and gradual rollout
- Comprehensive session resumption tests
- Test with large conversation histories
- Verify post-compaction replay works

## Files to Study

### Core Architecture
- `src/agents/agent.ts` - Agent implementation and current ThreadManager usage
- `src/threads/thread-manager.ts` - ThreadManager with event emission to remove
- `docs/architecture.md` - Documented three-layer architecture

### Event Patterns
- `src/agents/agent.ts:82-89` - Current Agent event proxying infrastructure
- `src/threads/thread-manager.ts:161-164` - ThreadManager event emission to remove
- `src/interfaces/terminal/terminal-interface.tsx:173-184` - Interface event subscriptions

### Interface Integration
- `src/interfaces/terminal/terminal-interface.tsx` - Main interface with dual event subscriptions
- `src/interfaces/non-interactive-interface.ts` - CLI interface patterns
- `src/interfaces/terminal/components/events/ConversationDisplay.tsx` - React component usage

### Thread Operations
- `src/cli.ts` - Session continuation logic for --continue
- `src/tools/implementations/delegate.ts` - Delegate tool thread creation
- `src/commands/system/` - Commands that manage threads

## Verification Commands

### Architecture Compliance
```bash
# Verify no ThreadManager event emission during normal operation
grep -n "emit.*event_added" src/threads/thread-manager.ts && echo "FAIL: Still emitting events" || echo "PASS: No event emission"

# Verify no direct ThreadManager access in interfaces  
grep -r "threadManager\." src/interfaces/ && echo "FAIL: Direct access found" || echo "PASS: No direct access"

# Verify Agent events only
grep -r "\.on.*thread_event_added" src/interfaces/ | grep -v agent && echo "FAIL: Non-agent subscription" || echo "PASS: Agent events only"
```

### Functional Testing
```bash
# Run all tests
npm test

# Test session resumption
npm test -- --grep "session.*resumption"

# Test interface functionality
npm test interfaces

# Test Agent API
npm test agent
```

### Event System Testing
```bash
# Test event flow
npm test -- --grep "event.*flow"

# Test no dual events
npm test -- --grep "single.*event.*source"
```

This architectural refactoring establishes proper layer separation by making Agent the single event source for all interface interactions. ThreadManager becomes a pure data storage layer, while Agent handles all event emission for both real-time updates and session replay scenarios. The phased approach ensures no functionality is lost while systematically improving the system design to match the documented three-layer architecture.