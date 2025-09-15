# Web Interface Design Document

> **⚠️ Note**: This document contains outdated information. For current web interface architecture, see [CLAUDE.md](../../CLAUDE.md).

## Overview

The Lace web interface provides a browser-based UI for interacting with AI agents. It's built on React Router v7 with React 18.3, using Server-Sent Events (SSE) for real-time communication and a clean REST API for agent management.

## Architecture Principles

### Core Concepts

1. **Sessions as Parent Threads**
   - Sessions are top-level containers for agents (maps to parent thread)
   - Session ID format: `lace_YYYYMMDD_xxxxxx`
   - Sessions group related agents and conversations

2. **Agents as Child Threads**
   - Agents exist within sessions (maps to child threads)
   - Agent thread ID format: `{sessionId}.{n}` (e.g., `lace_20250714_abc123.1`)
   - Each agent has its own conversation history and state

3. **Event-Driven Architecture**
   - All state changes flow through immutable events
   - Events are the single source of truth
   - UI reconstructs state from event streams

4. **Real-Time Communication**
   - Session-scoped SSE streams for event delivery
   - One persistent connection per session
   - Events automatically routed to correct session

### Technology Stack

- **Frontend**: React Router v7, React 18.3, TypeScript
- **Styling**: Tailwind CSS with DaisyUI component library
- **Real-time**: Server-Sent Events (SSE) via EventStreamManager
- **Markdown**: react-markdown with remark-gfm and rehype-highlight
- **Security**: DOMPurify for content sanitization
- **Backend Integration**: @lace/core workspace package
- **State Management**: Event sourcing with SSE updates
- **Testing**: Vitest with React Testing Library and Playwright

## Project Structure

> **📁 Current Structure**: See the actual file structure in `packages/web/` - this document's structure is outdated.

Key directories in the actual implementation:
- `app/routes/` - React Router v7 file-based routing
- `components/` - React components organized by feature
- `lib/` - Utilities including api-client.ts and event-stream-manager.ts
- `hooks/` - Custom React hooks
- `types/` - TypeScript type definitions

## API Design

> **🚨 Outdated**: The API structure described below is incorrect. The actual API uses a **Project → Session → Task/Agent hierarchy**.

**Current API Routes** (see `app/routes.ts` for complete list):
- `/api/projects/:projectId/sessions/:sessionId/tasks` - Task CRUD operations
- `/api/agents/:agentId/message` - Agent messaging
- `/api/threads/:threadId/approvals` - Tool approvals
- `/api/events/stream` - Global SSE event stream
- `/api/mcp/servers` - MCP server management

**For accurate API documentation**, see the route implementations in `packages/web/app/routes/`.

### Messaging

**POST /api/agents/{agentId}/message**
- Send message to specific agent
- Body: `{ message: string }`
- Returns: `{ success: boolean }`

**POST /api/threads/{threadId}/message**
- Send message to thread
- Body: `{ message: string }`

### Event Streaming

**GET /api/events/stream**
- Global SSE endpoint for all real-time events
- "Firehose" pattern - sends all events, client-side filtering
- Managed by EventStreamManager singleton
- LaceEvent format with context hierarchy

### Tool Approvals

**GET /api/threads/{threadId}/approvals/pending**
- Get pending approvals for thread

**POST /api/threads/{threadId}/approvals/{toolCallId}**
- Submit approval decision for specific tool call
- Body: `{ decision: ApprovalDecision, reason?: string }`

### Provider Discovery

**GET /api/provider/catalog**
- List all provider catalogs with models

**GET /api/provider/instances**
- List configured provider instances

## Event System

### Event Categories

1. **Persisted Thread Events** (stored in database)
   - `USER_MESSAGE` - User input
   - `AGENT_MESSAGE` - Agent response
   - `TOOL_CALL` - Tool execution request
   - `TOOL_RESULT` - Tool execution result
   - `LOCAL_SYSTEM_MESSAGE` - System notifications
   - `SYSTEM_PROMPT` - System prompt configuration
   - `USER_SYSTEM_PROMPT` - User instructions

2. **UI-Only Events** (ephemeral, not persisted)
   - `THINKING` - Agent processing state
   - `TOOL_APPROVAL_REQUEST` - Interactive approval flow

### Event Flow

```
User Input → POST /api/threads/{threadId}/message
    ↓
Agent processes → Emits events → SSE stream
    ↓
Browser receives events → Updates UI in real-time
```

## Server-Sent Events (SSE) Architecture

### Overview

Lace uses a sophisticated SSE system for real-time communication between the backend and web UI. The architecture follows a **firehose pattern** with client-side filtering, providing scalable real-time updates while maintaining clean separation of concerns.

### SSE Event Flow

```
Backend Event Source → EventStreamManager → SSE Stream → EventStreamProvider → React Components
```

### Core Components

#### 1. EventStreamManager (Backend)
**Location**: `packages/web/lib/event-stream-manager.ts`

- **Global singleton** managing all SSE connections
- **Firehose approach**: Broadcasts all events, client-side filtering handles specificity  
- **Connection management**: Tracks client connections with subscription filters
- **Event broadcasting**: Converts internal events to LaceEvent format

```typescript
class EventStreamManager {
  // Global event broadcasting
  broadcast(event: LaceEvent): void;
  
  // Connection lifecycle
  addConnection(controller: ReadableStreamDefaultController, subscription): string;
  removeConnection(connectionId: string): void;
  
  // Session registration for auto-forwarding events
  registerSession(session: Session): void;
}
```

**Key Features**:
- **Automatic session registration**: Session instances register to forward TaskManager events
- **Agent error handling**: Registers error listeners for all agents in registered sessions
- **Connection limits**: 100 connections globally, automatic cleanup in development
- **Keepalive**: 30-second heartbeat to maintain connections

#### 2. SSE HTTP Endpoint
**Location**: `packages/web/app/routes/api.events.stream.ts`

- **Single global endpoint**: `/api/events/stream` 
- **No filtering**: Sends ALL events, client-side filtering provides specificity
- **Persistent connection**: Uses ReadableStream for long-lived connections
- **Proper headers**: SSE-compliant headers with CORS support

```typescript
export async function loader({ request }: Route.LoaderArgs) {
  const manager = EventStreamManager.getInstance();
  
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const connectionId = manager.addConnection(controller, {});
      request.signal?.addEventListener('abort', () => {
        manager.removeConnection(connectionId);
      });
    }
  });
  
  return new Response(stream, { /* SSE headers */ });
}
```

#### 3. EventStreamProvider (Frontend)
**Location**: `packages/web/components/providers/EventStreamProvider.tsx`

- **React context provider** wrapping UI components
- **Manages event stream connection** using `useEventStream` hook
- **Provides local event management** via `useAgentEvents` hook  
- **Combines multiple event sources** into unified interface

```typescript
interface EventStreamContextType {
  eventStream: EventStreamConnection;    // SSE connection status
  agentEvents: AgentEventsState;        // Local event array
  streamingContent: string;             // Real-time content
  compactionState: CompactionState;     // UI state
  agentAPI: AgentAPIActions;           // Agent management
}

export function useEventStreamContext(): EventStreamContextType;
```

**Provider Architecture**:
```tsx
<EventStreamProvider projectId={projectId} sessionId={sessionId} agentId={agentId}>
  <AgentPageContent /> {/* Can access events via useEventStreamContext() */}
</EventStreamProvider>
```

#### 4. Component Integration Pattern

**❌ WRONG: Creating New Subscriptions**
```typescript
// Don't do this - creates duplicate SSE connections
const { events } = useEventStream({ threadIds: [agentId] });
```

**✅ CORRECT: Using Existing Context**
```typescript
// Use existing EventStreamProvider context
const { agentEvents } = useEventStreamContext();

useEffect(() => {
  agentEvents.events.forEach(event => {
    if (event.type === 'AGENT_SUMMARY_UPDATED') {
      // Handle event
    }
  });
}, [agentEvents.events]);
```

### Event Broadcasting Integration

#### Message Endpoint Integration
**Location**: `packages/web/app/routes/api.agents.$agentId.message.ts`

```typescript
// After user message received, before agent.sendMessage()
void (async () => {
  try {
    const summary = await generateAgentSummary(agent, userMessage, lastResponse);
    
    // Broadcast via EventStreamManager
    const eventStreamManager = EventStreamManager.getInstance();
    eventStreamManager.broadcast({
      type: 'AGENT_SUMMARY_UPDATED',
      threadId: agentId,
      data: { summary, agentThreadId: agentId, timestamp: new Date() },
      transient: true,
      context: { projectId, sessionId, agentId },
    });
  } catch (error) {
    logger.error('Agent summary failed', { error });
  }
})();
```

#### Session Helper Integration
**Location**: `packages/web/lib/server/agent-summary-helper.ts`

```typescript
export async function generateAgentSummary(
  agent: Agent,
  userMessage: string,
  lastAgentResponse?: string
): Promise<string> {
  // Uses SessionHelper with 'fast' model tier
  const helper = new SessionHelper({
    model: 'fast',
    parentAgent: agent,
  });
  
  const result = await helper.execute(summaryPrompt);
  return result.success ? result.response.trim() : 'Processing your request';
}
```

### Event Types and Data Structures

#### Agent Summary Events
```typescript
export interface AgentSummaryUpdatedData {
  summary: string;
  agentThreadId: ThreadId;
  timestamp: Date;
}

// Event structure
{
  type: 'AGENT_SUMMARY_UPDATED',
  threadId: string,
  data: AgentSummaryUpdatedData,
  transient: true,  // Not persisted to database
  context: { projectId, sessionId, agentId }
}
```

#### Event Registration
- **Transient events**: Added to `isTransientEventType()` - not persisted to database
- **Type safety**: Added to LaceEvent union type with discriminated unions
- **Database handling**: Explicit rejection in database serialization with helpful error messages

### Connection Management

#### Connection Lifecycle
1. **EventStreamProvider mounts** → Creates SSE connection to `/api/events/stream`
2. **Backend registers session** → EventStreamManager.registerSession() sets up auto-forwarding
3. **Events occur** → Broadcast via EventStreamManager.broadcast()
4. **Frontend receives events** → EventStreamProvider updates local state
5. **Components consume events** → Via useEventStreamContext() hook

#### Error Handling
- **Connection failures**: Automatic reconnection with exponential backoff
- **Event parsing errors**: Graceful handling with logging
- **Component errors**: Error boundaries prevent SSE connection loss
- **Memory management**: Automatic cleanup on unmount

#### Performance Considerations
- **Single connection per session**: No duplicate connections
- **Client-side filtering**: Server sends all events, client filters by relevance
- **Event batching**: Natural SSE batching for high-frequency events
- **Memory management**: Event arrays managed by providers, automatic cleanup

### Best Practices

#### For Component Authors
1. **Use existing context**: Always use `useEventStreamContext()` instead of `useEventStream()`
2. **Filter in components**: Handle event filtering in useEffect, not at connection level
3. **Handle missing data**: Events may have different data structures depending on type
4. **Performance**: Use dependency arrays properly in useEffect for event handling

#### For Backend Integration
1. **Use EventStreamManager.broadcast()**: Don't create custom SSE endpoints
2. **Register sessions**: Call `eventStreamManager.registerSession(session)` for auto-forwarding
3. **Proper event structure**: Follow LaceEvent interface with required fields
4. **Transient vs persisted**: Mark UI-only events as `transient: true`

#### Common Pitfalls
- **Multiple subscriptions**: Components should NOT call useEventStream() if wrapped in EventStreamProvider
- **Event data assumptions**: Always check event.data structure - different event types have different shapes
- **Memory leaks**: EventStreamProvider handles cleanup automatically, don't manage connections manually
- **Error handling**: Handle both connection errors and event processing errors separately

### Integration Examples

#### Real-Time Agent Summaries
```typescript
// In AgentPageContent component
const { agentEvents } = useEventStreamContext();

useEffect(() => {
  agentEvents.events.forEach(event => {
    if (
      event.type === 'AGENT_SUMMARY_UPDATED' && 
      event.data?.agentThreadId === agentId
    ) {
      setAgentSummary(event.data.summary);
    }
  });
}, [agentEvents.events, agentId]);
```

#### Tool Approval Notifications  
```typescript
// ToolApprovalProvider handles TOOL_APPROVAL_REQUEST events automatically
// Components get pendingApprovals via useToolApprovalContext()
```

#### Agent State Updates
```typescript
// EventStreamProvider forwards AGENT_STATE_CHANGE events
// Components can listen via onAgentStateChange prop or context
```

### Event Type Management

Event types are centrally managed through:
- `EVENT_TYPES` array from backend (persisted events)
- `UI_EVENT_TYPES` array in web (UI-only events)
- `getAllEventTypes()` helper combines both
- Type-safe event discrimination

## Type System

### Shared Type Strategy

1. **Import from Backend**
   - Core types imported from Lace source
   - Prevents duplication and drift
   - Single source of truth

2. **Key Imported Types**
   - `ThreadId` - Branded string type for thread IDs
   - `EventType` - Event type union from `EVENT_TYPES` array
   - `AgentState` - Agent state machine states
   - `ApprovalDecision` - Tool approval enum
   - `ToolAnnotations` - Tool metadata
   - `ProviderInfo` / `ModelInfo` - Provider metadata

3. **Web-Specific Types**
   - `Session` - Session metadata interface
   - `Agent` - Agent info with status
   - `SessionEvent` - Combined thread + UI events
   - API request/response interfaces

### Type Import Pattern

```typescript
// Runtime imports from dist/
export { Agent } from '../../../../dist/agents/agent.js';

// Type-only imports from src/
export type { ThreadId } from '../../../../src/types/threads';

// Constants from built code
export { EVENT_TYPES } from '../../../../dist/threads/types.js';
```

## Implementation Details

### Core Services

**EventStreamManager** (`lib/event-stream-manager.ts`):
- Global singleton managing all SSE connections
- "Firehose" pattern - broadcasts all events, client-side filtering
- Registers Session instances to forward TaskManager events
- Handles agent error forwarding and connection lifecycle

**API Client** (`lib/api-client.ts`):
- Centralized HTTP client with structured error handling
- Retry logic and timeout support
- SuperJSON serialization for type safety
- Used by all frontend components for API calls

### Event Streaming Implementation

The actual implementation uses EventStreamManager:
- **Global singleton** - single instance handles all connections
- **Firehose pattern** - all events sent to all connections, client filters
- **Session registration** - Sessions register to forward TaskManager events
- **LaceEvent format** - standardized event structure with context hierarchy

See `packages/web/lib/event-stream-manager.ts` for implementation details.

### ApprovalManager

Handles tool approval workflow:
- Tracks pending approval requests
- Manages session-wide approvals
- Implements 30-second timeout
- Routes decisions to agents
- Risk level assessment

### Provider Integration

Dynamic provider/model discovery:
- `ProviderRegistry.getAvailableProviders()`
- Each provider implements metadata methods
- Configuration status checking
- Model capability reporting

## UI Components

### Core Components

1. **Session Manager**
   - Create/select sessions
   - Display session list
   - Show agent count
   - Real-time status updates

2. **AgentSpawner**
   - Dynamic provider/model dropdown
   - Fetches available models from API
   - Shows configuration status
   - Handles unconfigured providers gracefully

3. **ConversationDisplay**
   - Terminal-like message rendering
   - Tool execution visibility
   - Agent status indicators
   - Color-coded by message type
   - Timeline-based event rendering

4. **ToolApprovalModal**
   - Risk level indicators (safe/moderate/destructive)
   - Tool metadata display
   - Parameter JSON visualization
   - Keyboard shortcuts (Y/A/S/N/D/ESC)
   - 30-second timeout countdown
   - Session-wide approval option

### Timeline System

The web UI uses a timeline-based approach for rendering conversation events:

1. **Timeline Architecture**
   - Events flow from backend → timeline converter → timeline renderers
   - Discriminated union pattern for type-safe event handling
   - Each event type has a dedicated renderer component

2. **Timeline Components**
   - Follow `*Entry.tsx` naming convention
   - Use FontAwesome icons for visual identity
   - Consistent DaisyUI styling and layout patterns
   - Support for content folding/truncation

3. **Event Type Mapping**
   ```typescript
   // Backend events → Timeline entries
   SYSTEM_PROMPT → 'system-prompt' → SystemPromptEntry
   USER_SYSTEM_PROMPT → 'user-system-prompt' → UserSystemPromptEntry
   USER_MESSAGE → 'user-message' → UserMessageEntry
   AGENT_MESSAGE → 'agent-message' → AgentMessageEntry
   ```

4. **Markdown Rendering**
   - `MarkdownRenderer` component with security and performance optimizations
   - Uses `react-markdown` with `remark-gfm` and `rehype-highlight`
   - Automatic syntax highlighting for code blocks
   - DOMPurify sanitization for security defense-in-depth
   - Folding functionality for long content (4-line default)

5. **Folding Pattern**
   - Consistent 4-line truncation across components
   - `useFoldableContent` hook for reusable folding logic
   - Performance optimized with memoized calculations
   - Recent messages always expanded, older messages folded

### Custom Hooks

1. **useSSEStream**
   - Manages SSE connection lifecycle
   - Handles reconnection logic
   - Parses and routes events
   - Connection status tracking

2. **useSessionAPI**
   - Wraps all API calls
   - Loading/error state management
   - Type-safe request/response handling
   - Optimistic updates

3. **useFoldableContent**
   - Reusable content folding logic
   - Memoized truncation calculations
   - State management for expand/collapse
   - Consistent behavior across timeline components

## Testing Strategy

### Test Coverage

1. **API Route Tests** (100% coverage)
   - All endpoints have comprehensive tests
   - Mock service layer dependencies
   - Test error scenarios
   - Validate response formats

2. **Hook Tests**
   - `useSSEStream` - Connection management
   - `useSessionAPI` - API client behavior
   - Mock EventSource and fetch
   - Test state transitions

3. **Integration Tests**
   - Full conversation flow
   - Multi-agent scenarios
   - Session isolation
   - Event ordering

### Test Environment

- Vitest with environment-specific config
- `jsdom` for React components/hooks
- `node` for API routes
- Mock implementations for Agent class
- Type-safe test utilities

## Current State (January 2025)

### What's Working

1. **Complete API Implementation**
   - All endpoints functional
   - Real Agent integration
   - SSE event streaming
   - Tool approval system

2. **Full Web UI**
   - Session management
   - Agent spawning with dynamic models
   - Real-time conversation display
   - Interactive tool approvals

3. **Provider Discovery**
   - Dynamic model listing
   - Configuration status
   - Support for all providers

4. **Comprehensive Testing**
   - 67 tests passing
   - API routes fully tested
   - React hooks tested
   - Integration test coverage

### Known Limitations

1. **Metadata Persistence**
   - Session/agent names in memory only
   - Lost on server restart
   - Needs ThreadManager enhancement

2. **Development Only**
   - No production build config
   - No authentication
   - Single-user focused

3. **UI Polish**
   - Basic styling only
   - Limited error handling UI

## Development Workflow

### Setup
```bash
# From repository root
npm install
npm run build

# Run web interface
npm run web:dev
```

### Environment Variables
```bash
# Required for providers
ANTHROPIC_API_KEY=your-key
OPENAI_API_KEY=your-key

# Optional
LACE_DIR=/path/to/data
```

### Running Tests
```bash
cd packages/web
npm test              # Watch mode
npm test -- --run     # Single run
```

### Common Tasks

**Adding a New API Endpoint:**
1. Create route in `app/api/`
2. Add types to `types/api.ts`
3. Write tests first
4. Implement handler
5. Update route registration in routes.ts if needed

**Adding UI Components:**
1. Create component in `components/`
2. Use existing hooks for API calls
3. Follow terminal aesthetic
4. Add to main page.tsx

**Updating Provider Models:**
1. Update provider's `getAvailableModels()`
2. No UI changes needed
3. Models appear automatically

## Best Practices

### Type Safety
- Always import types from backend
- Use branded types (ThreadId)
- Avoid type duplication
- Validate at boundaries

### Event Handling
- Use EVENT_TYPES constants
- Handle all event types
- Log unknown events
- Maintain event ordering

### Error Handling
- Graceful degradation
- User-friendly messages
- Retry mechanisms
- Timeout handling

### Performance
- Minimize re-renders
- Use React.memo where appropriate
- Batch API calls
- Efficient event processing

## Security Considerations

1. **Tool Approvals**
   - All tools require explicit approval
   - Risk level assessment and display
   - Session-wide approval policies
   - 30-second timeout auto-deny

2. **Input Validation**
   - ThreadId format validation
   - Message content sanitization
   - Request body validation
   - Event payload verification

3. **Connection Security**
   - Session-scoped SSE streams
   - No cross-session event leakage
   - Graceful disconnection handling
   - Connection limit per session

## Future Enhancements

### Near Term
1. **Metadata Persistence**
   - Extend Thread type with metadata
   - Persist session/agent names
   - Store UI preferences

2. **Production Build**
   - Optimize for deployment
   - Environment configuration
   - Error tracking

3. **UI Improvements**
   - Syntax highlighting
   - Better error display
   - Loading skeletons

### Long Term
1. **Multi-User Support**
   - Authentication system
   - Session ownership
   - Access control
   - User preferences

2. **Enhanced Features**
   - File preview/editing
   - Image display
   - Code diff visualization
   - Export conversations

3. **Collaboration**
   - Shared sessions
   - Real-time presence
   - Commenting system

## Component Architecture Patterns

### Timeline Component Design

Timeline components follow consistent patterns for maintainability and user experience:

1. **Naming Convention**
   - Components named `*Entry.tsx` (e.g., `SystemPromptEntry`, `UserMessageEntry`)
   - Exported function matches filename without `.tsx`

2. **Props Interface**
   ```typescript
   interface ComponentEntryProps {
     content: string;
     timestamp: Date;
     isRecentMessage?: boolean;
     // Additional props specific to component
   }
   ```

3. **Layout Structure**
   ```tsx
   <div className="flex gap-3">
     <Icon /> {/* 8x8 icon in rounded background */}
     <div className="flex-1 min-w-0">
       <Header />
       <Content />
     </div>
   </div>
   ```

4. **Icon Standards**
   - FontAwesome icons from `@/lib/fontawesome`
   - Consistent 8x8 pixel size with rounded background
   - Semantic colors (warning for unknown, primary for system, etc.)

5. **Content Handling**
   - Use `MarkdownRenderer` for rich text content
   - Apply folding pattern with `useFoldableContent`
   - Consistent 4-line truncation across components

### Reusable Component Patterns

1. **MarkdownRenderer Usage**
   ```tsx
   <MarkdownRenderer 
     content={content} 
     maxLines={4} 
     isRecentMessage={isRecentMessage} 
   />
   ```

2. **Folding Hook Pattern**
   ```tsx
   const { displayContent, shouldFold, isExpanded, toggleExpanded, remainingLines } = 
     useFoldableContent(content, maxLines, isRecentMessage);
   ```

3. **DaisyUI Styling Conventions**
   - Use `bg-base-100`, `text-base-content` for theme compatibility
   - `border-base-300` for subtle borders
   - `text-primary` for interactive elements
   - `badge-ghost` for subtle labels

### Type Safety Patterns

1. **Discriminated Unions**
   ```typescript
   type TimelineEntry = 
     | { type: 'system-prompt'; content: string; timestamp: Date }
     | { type: 'user-message'; content: string; timestamp: Date }
     | { type: 'agent-message'; content: string; timestamp: Date };
   ```

2. **Event Type Mapping**
   - Backend `EventType` → Frontend timeline entry type
   - Centralized in `timeline-converter.ts`
   - Type-safe exhaustive switching

3. **Branded Types**
   - Import `ThreadId` from backend for type safety
   - Prevents mixing regular strings with thread identifiers

## Migration Notes

### From src/interfaces/web to packages/web
- Moved to monorepo structure
- Updated all import paths
- Fixed @ alias configuration
- Preserved all functionality

### Key Changes in Implementation
1. Real Agent usage from start
2. Dynamic provider discovery
3. Comprehensive test coverage
4. Tool approval system
5. Type imports from backend

## Troubleshooting

### Common Issues

**"Cannot find module" errors:**
- Ensure `npm run build` in root
- Check import paths
- Verify @ alias in tsconfig

**SSE Connection Issues:**
- Check session ID format
- Verify agent is started
- Look for event handler setup

**Type Errors:**
- Import types from backend
- Don't duplicate type definitions
- Use type assertions sparingly

**Test Failures:**
- Run `npm run build` first
- Check mock implementations
- Verify environment setup