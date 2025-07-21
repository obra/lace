# Current Message Rendering System Analysis

**Date:** 2025-07-21  
**Purpose:** Document existing ConversationDisplay system before Phase 2 migration

## Architecture Overview

The current message rendering system centers around `ConversationDisplay.tsx` which processes and displays conversation events in a terminal-style interface.

## Event Types and Data Structures

From `packages/web/types/api.ts`, the system handles these event types:

### Core Message Events
- **USER_MESSAGE**: User input messages
  ```typescript
  data: { content: string; message?: string }
  ```
- **AGENT_MESSAGE**: Complete agent responses  
  ```typescript
  data: { content: string }
  ```
- **AGENT_TOKEN**: Real-time streaming tokens
  ```typescript
  data: { token: string }
  ```
- **AGENT_STREAMING**: Processed streaming state (synthetic)
  ```typescript
  data: { content: string }
  ```

### Tool Interaction Events
- **TOOL_CALL**: Tool invocations
  ```typescript
  data: { toolName: string; input: unknown }
  ```
- **TOOL_RESULT**: Tool execution results
  ```typescript
  data: { toolName: string; result: unknown }
  ```

### Status Events
- **THINKING**: Agent processing indicators
  ```typescript
  data: { status: 'start' | 'complete' }
  ```
- **LOCAL_SYSTEM_MESSAGE**: UI system notifications
  ```typescript
  data: { message: string }
  ```

## Event Processing Logic

### Stream Token Merging (`ConversationDisplay.tsx` lines 40-86)

**Key Algorithm:**
1. **Accumulation**: AGENT_TOKEN events are collected into a Map keyed by `${threadId}-streaming`
2. **Memory Management**: Limits to 100 concurrent streaming messages to prevent unbounded growth
3. **Completion**: AGENT_MESSAGE events trigger removal of accumulated streaming content
4. **Synthetic Events**: Remaining streaming content becomes AGENT_STREAMING events for display

**Critical Implementation Details:**
- Uses Map for O(1) lookups and insertions
- LRU-style eviction when limit exceeded
- Thread-aware accumulation (multiple agents can stream simultaneously)

### Agent Filtering (`ConversationDisplay.tsx` lines 24-37)

**Filter Logic:**
- If `selectedAgent` is null, show all events
- If `selectedAgent` is set:
  - Include USER_MESSAGE events directed to selected agent (`event.threadId === selectedAgent`)
  - Include all other events from selected agent (`event.threadId === selectedAgent`)

## Current Visual Design

### Styling Patterns
- **Terminal aesthetic**: Monospace fonts, timestamps, structured layout
- **Color coding**:
  - Users: Blue (`text-blue-400`)
  - Agents: Green (`text-green-400`) 
  - Tools: Yellow (`text-yellow-400`) and Cyan (`text-cyan-400`)
  - System: Gray (`text-gray-400`)
- **Icons**: Emoji-based (👤 users, 🤖 agents, 🔧 tools, ✅ results)

### Layout Structure
- **Timestamps**: Small gray text `[HH:MM:SS]` format
- **Message bubbles**: Flex layout with icon + content
- **Tool indentation**: Tool calls/results indented with `ml-8`
- **Code blocks**: Gray background for tool parameters and results
- **Streaming indicator**: Animated cursor `▌` with pulse animation

## Component Interface

**Props Structure:**
```typescript
interface ConversationDisplayProps {
  events: SessionEvent[];
  agents?: Agent[];
  selectedAgent?: ThreadId;
  className?: string;
  isLoading?: boolean;
}
```

**Usage Pattern** (from `app/page.tsx`):
```typescript
<ConversationDisplay
  events={events}
  agents={selectedSessionDetails?.agents || []}
  selectedAgent={selectedAgent as ThreadId}
  className="h-full p-4"
  isLoading={loading}
/>
```

## Performance Considerations

### Current Optimizations
- **useMemo**: Event filtering and processing memoized by dependencies
- **useCallback**: Event rendering and agent name lookup callbacks memoized
- **Memory bounds**: Streaming message accumulation limited to prevent leaks

### Potential Issues
- **Large conversation history**: No virtualization for long conversations
- **Re-processing**: Full event processing on every render when events change
- **Agent lookup**: O(n) agent name resolution per event

## State Management

### Loading States
- **Skeleton component**: Animated placeholder for loading state
- **Empty state**: Centered message when no events exist
- **Loading prop**: Controls skeleton vs content display

### Error Handling
- **Unknown events**: Fallback renderer shows raw event data
- **Malformed data**: Graceful degradation with JSON.stringify
- **Connection issues**: LOCAL_SYSTEM_MESSAGE events for connection status

## Integration Points

### Real-time Updates
- **SSE Integration**: Events arrive via Server-Sent Events from `/api/sessions/{id}/events/stream`
- **Event accumulation**: New events appended to existing array
- **Auto-scroll**: Component scrolls to show latest messages

### Agent Management
- **Agent lookup**: Uses provided agents array for name resolution
- **Fallback naming**: Falls back to ThreadId parsing when agent not found
- **Multi-agent support**: Handles multiple concurrent agents per session

## Migration Considerations

### Preserved Functionality
- ✅ Real-time streaming token display
- ✅ Agent filtering by selection  
- ✅ Tool call/result formatting
- ✅ Thinking indicators
- ✅ Loading and empty states

### Enhancement Opportunities
- 🔄 Responsive design for mobile
- 🔄 Better typography and spacing
- 🔄 Message actions (copy, quote)
- 🔄 Performance optimization with virtualization
- 🔄 Accessibility improvements
- 🔄 Message grouping and threading

## Files Modified/Analyzed
- `packages/web/components/old/ConversationDisplay.tsx` - Core implementation
- `packages/web/types/api.ts` - Event type definitions
- `packages/web/app/page.tsx` - Usage integration