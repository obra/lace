# Web Interface Design Document

## Overview

The Lace web interface provides a browser-based UI for interacting with AI agents. It's built on Next.js 15 with React 19, using Server-Sent Events (SSE) for real-time communication and a clean REST API for agent management.

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

- **Frontend**: Next.js 15, React 19, TypeScript
- **Styling**: Tailwind CSS with DaisyUI component library
- **Real-time**: Server-Sent Events (SSE)
- **Markdown**: react-markdown with remark-gfm and rehype-highlight
- **Security**: DOMPurify for content sanitization
- **Backend Integration**: Direct use of Lace Agent class
- **State Management**: Event sourcing with SSE updates
- **Testing**: Vitest with React Testing Library

## Project Structure

```
packages/web/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   ├── sessions/      # Session management
│   │   ├── threads/       # Message handling
│   │   ├── providers/     # Provider discovery
│   │   └── approvals/     # Tool approvals
│   ├── page.tsx           # Main UI page
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── timeline/          # Timeline event renderers
│   │   ├── SystemPromptEntry.tsx
│   │   ├── UserSystemPromptEntry.tsx
│   │   ├── UnknownEventEntry.tsx
│   │   └── TimelineMessage.tsx
│   ├── ui/               # Reusable UI components
│   │   └── MarkdownRenderer.tsx
│   ├── AgentSpawner.tsx  # Dynamic agent creation
│   ├── ConversationDisplay.tsx
│   └── ToolApprovalModal.tsx
├── hooks/                 # Custom React hooks
│   ├── useSSEStream.ts   # SSE connection management
│   ├── useSessionAPI.ts  # API client hooks
│   └── useFoldableContent.ts # Content folding logic
├── lib/                   # Utilities
│   ├── server/           # Server-only code
│   │   ├── session-service.ts
│   │   ├── approval-manager.ts
│   │   └── lace-imports.ts
│   ├── sse-manager.ts    # SSE broadcasting
│   └── timeline-converter.ts # Event → timeline mapping
└── types/                 # TypeScript types
    ├── api.ts            # API interfaces
    ├── events.ts         # Event type mappings
    └── web-events.ts     # Timeline entry types
```

## API Design

### Session Management

**GET /api/sessions**
- List all active sessions
- Returns: `{ sessions: Session[] }`

**POST /api/sessions**
- Create new session
- Body: `{ name?: string }`
- Returns: `{ session: Session }`
- Creates parent thread with default agent

**GET /api/sessions/{sessionId}**
- Get session details with agents
- Returns: `{ session: Session }`

### Agent Management

**POST /api/sessions/{sessionId}/agents**
- Spawn new agent within session
- Body: `{ name: string, provider?: string, model?: string }`
- Returns: `{ agent: Agent }`
- Creates delegate agent with incremented thread ID

**GET /api/sessions/{sessionId}/agents**
- List agents in session
- Returns: `{ agents: Agent[] }`

### Messaging

**POST /api/threads/{threadId}/message**
- Send message to specific agent
- Body: `{ message: string }`
- Returns: `{ status: 'accepted', threadId, messageId }`
- Validates thread ID format
- Emits USER_MESSAGE event via SSE

### Event Streaming

**GET /api/sessions/{sessionId}/events/stream**
- SSE endpoint for real-time events
- Sends all events for agents within the session
- Event types include both persisted and UI-only events
- Automatic reconnection support

### Tool Approvals

**POST /api/approvals/{requestId}**
- Submit approval decision for tool execution
- Body: `{ requestId: string, decision: ApprovalDecision, reason?: string }`
- Returns: `{ success: boolean }`
- Supports session-wide approval policies

### Provider Discovery

**GET /api/providers**
- List all providers with available models
- Returns: `{ providers: ProviderWithModels[] }`
- Includes configuration status
- Dynamic model discovery for local providers

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

### SessionService

Central service managing sessions and agents:
- Wraps Agent class for web API usage
- Handles agent lifecycle and event routing
- Manages tool approval flow
- Maintains session/agent metadata (in-memory)
- Creates delegates via `session.spawnAgent()`

Key responsibilities:
- Thread ID generation and management
- Provider instantiation with credentials
- Event handler setup for SSE broadcasting
- Agent state tracking

### SSEManager

Manages Server-Sent Event connections:
- Session-scoped event broadcasting
- Connection lifecycle management
- Automatic reconnection handling
- Event type registration

Implementation:
```typescript
class SSEManager {
  private sessionStreams = new Map<string, Set<ReadableStreamDefaultController>>();
  
  broadcast(sessionId: string, event: SessionEvent): void {
    // Send to all connections for session
  }
}
```

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
5. Update SessionService if needed

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