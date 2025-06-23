# Delegated Threads UI Implementation Plan

## Overview

This plan addresses the UX issues with the current delegation system where:
- UI switches to delegated thread ID but shows no events
- Users can't reply because conversation context is lost
- No way to see delegation conversation progress
- No way to switch between main and delegate threads

The solution leverages the existing `threadId` field on `ThreadEvent` to display delegate thread events inline within the main conversation, using collapsible boxes with fullscreen capability.

## Current Problem Analysis

### Current Delegation Flow
1. Main agent calls `delegate` tool
2. `DelegateTool` creates new thread with `delegate_` prefix
3. Subagent runs in separate thread using `ThreadManager`
4. UI switches to show delegate thread ID
5. **Problem**: No events appear because UI only shows single thread
6. **Problem**: User can't reply because context is lost

### Root Cause
- `ThreadManager.getEvents(threadId)` only returns single thread events
- `TerminalInterface` only queries current thread ID
- No UI concept of related/child threads

## Solution Architecture

### Core Principle
Use existing `threadId` field on `ThreadEvent` to display multiple related threads inline, rather than creating new event types or hierarchical structures.

### Key Components
1. **ThreadManager Enhancement**: Query main + delegate threads together
2. **UI Event Grouping**: Group consecutive events by threadId
3. **Delegation Boxes**: Collapsible containers for delegate conversations
4. **Fullscreen Mode**: Deep-dive view for complex delegations

## Detailed Implementation

### 1. ThreadManager Enhancement

Add multi-thread querying capability with hierarchical thread naming:

```typescript
// In src/threads/thread-manager.ts
class ThreadManager {
  // NEW: Get events from main thread + any delegate threads
  getMainAndDelegateEvents(mainThreadId: string): ThreadEvent[] {
    const allEvents: ThreadEvent[] = [];
    
    // Get main thread events
    allEvents.push(...this.getEvents(mainThreadId));
    
    // Get delegate thread events using hierarchical naming
    const delegateThreads = this._persistence.getDelegateThreadsFor(mainThreadId);
    for (const delegateThreadId of delegateThreads) {
      const delegateEvents = this._persistence.loadEvents(delegateThreadId);
      allEvents.push(...delegateEvents);
    }
    
    // Sort chronologically across all threads
    return allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
  
  // NEW: Generate hierarchical delegate thread IDs
  generateDelegateThreadId(parentThreadId: string): string {
    const existingDelegates = this._persistence.getDelegateThreadsFor(parentThreadId);
    
    // Find highest counter for immediate children only
    let maxCounter = 0;
    const pattern = new RegExp(`^${escapeRegex(parentThreadId)}\\.(\\d+)$`);
    
    for (const delegateId of existingDelegates) {
      const match = delegateId.match(pattern);
      if (match) {
        const counter = parseInt(match[1], 10);
        maxCounter = Math.max(maxCounter, counter);
      }
    }
    
    return `${parentThreadId}.${maxCounter + 1}`;
  }
}

// Helper function for regex escaping
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

### Hierarchical Thread Naming Scheme

**Main thread**: `lace_20250101_abc123`  
**First delegate**: `lace_20250101_abc123.1`  
**Second delegate**: `lace_20250101_abc123.2`  
**Sub-delegate from first**: `lace_20250101_abc123.1.1`  
**Sub-delegate from second**: `lace_20250101_abc123.2.1`

This scheme:
- Naturally supports unlimited nesting levels
- Makes parent-child relationships explicit in thread IDs
- Enables efficient SQL queries for finding delegates
- Supports concurrent delegation without ID conflicts

### Persistence Layer Enhancement

Add delegate thread querying to ThreadPersistence:

```typescript
// In src/threads/persistence.ts
class ThreadPersistence {
  // NEW: Find delegate threads for a given parent thread
  getDelegateThreadsFor(parentThreadId: string): string[] {
    if (this._disabled || !this.db) return [];

    const stmt = this.db.prepare(`
      SELECT DISTINCT thread_id FROM events 
      WHERE thread_id LIKE ? 
      ORDER BY thread_id ASC
    `);

    const pattern = `${parentThreadId}.%`;
    const rows = stmt.all(pattern) as Array<{ thread_id: string }>;
    return rows.map(row => row.thread_id);
  }
}
```

### 2. TerminalInterface Update

Single line change to use multi-thread querying:

```typescript
// In src/ui/terminal-interface.tsx
// Line ~57 - CHANGE THIS:
const threadEvents = agent.threadManager.getEvents(threadId);

// TO THIS:
const threadEvents = agent.threadManager.getMainAndDelegateEvents(threadId);
```

### 3. ThreadProcessor Enhancement

Add thread grouping logic to process mixed-thread events:

```typescript
// In src/ui/thread-processor.tsx
export const processThreadEventsToTimeline = (events: ThreadEvent[]): TimelineItem[] => {
  const processedItems: TimelineItem[] = [];
  
  // Group consecutive events by threadId
  const threadGroups = groupConsecutiveEventsByThread(events);
  
  for (const group of threadGroups) {
    if (isDelegateThread(group.threadId)) {
      // Create delegation box containing all events from this delegate thread
      processedItems.push({
        id: `delegation-${group.threadId}`,
        type: 'delegation' as TimelineItemType,
        timestamp: group.events[0].timestamp,
        threadId: group.threadId,
        events: group.events,
        component: <DelegationBox threadId={group.threadId} events={group.events} />
      });
    } else {
      // Process main thread events normally
      processedItems.push(...processEventsToTimelineItems(group.events));
    }
  }
  
  return processedItems;
};

// Helper to identify delegate threads
const isDelegateThread = (threadId: string): boolean => {
  // Check if thread ID contains a dot (indicating it's a delegate)
  return threadId.includes('.');
};

// Helper function to group consecutive events by threadId
const groupConsecutiveEventsByThread = (events: ThreadEvent[]) => {
  const groups: Array<{ threadId: string; events: ThreadEvent[] }> = [];
  let currentGroup: { threadId: string; events: ThreadEvent[] } | null = null;
  
  for (const event of events) {
    if (!currentGroup || currentGroup.threadId !== event.threadId) {
      // Start new group
      currentGroup = { threadId: event.threadId, events: [event] };
      groups.push(currentGroup);
    } else {
      // Add to existing group
      currentGroup.events.push(event);
    }
  }
  
  return groups;
};
```

### 4. DelegationBox Component

New component for displaying delegate thread events:

```typescript
// New file: src/ui/components/delegation-box.tsx
import React, { useState } from 'react';
import { ThreadEvent } from '../../threads/types';
import { TimelineDisplay } from './timeline-display';
import { DelegationFullscreen } from './delegation-fullscreen';

interface DelegationBoxProps {
  threadId: string;
  events: ThreadEvent[];
}

export const DelegationBox: React.FC<DelegationBoxProps> = ({ threadId, events }) => {
  const [expanded, setExpanded] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  
  // Determine delegation status
  const isComplete = isThreadComplete(events);
  const taskDescription = extractTaskFromEvents(events);
  const duration = calculateDuration(events);
  
  if (fullscreen) {
    return (
      <DelegationFullscreen 
        threadId={threadId}
        events={events}
        taskDescription={taskDescription}
        duration={duration}
        onClose={() => setFullscreen(false)}
      />
    );
  }
  
  return (
    <div className={`delegation-box ${isComplete ? 'complete' : 'working'}`}>
      <div className="delegation-header">
        <span className="delegation-icon">🤖</span>
        <span className="delegation-id">{threadId}</span>
        <span className="delegation-task">({taskDescription})</span>
        {isComplete ? (
          <span className="delegation-status complete">✅ Complete ({duration})</span>
        ) : (
          <span className="delegation-status working">⚡ Working... ({duration})</span>
        )}
        <div className="delegation-controls">
          <button onClick={() => setExpanded(!expanded)}>
            {expanded ? '▼ Collapse' : '▶ Expand'}
          </button>
          <button onClick={() => setFullscreen(true)}>⛶ Fullscreen</button>
        </div>
      </div>
      
      {expanded && (
        <div className="delegation-content">
          <TimelineDisplay events={events} compact={true} />
        </div>
      )}
    </div>
  );
};

// Helper functions
const isThreadComplete = (events: ThreadEvent[]): boolean => {
  // Check if last event indicates completion
  const lastEvent = events[events.length - 1];
  return lastEvent?.type === 'AGENT_MESSAGE' && 
         !events.some(e => e.type === 'TOOL_CALL' && !hasMatchingResult(e, events));
};

const extractTaskFromEvents = (events: ThreadEvent[]): string => {
  // Extract task description from first agent message or tool call
  const firstMessage = events.find(e => e.type === 'AGENT_MESSAGE');
  if (firstMessage && typeof firstMessage.data === 'string') {
    return firstMessage.data.slice(0, 50) + '...';
  }
  return 'Unknown Task';
};

const calculateDuration = (events: ThreadEvent[]): string => {
  if (events.length === 0) return '0s';
  const start = events[0].timestamp;
  const end = events[events.length - 1].timestamp;
  const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const hasMatchingResult = (toolCall: ThreadEvent, events: ThreadEvent[]): boolean => {
  // Check if tool call has matching result
  if (toolCall.type !== 'TOOL_CALL') return false;
  const callData = toolCall.data as any;
  return events.some(e => 
    e.type === 'TOOL_RESULT' && 
    (e.data as any).callId === callData.callId
  );
};
```

### 5. DelegationFullscreen Component

Fullscreen view for detailed delegation analysis:

```typescript
// New file: src/ui/components/delegation-fullscreen.tsx
import React from 'react';
import { ThreadEvent } from '../../threads/types';
import { TimelineDisplay } from './timeline-display';

interface DelegationFullscreenProps {
  threadId: string;
  events: ThreadEvent[];
  taskDescription: string;
  duration: string;
  onClose: () => void;
}

export const DelegationFullscreen: React.FC<DelegationFullscreenProps> = ({
  threadId,
  events,
  taskDescription,
  duration,
  onClose
}) => {
  return (
    <div className="fullscreen-overlay">
      <div className="fullscreen-header">
        <div className="fullscreen-title">
          <span className="delegation-icon">🤖</span>
          <h2>Delegated Conversation: {taskDescription}</h2>
        </div>
        <div className="fullscreen-meta">
          <span>Thread: {threadId}</span>
          <span>Duration: {duration}</span>
          <span>Events: {events.length}</span>
        </div>
        <button className="fullscreen-close" onClick={onClose}>✕</button>
      </div>
      <div className="fullscreen-content">
        <TimelineDisplay events={events} compact={false} />
      </div>
    </div>
  );
};
```

### 6. CSS Styling

Add delegation-specific styles:

```css
/* Add to src/ui/styles/delegation.css */
.delegation-box {
  border: 2px solid #3b82f6;
  border-radius: 8px;
  margin: 12px 0;
  background: #f8fafc;
  overflow: hidden;
}

.delegation-box.working {
  border-color: #eab308;
  background: #fffbeb;
}

.delegation-box.complete {
  border-color: #10b981;
  background: #f0fdf4;
}

.delegation-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: rgba(59, 130, 246, 0.1);
  border-bottom: 1px solid #e2e8f0;
  gap: 8px;
}

.delegation-icon {
  font-size: 18px;
}

.delegation-id {
  font-family: monospace;
  font-size: 12px;
  color: #6b7280;
}

.delegation-task {
  font-style: italic;
  color: #374151;
  flex-grow: 1;
}

.delegation-status {
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.delegation-status.complete {
  background: #dcfce7;
  color: #166534;
}

.delegation-status.working {
  background: #fef3c7;
  color: #92400e;
}

.delegation-controls {
  display: flex;
  gap: 8px;
}

.delegation-controls button {
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
}

.delegation-controls button:hover {
  background: #f3f4f6;
}

.delegation-content {
  max-height: 400px;
  overflow-y: auto;
  padding: 12px;
}

/* Fullscreen styles */
.fullscreen-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: white;
  z-index: 1000;
  display: flex;
  flex-direction: column;
}

.fullscreen-header {
  display: flex;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 2px solid #e2e8f0;
  background: #f8fafc;
}

.fullscreen-title {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-grow: 1;
}

.fullscreen-title h2 {
  margin: 0;
  font-size: 20px;
  color: #1f2937;
}

.fullscreen-meta {
  display: flex;
  gap: 16px;
  font-size: 14px;
  color: #6b7280;
}

.fullscreen-close {
  padding: 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
}

.fullscreen-close:hover {
  background: #f3f4f6;
}

.fullscreen-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
```

### 6. DelegateTool Enhancement

Update delegate tool to use hierarchical thread naming:

```typescript
// In src/tools/implementations/delegate.ts
class DelegateTool {
  async executeTool(input: DelegateInput): Promise<ToolResult> {
    // Create delegate thread with hierarchical naming
    const parentThreadId = this.threadManager.getCurrentThreadId();
    if (!parentThreadId) {
      throw new Error('No active thread for delegation');
    }
    
    const delegateThreadId = this.threadManager.generateDelegateThreadId(parentThreadId);
    
    // Create the delegate thread
    this.threadManager.createThread(delegateThreadId);
    
    // Store delegation metadata for better UX
    this.threadManager.addEvent(parentThreadId, 'LOCAL_SYSTEM_MESSAGE', 
      `Starting delegation: ${input.task} (Thread: ${delegateThreadId})`
    );
    
    // Create subagent with delegate thread
    const subagent = new Agent(
      this.agentProvider!,
      delegateThreadId, // Use hierarchical thread ID
      this.parentToolExecutor!,
      this.parentApprovalPolicy
    );
    
    // Rest of implementation unchanged
    // ...
  }
}
```

## UI Mockups

### State 1: Delegation in Progress
```
You: Please analyze the codebase structure

Main Agent: I'll delegate this to a code analysis specialist.

🔧 delegate
Task: Analyze codebase structure and patterns
Model: anthropic-sonnet

┌─ 🤖 delegate_abc123 (Code Analysis Agent) ─────────────────┐
│ Status: Working... ⚡ (23s elapsed)          [⛶ Fullscreen] │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Agent: I'll start by examining the project structure... │ │
│ │                                                         │ │
│ │ 🔧 bash: find . -name "*.ts" -type f | head -20       │ │
│ │ ✅ Found 47 TypeScript files                           │ │
│ │                                                         │ │
│ │ Agent: Now I'll analyze the main entry points...       │ │
│ │ ⚡ Typing...                                            │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                              [▼ Collapse] │
└─────────────────────────────────────────────────────────────┘

✅ Analysis complete. The codebase follows an event-sourcing...

Main Agent: Based on the analysis, I can see your codebase...
```

### State 2: Multiple Concurrent Delegations
```
Main Agent: I'll delegate both tasks in parallel.

┌─ 🤖 delegate_abc123 (Code Analysis) ✅ (2m 14s) ─[▶][⛶]─┐
│ Summary: Event-sourcing architecture analysis complete   │
└─────────────────────────────────────────────────────────────┘

┌─ 🤖 delegate_def456 (Documentation) ─────────────────────┐
│ Status: Working... ⚡ (45s elapsed)          [⛶ Fullscreen] │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Agent: I'll create comprehensive documentation...       │ │
│ │ 🔧 bash: grep -r "ABOUTME" src/                        │ │  
│ │ ⚡ Processing files...                                  │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### State 3: Collapsed Delegation
```
┌─ 🤖 delegate_abc123 ✅ (2m 14s) ─────────────[▶ Expand][⛶]─┐
│ Summary: Event-sourcing architecture with clean separation  │
│ between core logic and UI. Found 47 TypeScript files...    │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Core Functionality
1. Add `getMainAndDelegateEvents()` to ThreadManager
2. Update TerminalInterface to use multi-thread querying
3. Add basic thread grouping to ThreadProcessor
4. Create minimal DelegationBox component
5. Test with simple delegation scenarios

### Phase 2: UI Polish
1. Add CSS styling for delegation boxes
2. Implement expand/collapse functionality
3. Add status indicators and duration tracking
4. Test with multiple concurrent delegations

### Phase 3: Advanced Features
1. Implement fullscreen delegation view
2. Add delegation metadata extraction
3. Optimize performance for large delegation conversations
4. Add keyboard shortcuts for delegation navigation

## Testing Strategy

### Unit Tests
- ThreadManager multi-thread querying
- Event grouping logic
- Delegation status detection
- Duration calculation

### Integration Tests
- Full delegation workflow with UI
- Multiple concurrent delegations
- Thread creation and cleanup
- Event chronological ordering

### Manual Testing Scenarios
1. Simple delegation (single task)
2. Complex delegation (multiple tool calls)
3. Failed delegation (error handling)
4. Concurrent delegations
5. Nested delegations (future)

## Benefits

1. **Real-time Visibility**: Users see delegation progress immediately
2. **Context Preservation**: Main conversation remains accessible
3. **Flexible Interaction**: Expand/collapse/fullscreen as needed
4. **Clean Architecture**: Leverages existing event-sourcing design
5. **Performance**: Minimal overhead, efficient event processing
6. **Extensible**: Easy to add features like search, export, etc.

## Future Enhancements

1. **Delegation Search**: Search across delegate conversations
2. **Delegation Export**: Export delegation conversations separately
3. **Delegation Templates**: Pre-configured delegation patterns
4. **Delegation Analytics**: Performance metrics and insights
5. **Nested Delegations**: Delegates creating sub-delegates
6. **Delegation Branching**: Multiple solution paths

## Migration Plan

This implementation is fully backward compatible:
- Existing single-thread behavior unchanged
- New multi-thread functionality opt-in
- No breaking changes to event structure
- Gradual rollout possible

The plan provides immediate UX improvements while maintaining architectural consistency with the existing event-sourcing design.