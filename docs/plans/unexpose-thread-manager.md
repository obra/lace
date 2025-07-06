# Hide ThreadManager Behind Agent: Single Event Source Architecture

## Overview

This plan addresses a fundamental architectural violation in Lace's event system. Currently, interfaces access both Agent and ThreadManager directly, creating dual event sources and violating the documented three-layer architecture.

**Problem**: Interfaces bypass the Logic Layer (Agent) and directly access the Data Layer (ThreadManager), creating coupling and architectural violations.

**Solution**: Hide ThreadManager behind Agent, making Agent the single event source and API gateway for all thread operations.

## Background Context

### What is Lace's Architecture?

Lace follows a **three-layer architecture**:
- **Data Layer**: ThreadManager/Persistence (SQLite-based event storage)
- **Logic Layer**: Agent/Tools (conversation processing, AI interaction)  
- **Interface Layer**: Terminal/Web/API (user interaction)

### Current Architectural Violation

**Documented Design**: Interface → Agent → ThreadManager
**Current Reality**: Interface → Agent + ThreadManager (dual access)

### Event System Problems

**Current Event Sources**:
- **Agent**: 19 event types (thinking, tool execution, state changes, etc.)
- **ThreadManager**: 2 event types (`thread_updated` - unused, `event_added` - streaming)

**Issues**:
1. **Dual event subscriptions**: Interfaces must listen to both Agent and ThreadManager
2. **Direct data access**: Interfaces call ThreadManager methods directly via `agent.threadManager`
3. **Coupling**: Interfaces understand both Agent and ThreadManager APIs
4. **Testing complexity**: Must mock both Agent and ThreadManager

## Current Architecture Analysis

### Direct ThreadManager Access Points

#### 1. Public ThreadManager Exposure
**File**: `src/agents/agent.ts`
```typescript
// BAD: Exposes entire ThreadManager to interfaces
get threadManager(): ThreadManager {
  return this._threadManager;
}
```

#### 2. React Context Exposure  
**File**: `src/interfaces/terminal/terminal-interface.tsx`
```typescript
// BAD: Makes ThreadManager available to all React components
const ThreadManagerContext = createContext<ThreadManager | null>(null);
```

#### 3. Direct Event Subscriptions
**File**: `src/interfaces/terminal/terminal-interface.tsx`
```typescript
// BAD: Interface subscribes to ThreadManager events directly
agent.threadManager.on('event_added', handleEventAdded);
```

#### 4. Direct Method Calls
**File**: `src/interfaces/terminal/terminal-interface.tsx`
```typescript
// BAD: Interface calls ThreadManager methods directly
const threadEvents = agent.threadManager.getEvents(threadId);
const newThreadId = agent.threadManager.generateThreadId();
```

### Files with ThreadManager Dependencies

**Interface Files**:
- `src/interfaces/terminal/terminal-interface.tsx` - Main terminal interface
- `src/interfaces/non-interactive-interface.ts` - CLI interface  
- `src/interfaces/terminal/components/events/ConversationDisplay.tsx` - Timeline display

**Command Files**:
- Commands that create/manage threads
- CLI argument processing

**Tool Files**:
- Tools that create delegate threads
- Tools that access thread data

## Target Architecture

### Agent as Single Event Source

**New Event Flow**:
```
ThreadManager → Agent (internal) → Agent Events → Interface
```

**Benefits**:
- Single event subscription point for interfaces
- Clean layer separation matching documented architecture
- Simplified testing (mock only Agent)
- Future flexibility (can change ThreadManager without interface changes)

### Agent Event Facade

Agent will emit these new events:
- `thread_event_added` - Proxy for ThreadManager's `event_added`
- `thread_state_changed` - Proxy for ThreadManager's `thread_updated` (if needed)

### Agent API Gateway

Agent will provide these methods:
- `generateThreadId()` - Proxy for ThreadManager method
- `createThread()` - Proxy for ThreadManager method
- `getThreadEvents()` - Proxy for ThreadManager.getEvents()
- `getCurrentThreadId()` - Proxy for ThreadManager method
- `resumeOrCreateThread()` - Proxy for ThreadManager method

## Implementation Plan

### Phase 1: Add Agent Event Proxying

#### Task 1.1: Add Agent Event Infrastructure
**File**: `src/agents/agent.ts`
**Test**: Unit tests for event proxying

**TDD Steps**:
1. Write test for Agent emitting `thread_event_added` when ThreadManager emits `event_added`
2. Write test for event payload consistency
3. Implement Agent event proxying in constructor
4. Verify both Agent and ThreadManager events work (backward compatibility)
5. Commit: "feat: add Agent event proxying for ThreadManager events"

**Implementation**:
```typescript
export interface AgentEvents extends Record<string, any[]> {
  // Existing Agent events...
  thread_event_added: [{ event: ThreadEvent; threadId: string }];
  thread_state_changed: [{ threadId: string; eventType: string }];
}

class Agent extends EventEmitter<AgentEvents> {
  constructor() {
    super();
    
    // Proxy ThreadManager events as Agent events
    this._threadManager.on('event_added', (data) => {
      this.emit('thread_event_added', data);
    });
    
    this._threadManager.on('thread_updated', (data) => {
      this.emit('thread_state_changed', data);
    });
  }
}
```

**Files to examine**:
- `src/agents/agent.ts` - Current Agent event system
- `src/threads/thread-manager.ts` - ThreadManager events

#### Task 1.2: Test Dual Event System
**File**: `src/__tests__/agent-thread-events.test.ts`
**Test**: Integration test for dual event system

**TDD Steps**:
1. Write test creating thread events via Agent
2. Verify both ThreadManager and Agent events are emitted
3. Test event payload consistency
4. Test event timing/ordering
5. Commit: "test: verify Agent event proxying works alongside ThreadManager events"

### Phase 2: Add Agent API Gateway

#### Task 2.1: Add Thread Management API
**File**: `src/agents/agent.ts`
**Test**: Unit tests for Agent thread API

**TDD Steps**:
1. Write test for `agent.generateThreadId()`
2. Write test for `agent.createThread()`
3. Write test for `agent.getThreadEvents()`
4. Implement Agent methods that proxy ThreadManager
5. Commit: "feat: add Agent thread management API"

**Implementation**:
```typescript
class Agent {
  // Thread management API - proxies to ThreadManager
  generateThreadId(): string {
    return this._threadManager.generateThreadId();
  }
  
  createThread(threadId: string): void {
    this._threadManager.createThread(threadId);
  }
  
  getThreadEvents(threadId: string): ThreadEvent[] {
    return this._threadManager.getEvents(threadId);
  }
  
  getCurrentThreadId(): string | null {
    return this._threadManager.getCurrentThreadId();
  }
  
  async resumeOrCreateThread(threadId?: string): Promise<ThreadSessionInfo> {
    return this._threadManager.resumeOrCreate(threadId);
  }
}
```

**Files to examine**:
- `src/threads/thread-manager.ts` - ThreadManager API to proxy
- `src/interfaces/terminal/terminal-interface.tsx` - Current ThreadManager usage

#### Task 2.2: Add Delegate Thread Support
**File**: `src/agents/agent.ts`  
**Test**: Test delegate thread operations

**TDD Steps**:
1. Write test for `agent.createDelegateThread()`
2. Write test for delegate thread access patterns
3. Implement delegate thread API on Agent
4. Test tool integration with Agent delegate API
5. Commit: "feat: add Agent delegate thread API"

**Implementation**:
```typescript
class Agent {
  createDelegateThread(parentThreadId: string): Thread {
    return this._threadManager.createDelegateThreadFor(parentThreadId);
  }
  
  getDelegateThreads(parentThreadId: string): string[] {
    // Proxy to ThreadManager's delegate methods
    return this._threadManager.getDelegateThreadsFor(parentThreadId);
  }
}
```

**Files to examine**:
- `src/tools/implementations/delegate.ts` - Current delegate thread usage
- `src/threads/thread-manager.ts` - Delegate thread methods

### Phase 3: Update Interface Event Handling

#### Task 3.1: Update Terminal Interface Events
**File**: `src/interfaces/terminal/terminal-interface.tsx`
**Test**: Integration test for Agent event usage

**TDD Steps**:
1. Write test for terminal interface using Agent events instead of ThreadManager
2. Update terminal interface to subscribe to Agent events
3. Remove ThreadManager event subscriptions
4. Test that all functionality works with Agent events
5. Commit: "feat: migrate terminal interface to Agent events"

**Implementation**:
```typescript
// BEFORE: Direct ThreadManager events
agent.threadManager.on('event_added', handleEventAdded);

// AFTER: Agent events
agent.on('thread_event_added', handleEventAdded);
```

**Files to examine**:
- `src/interfaces/terminal/terminal-interface.tsx` - Current event handling
- Event handler methods that process ThreadManager events

#### Task 3.2: Update Non-Interactive Interface
**File**: `src/interfaces/non-interactive-interface.ts`
**Test**: Test non-interactive interface with Agent API

**TDD Steps**:
1. Write test for non-interactive interface using Agent instead of ThreadManager
2. Update interface to use Agent API methods
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
- `src/cli.ts` - CLI thread creation patterns

#### Task 3.3: Update React Components
**File**: `src/interfaces/terminal/components/events/ConversationDisplay.tsx`
**Test**: Test React components with Agent context only

**TDD Steps**:
1. Write test for ConversationDisplay without ThreadManager context
2. Update components to get thread data via Agent API
3. Remove ThreadManager context usage
4. Test timeline display functionality
5. Commit: "feat: migrate React components to Agent API"

**Implementation**:
```typescript
// BEFORE: ThreadManager context
const threadManager = useThreadManager();
const events = threadManager.getEvents(threadId);

// AFTER: Agent context (or props)
const events = agent.getThreadEvents(threadId);
```

**Files to examine**:
- `src/interfaces/terminal/components/events/ConversationDisplay.tsx` - ThreadManager context usage
- Other React components that use ThreadManager context

### Phase 4: Update Commands and Tools

#### Task 4.1: Update Commands
**File**: Various command files
**Test**: Test commands using Agent API

**TDD Steps**:
1. Write tests for commands using Agent API instead of ThreadManager
2. Update commands to use Agent thread methods
3. Remove direct ThreadManager access from commands
4. Test all command functionality
5. Commit: "feat: migrate commands to Agent API"

**Files to examine**:
- `src/commands/system/` - System commands that manage threads
- Any commands that create or access threads

#### Task 4.2: Update Tools
**File**: Tool implementation files
**Test**: Test tools using Agent for thread operations

**TDD Steps**:
1. Write tests for tools using Agent API
2. Update delegate tool to use Agent delegate API
3. Update other tools that access thread data
4. Test tool execution and thread interaction
5. Commit: "feat: migrate tools to Agent API"

**Files to examine**:
- `src/tools/implementations/delegate.ts` - Creates delegate threads
- Other tools that access thread data

### Phase 5: Remove ThreadManager Exposure

#### Task 5.1: Remove ThreadManager Public Access
**File**: `src/agents/agent.ts`
**Test**: Test that interfaces can't access ThreadManager directly

**TDD Steps**:
1. Write test verifying Agent API provides all needed functionality
2. Remove `get threadManager()` public getter from Agent
3. Make `_threadManager` private
4. Test that all functionality still works through Agent API
5. Commit: "refactor: remove ThreadManager public access from Agent"

**Implementation**:
```typescript
class Agent {
  // REMOVE: public getter
  // get threadManager(): ThreadManager {
  //   return this._threadManager;
  // }
  
  // KEEP: private field
  private _threadManager: ThreadManager;
}
```

#### Task 5.2: Remove ThreadManager React Context
**File**: `src/interfaces/terminal/terminal-interface.tsx`
**Test**: Test React components work without ThreadManager context

**TDD Steps**:
1. Write test for React tree without ThreadManager context
2. Remove ThreadManager context provider and hook
3. Remove ThreadManager imports from React components
4. Test all React functionality works
5. Commit: "refactor: remove ThreadManager from React context"

**Implementation**:
```typescript
// REMOVE: ThreadManager context
// const ThreadManagerContext = createContext<ThreadManager | null>(null);
// export const useThreadManager = (): ThreadManager => { ... }

// KEEP: Only Agent context (if needed)
```

#### Task 5.3: Clean Up Imports and Dependencies
**File**: Multiple files
**Test**: Test that build works without ThreadManager imports

**TDD Steps**:
1. Write test verifying no interface files import ThreadManager
2. Remove unused ThreadManager imports from interface files
3. Update type imports where needed
4. Run build and tests to verify cleanup
5. Commit: "refactor: remove unused ThreadManager imports from interfaces"

### Phase 6: Clean Up Legacy Events

#### Task 6.1: Remove Unused thread_updated Event
**File**: `src/threads/thread-manager.ts`
**Test**: Test that removing thread_updated doesn't break anything

**TDD Steps**:
1. Write test confirming thread_updated is not used anywhere
2. Remove thread_updated event emission from ThreadManager
3. Clean up any references to thread_updated
4. Test that system works without thread_updated
5. Commit: "refactor: remove unused thread_updated event"

**Implementation**:
```typescript
// REMOVE: Unused event
// this.emit('thread_updated', { threadId, eventType: type });
```

**Files to examine**:
- Search codebase for any remaining `thread_updated` usage

#### Task 6.2: Update Documentation  
**File**: `docs/architecture.md`
**Test**: Documentation review

**TDD Steps**:
1. Update architecture documentation to reflect Agent as single interface
2. Document Agent event facade pattern
3. Update API documentation for Agent thread methods
4. Remove references to direct ThreadManager access
5. Commit: "docs: update architecture documentation for Agent event facade"

## Testing Strategy

### Unit Tests
- Agent event proxying functionality  
- Agent API method delegation
- Event payload consistency
- Error handling in Agent methods

### Integration Tests
- End-to-end interface usage with Agent only
- Thread management through Agent API
- Event flow from ThreadManager → Agent → Interface
- Tool and command functionality with Agent API

### Regression Tests
- All existing functionality works through Agent
- Performance impact of event proxying
- Memory usage with Agent facade
- No loss of features or capabilities

### Migration Tests
- Backward compatibility during transition phases
- Gradual migration doesn't break functionality
- Both old and new event paths work during transition

## Success Criteria

### Architectural Compliance
- Interfaces only access Agent, never ThreadManager directly
- Event flow matches documented three-layer architecture
- Clean separation between Data/Logic/Interface layers

### Functional Equivalence  
- All existing functionality works through Agent
- No performance degradation
- No feature loss or behavior changes
- All tests pass

### Code Quality
- Reduced coupling between Interface and Data layers
- Simplified testing (mock only Agent)
- Clear API boundaries
- Consistent event patterns

## Risk Mitigation

### Breaking Changes Risk
**Mitigation**: Phased approach with backward compatibility
- Keep old ThreadManager access during transition
- Test both old and new patterns work simultaneously
- Remove old access only after all consumers migrated

### Performance Risk
**Mitigation**: Minimal event proxying overhead
- Events are infrequent compared to rendering operations
- Agent event proxying adds negligible latency
- Performance tests verify no degradation

### Complexity Risk  
**Mitigation**: Keep Agent API simple and focused
- Only proxy methods that are actually used
- Don't add unnecessary abstraction layers
- Maintain clear method signatures

### Testing Risk
**Mitigation**: Comprehensive test coverage
- Test each migration phase independently
- Integration tests for full event flow
- Regression tests for existing functionality

## Files to Study

### Core Architecture
- `src/agents/agent.ts` - Agent implementation and event system
- `src/threads/thread-manager.ts` - ThreadManager events and API
- `docs/architecture.md` - Documented three-layer architecture

### Interface Integration
- `src/interfaces/terminal/terminal-interface.tsx` - Main interface ThreadManager usage
- `src/interfaces/non-interactive-interface.ts` - CLI interface patterns
- `src/interfaces/terminal/components/events/ConversationDisplay.tsx` - React component usage

### Event Patterns
- `src/agents/agent.ts` - Current Agent event system
- Event handler methods in interfaces
- React context patterns

### Thread Operations
- Commands that create/manage threads
- Tools that access thread data (especially delegate tool)
- CLI argument processing for thread operations

## Verification Commands

### Architecture Compliance
```bash
# Verify no direct ThreadManager imports in interface files
grep -r "ThreadManager" src/interfaces/ || echo "No ThreadManager imports found"

# Verify no agent.threadManager usage
grep -r "agent\.threadManager" src/ || echo "No direct ThreadManager access found"
```

### Functional Testing
```bash
# Run all tests
npm test

# Run interface-specific tests
npm test interfaces

# Test thread management functionality
npm test thread
```

### Event System Testing
```bash
# Test Agent event system
npm test agent

# Test event integration
npm test event
```

This architectural refactoring establishes proper layer separation and creates a clean, maintainable event system that matches the documented three-layer architecture. The phased approach ensures no functionality is lost while systematically improving the system design.