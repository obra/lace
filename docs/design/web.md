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
- **Styling**: Tailwind CSS
- **Real-time**: Server-Sent Events (SSE)
- **Backend Integration**: Direct use of Lace Agent class
- **State Management**: Event sourcing with SSE updates

## API Design

### Session Management

**GET /api/sessions**
- List all active sessions
- Returns: `{ sessions: Session[] }`

**POST /api/sessions**
- Create new session
- Body: `{ name?: string }`
- Returns: `{ session: Session }`

**GET /api/sessions/{sessionId}**
- Get session details with agents
- Returns: `{ session: Session }`

### Agent Management

**POST /api/sessions/{sessionId}/agents**
- Spawn new agent within session
- Body: `{ name: string, provider?: string, model?: string }`
- Returns: `{ agent: Agent }`

**GET /api/sessions/{sessionId}/agents**
- List agents in session
- Returns: `{ agents: Agent[] }`

### Messaging

**POST /api/threads/{threadId}/message**
- Send message to specific agent
- Body: `{ message: string }`
- Returns: `{ status: 'accepted', threadId, messageId }`

### Event Streaming

**GET /api/sessions/{sessionId}/events/stream**
- SSE endpoint for real-time events
- Sends all events for agents within the session
- Event types include both persisted and UI-only events

### Tool Approvals

**POST /api/approvals/{requestId}**
- Submit approval decision for tool execution
- Body: `{ requestId: string, decision: ApprovalDecision, reason?: string }`
- Returns: `{ success: boolean }`

### Provider Discovery (Planned)

**GET /api/providers**
- List all providers with available models
- Returns: `{ providers: ProviderInfo[] }`

**GET /api/providers/{provider}/test**
- Test provider connectivity
- Returns: `{ success: boolean, message: string }`

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

3. **Web-Specific Types**
   - `Session` - Session metadata interface
   - `Agent` - Agent info with status
   - `SessionEvent` - Combined thread + UI events
   - API request/response interfaces

## Implementation Details

### SessionService

Central service managing sessions and agents:
- Wraps Agent class for web API usage
- Handles agent lifecycle and event routing
- Manages tool approval flow
- Maintains session/agent metadata (temporary)

### SSEManager

Manages Server-Sent Event connections:
- Session-scoped event broadcasting
- Connection lifecycle management
- Automatic reconnection handling

### ApprovalManager

Handles tool approval workflow:
- Tracks pending approval requests
- Manages session-wide approvals
- Implements timeout mechanism
- Routes decisions to agents

### Type Imports

Backend types imported via `lace-imports.ts`:
- Runtime imports from `dist/` directory
- Type-only imports from `src/` directory
- Constants imported from built code

## UI Components

### Core Components

1. **Session Manager**
   - Create/select sessions
   - Display session list
   - Show agent count

2. **Agent Spawner**
   - Agent naming
   - Provider/model selection
   - Spawn button with loading state

3. **Conversation Display**
   - Terminal-like message rendering
   - Tool execution visibility
   - Agent status indicators
   - Color-coded by message type

4. **Tool Approval Modal**
   - Risk level indicators
   - Tool metadata display
   - Parameter visualization
   - Keyboard shortcuts
   - Timeout countdown

### Design Patterns

1. **Real-time Updates**
   - SSE connection per session
   - Automatic UI updates on events
   - Connection status indicators

2. **Optimistic UI**
   - Immediate feedback on actions
   - Loading states during operations
   - Error recovery flows

3. **Terminal Aesthetic**
   - Dark theme with high contrast
   - Monospace fonts for code
   - Color-coded message types
   - Minimal, focused interface

## Current Limitations

### Metadata Persistence
- Thread type doesn't support metadata
- Session names stored in memory only
- Agent metadata not persisted
- Requires backend enhancement

### Fixed Configuration
- Provider lists hardcoded in UI
- No dynamic provider discovery yet
- Credentials via environment only
- No web-based configuration

### Single User
- No authentication system
- No session isolation
- No access control
- Development-focused

## Future Enhancements

### Near Term
1. **Provider Discovery API**
   - Dynamic model lists
   - Configuration status
   - Provider testing

2. **Metadata Persistence**
   - Add metadata to Thread type
   - Store session/agent names
   - Persist UI preferences

3. **Testing Coverage**
   - Unit tests for components
   - Integration tests for APIs
   - E2E test scenarios

### Long Term
1. **Multi-User Support**
   - Authentication system
   - Session ownership
   - Access control

2. **Dynamic Configuration**
   - Web-based credentials
   - Provider management
   - Model preferences

3. **Enhanced UI**
   - Code syntax highlighting
   - File preview
   - Image support
   - Markdown rendering

4. **Collaboration**
   - Shared sessions
   - Real-time cursors
   - Presence indicators

## Development Workflow

### Setup
```bash
cd packages/web
npm install
npm run dev
```

### Building
```bash
# Build Lace first
npm run build

# Then run web UI
cd packages/web
npm run dev
```

### Type Safety
- Always import types from backend
- Use branded types (ThreadId)
- Avoid type duplication
- Keep types co-located

### Event Handling
- Use EVENT_TYPES from backend
- Separate UI events clearly
- Handle all event types
- Log unknown events

### Testing
- Test with real Agent instances
- Verify SSE connections
- Check event ordering
- Test error scenarios

## Security Considerations

1. **Tool Approvals**
   - All tools require approval
   - Risk level assessment
   - Session-wide approval option
   - Timeout auto-deny

2. **Input Validation**
   - Validate thread ID formats
   - Sanitize user messages
   - Check request bodies
   - Handle malformed events

3. **Connection Security**
   - SSE connections authenticated
   - Session isolation enforced
   - No cross-session leakage
   - Graceful disconnection

## Performance Considerations

1. **Event Streaming**
   - One SSE per session (not per agent)
   - Event filtering by session
   - Efficient broadcast mechanism
   - Connection pooling

2. **State Management**
   - Event-based updates only
   - No polling mechanisms
   - Minimal re-renders
   - Efficient event processing

3. **Scalability**
   - Stateless API design
   - Session affinity not required
   - Horizontal scaling ready
   - Event store bottleneck

## Deployment

Currently development-only:
- Requires built Lace dist/
- Uses Next.js dev server
- Hot module reload support
- No production build yet

Future production needs:
- Static asset optimization
- API route caching
- CDN integration
- Load balancing