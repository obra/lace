# Next.js UI Implementation Plan

## Current Status (Updated 2025-01-14)

**Phase 5 Complete**: Provider/Model Discovery API has been fully implemented.

### What's Working:
- ✅ All API endpoints (sessions, agents, messaging, SSE streaming)
- ✅ Real Agent integration with proper event forwarding
- ✅ Full web UI with session management and agent spawning
- ✅ Real-time conversation display via SSE
- ✅ Tool approval system with interactive modals
- ✅ Provider/Model Discovery API with dynamic listing
- ✅ Frontend integration showing all available models
- ✅ Configuration status indicators for providers

### Recent Changes:
1. **Provider Discovery API** - GET /api/providers endpoint returns all providers and their models
2. **Backend Provider Updates** - All providers now implement metadata methods
3. **Frontend Integration** - AgentSpawner dynamically loads available models
4. **Type System Improvements** - Proper separation of UI and backend event types
5. **Test Infrastructure** - Fixed all test failures related to provider changes

### Known Issues:
- Web package tests missing mock infrastructure (pre-existing issue)
- Session metadata (names) stored in memory only (needs backend persistence)
- Some Next.js 15 deprecation warnings

### Test Infrastructure Updates:
1. **Created BaseMockProvider** - Base class for test providers that implements required metadata methods
2. **Updated 24 test files** - All mock providers now extend BaseMockProvider
3. **Fixed vitest configuration** - Added @ alias for web package imports
4. **Fixed mock implementations** - Corrected vi.fn() usage in app.test.ts
5. **All src tests passing** - 157 test files, 1776 tests all green

## Overview

Implement a clean Next.js-based web UI for Lace using test-driven development. The goal is to create a shared SSE stream architecture that supports the existing single-agent workflow and future multi-agent capabilities.

## Architecture Principles

### Core Concepts
- **Sessions**: Container for related agents (maps to parent thread)
- **Agents**: Individual AI instances (maps to child threads like `lace_20250703_abc123.1`)
- **Event Sourcing**: All state changes flow through immutable events
- **Session-Scoped Streams**: One SSE stream per session for focused event delivery
- **Thread-Based Agent Identity**: Agents identified by their full threadId

### API Design
- **Session-scoped SSE streams**: `GET /api/sessions/{sessionId}/events/stream`
- **Thread-based messaging**: `POST /api/threads/{threadId}/message`
- **RESTful session management**: Standard CRUD operations for sessions
- **Event multiplexing**: All session events flow through single stream

### Key Implementation Decisions
- **Real Agents from Start**: Using actual Agent class, not mocks
- **SQLite Persistence**: Sessions use existing ThreadManager/SQLite layer
- **Sessions = Parent Threads**: Sessions are threads with `{ isSession: true }` metadata
- **Agent Access Pattern**: ThreadManager accessed exclusively through Agent instances

## Implementation Plan

### Phase 1: Core API Tests (Test-First)

#### 1.1 Session Management Tests ✅
**File**: `src/interfaces/web/app/api/sessions/__tests__/route.test.ts`

**Test Cases:**
```typescript
describe('Session Management API', () => {
  describe('POST /api/sessions', () => {
    it('should create new session with unique sessionId')
    it('should return session with parent threadId format')
    it('should handle missing session name gracefully')
  })

  describe('GET /api/sessions', () => {
    it('should list active sessions')
    it('should return empty array when no sessions')
  })

  describe('GET /api/sessions/{sessionId}', () => {
    it('should return session details with agent list')
    it('should return 404 for non-existent session')
  })
})
```

#### 1.2 Agent Spawning Tests ✅
**File**: `src/interfaces/web/app/api/sessions/[sessionId]/agents/__tests__/route.test.ts`

**Test Cases:**
```typescript
describe('Agent Spawning API', () => {
  describe('POST /api/sessions/{sessionId}/agents', () => {
    it('should create agent with threadId like {sessionId}.{n}')
    it('should support provider/model specification')
    it('should return agent threadId and metadata')
    it('should increment agent numbers sequentially')
    it('should return 404 for invalid sessionId')
  })

  describe('GET /api/sessions/{sessionId}/agents', () => {
    it('should list all agents in session')
    it('should include agent threadIds and metadata')
  })
})
```

#### 1.3 Message Sending Tests ✅
**File**: `src/interfaces/web/app/api/threads/[threadId]/message/__tests__/route.test.ts`

**Test Cases:**
```typescript
describe('Thread Messaging API', () => {
  describe('POST /api/threads/{threadId}/message', () => {
    it('should accept message and queue for processing')
    it('should return immediate acknowledgment')
    it('should validate threadId format')
    it('should handle non-existent threadId')
    it('should emit events via session SSE stream')
  })
})
```

#### 1.4 SSE Stream Tests ✅
**File**: `src/interfaces/web/app/api/sessions/[sessionId]/events/stream/__tests__/route.test.ts`

**Test Cases:**
```typescript
describe('Session SSE Stream API', () => {
  describe('GET /api/sessions/{sessionId}/events/stream', () => {
    it('should establish SSE connection')
    it('should send connection event on open')
    it('should stream events for session only')
    it('should filter out events from other sessions')
    it('should handle client disconnection gracefully')
    it('should support multiple concurrent connections')
  })
})
```

#### 1.5 Integration Tests ✅
**File**: `src/interfaces/web/__tests__/integration/full-flow.test.ts`

**Test Cases:**
```typescript
describe('Full Conversation Flow', () => {
  it('should complete full session workflow', async () => {
    // 1. Create session
    // 2. Spawn agent
    // 3. Connect to SSE stream
    // 4. Send message
    // 5. Verify events flow correctly
    // 6. Verify event ordering and content
  })
  
  it('should handle multi-agent scenario')
  it('should isolate events between sessions')
})
```

### Phase 2: API Implementation ✅

#### 2.1 Core Types and Interfaces ✅
**File**: `src/interfaces/web/types/api.ts`

```typescript
interface Session {
  id: string;           // sessionId (parent threadId)
  name: string;
  createdAt: string;
  agents: Agent[];
}

interface Agent {
  threadId: string;     // Full thread ID like sessionId.1
  provider: string;
  model: string;
  status: 'idle' | 'thinking' | 'streaming' | 'tool_execution';
  createdAt: string;
}

interface SessionEvent {
  type: 'USER_MESSAGE' | 'AGENT_MESSAGE' | 'TOOL_CALL' | 'TOOL_RESULT' | 'THINKING' | 'SYSTEM_MESSAGE';
  threadId: string;
  timestamp: string;
  data: any;
}

interface MessageRequest {
  message: string;
}
```

#### 2.2 Session State Management ✅
**File**: Integrated into API routes using ThreadManager directly

```typescript
class SessionManager {
  // In-memory storage (later can be backed by database)
  private sessions = new Map<string, Session>();
  private agents = new Map<string, Agent>();
  
  createSession(name: string): Session
  getSession(sessionId: string): Session | null
  listSessions(): Session[]
  
  spawnAgent(sessionId: string, provider: string, model: string): Agent
  getAgent(threadId: string): Agent | null
  listAgentsInSession(sessionId: string): Agent[]
  
  // Event distribution
  emitEvent(sessionId: string, event: SessionEvent): void
}
```

#### 2.3 SSE Event Broadcasting ✅
**File**: `src/interfaces/web/lib/sse-manager.ts`

```typescript
class SSEManager {
  private sessionStreams = new Map<string, Set<ReadableStreamDefaultController>>();
  
  addConnection(sessionId: string, controller: ReadableStreamDefaultController): void
  removeConnection(sessionId: string, controller: ReadableStreamDefaultController): void
  broadcast(sessionId: string, event: SessionEvent): void
}
```

#### 2.4 Real Agent Integration ✅
**File**: Using actual Agent class from `~/agents/agent`

```typescript
class MockAgent {
  constructor(
    private threadId: string,
    private sessionId: string,
    private sessionManager: SessionManager
  ) {}
  
  async processMessage(message: string): Promise<void> {
    // Emit thinking start
    // Simulate processing with delays
    // Stream response tokens
    // Emit conversation complete
  }
}
```

#### 2.5 API Route Implementations ✅

**Session Management**: `src/interfaces/web/app/api/sessions/route.ts`
**Agent Spawning**: `src/interfaces/web/app/api/sessions/[sessionId]/agents/route.ts`
**Message Sending**: `src/interfaces/web/app/api/threads/[threadId]/message/route.ts`
**SSE Stream**: `src/interfaces/web/app/api/sessions/[sessionId]/events/stream/route.ts`

### Phase 3: Simple Web UI

#### 3.1 UI Architecture Inspired by Terminal Interface

**Goals:**
- **Minimal complexity**: Focus on proving the API works
- **Terminal-like UX**: Similar to existing Ink interface
- **Session-centric**: Clear session and agent management
- **Real-time updates**: Via SSE stream

#### 3.2 Core Components

**File**: `clean-backend/app/components/LaceTerminal.tsx`
```typescript
// Main terminal-like interface
interface LaceTerminalProps {
  sessionId: string;
}

// Features:
// - Message display area (like terminal timeline)
// - Input area (like terminal shell input)
// - Agent status bar (like terminal status bar)
// - SSE connection management
```

**File**: `clean-backend/app/components/SessionManager.tsx`
```typescript
// Session selection and management
// - List active sessions
// - Create new session
// - Switch between sessions
```

**File**: `clean-backend/app/components/AgentSpawner.tsx`
```typescript
// Agent creation interface
// - Provider/model selection
// - Spawn new agents
// - Display agent list
```

#### 3.3 Hooks for State Management

**File**: `clean-backend/hooks/useSSEStream.ts`
```typescript
// Manages SSE connection and event processing
function useSSEStream(sessionId: string) {
  // Connect to session stream
  // Parse and route events
  // Handle connection state
  // Return event stream and connection status
}
```

**File**: `clean-backend/hooks/useSessionAPI.ts`
```typescript
// Session and agent management
function useSessionAPI() {
  // CRUD operations for sessions
  // Agent spawning
  // Message sending
  // Error handling
}
```

#### 3.4 Simple Terminal-Style UI

**Layout:**
```
┌─ Lace Web Terminal ─────────────────────────────────┐
│ Session: oauth-implementation  [Change] [New]      │
│ Agents: [pm: lace_123.1] [arch: lace_123.2] [+Add] │
├─────────────────────────────────────────────────────┤
│ 👤 User: Help me implement OAuth                    │
│ 🤔 pm: Thinking...                                  │
│ 🤖 pm: I'll help you implement OAuth. Let me       │
│         create some tasks for this...              │
│ 🔧 pm: [TOOL] task-create "Design OAuth flow"      │
│ ✅ pm: Task created successfully                    │
│                                                     │
│ [Scroll area for conversation history]             │
├─────────────────────────────────────────────────────┤
│ > Type your message here...              [Send]    │
└─────────────────────────────────────────────────────┘
```

### Phase 4: Testing Strategy

#### 4.1 Unit Tests
- **API Route Tests**: Each endpoint tested in isolation
- **Component Tests**: React components with mocked APIs
- **Hook Tests**: Custom hooks with mocked dependencies

#### 4.2 Integration Tests
- **Full API Flow**: Create session → spawn agent → send message → verify events
- **UI Integration**: User interactions trigger correct API calls
- **SSE Integration**: Events flow correctly from API to UI

#### 4.3 E2E Tests (Later)
- **Browser automation**: Full user workflows
- **Multi-session scenarios**: Multiple browser windows
- **Connection resilience**: Network interruptions

### Phase 5: Real Agent Integration (Future)

#### 5.1 Replace Mock Agent
- Connect to actual Lace Agent class
- Integrate with ThreadManager and event sourcing
- Support real tool execution and approval workflows

#### 5.2 Task System Integration
- Implement task-based multi-agent coordination
- Add task management UI components
- Support agent delegation and spawning

## Success Criteria

### Phase 1 Complete ✅
- [x] All API tests written and failing
- [x] Clear test coverage for core functionality
- [x] Integration test scenarios defined

**Completed Test Files:**
- `src/interfaces/web/app/api/sessions/__tests__/route.test.ts` - Session management
- `src/interfaces/web/app/api/sessions/[sessionId]/agents/__tests__/route.test.ts` - Agent spawning
- `src/interfaces/web/app/api/threads/[threadId]/message/__tests__/route.test.ts` - Message sending
- `src/interfaces/web/app/api/sessions/[sessionId]/events/stream/__tests__/route.test.ts` - SSE streaming
- `src/interfaces/web/__tests__/integration/full-flow.test.ts` - Full conversation flow

### Phase 2 Complete ✅
- [x] All API tests passing (ready to test)
- [x] Session and agent management working
- [x] SSE stream delivering events correctly
- [x] Multi-session isolation verified
- [x] Real Agent integration through SessionService
- [x] Proper use of Agent API (no direct ThreadManager access)

**Completed API Files:**
- `packages/web/types/api.ts` - Type definitions with strong ThreadId typing
- `packages/web/lib/sse-manager.ts` - SSE connection management
- `packages/web/lib/server/session-service.ts` - SessionService using Agent API
- `packages/web/app/api/sessions/route.ts` - Session CRUD
- `packages/web/app/api/sessions/[sessionId]/route.ts` - Session details
- `packages/web/app/api/sessions/[sessionId]/agents/route.ts` - Agent management
- `packages/web/app/api/threads/[threadId]/message/route.ts` - Message sending
- `packages/web/app/api/sessions/[sessionId]/events/stream/route.ts` - SSE streaming

**Key Implementation Details:**
- Using real Agent instances from the beginning
- Moved to packages/web monorepo structure
- Updated to React 19 and Next.js 15
- Using @/ alias for web app internal imports
- Strong typing preserved with ThreadId branded type
- SessionService encapsulates all Agent operations

### Phase 2.5 Backend Updates Required
**Issue:** Thread type doesn't support metadata (names, session flags, etc.)

**Current Thread Type:**
```typescript
export interface Thread {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  events: ThreadEvent[];
}
```

**Options:**
1. Add metadata field to Thread type and update ThreadPersistence
2. Keep metadata in SessionService memory (current workaround)
3. Create separate metadata table in SQLite

**Current Implementation:**
- SessionService maintains metadata in memory Maps
- This works for development but won't persist across restarts
- Production will need proper persistence

### Phase 3 Complete ✅
- [x] Simple web UI functional
- [x] Can create sessions and view them (using in-memory metadata)
- [x] Real-time SSE connection working
- [x] Can spawn agents within sessions
- [x] Can send messages to agents
- [x] Terminal-like conversation display
- [x] Tool execution visibility

**Completed UI Components:**
- `packages/web/app/page.tsx` - Full test UI with session management, agent spawning, and messaging
- `packages/web/components/ConversationDisplay.tsx` - Terminal-like conversation display component

**Implementation Notes:**
- Fixed Next.js 15 async params requirement
- Webpack warnings about dynamic imports are expected and safe (ProviderRegistry)
- Full UI with real-time event streaming working
- Session names and metadata stored in memory only (needs backend update for persistence)
- ConversationDisplay component shows messages, tool calls, and agent status
- Event handlers properly forward agent events to SSE streams
- Agent names displayed properly in conversation view
- Tool approvals: Full interactive approval system implemented
  - Modal UI with risk indicators (safe/moderate/destructive)
  - Shows tool name, description, annotations, and full parameters
  - Keyboard shortcuts: Y/A (allow once), S (allow session), N/D/ESC (deny)
  - 30-second timeout with countdown
  - Session-wide approval tracking
  - Proper type reuse from backend (ApprovalDecision, ToolAnnotations)

### Phase 4 Complete
- [ ] Comprehensive test coverage
- [ ] UI/API integration verified
- [ ] Performance acceptable for single-user scenarios

### Phase 5: Provider/Model Discovery API ✅

#### 5.1 API Design ✅

**GET /api/providers**
Returns all available providers and their models in a single call.

```typescript
interface ProvidersResponse {
  providers: ProviderWithModels[];
}

interface ProviderWithModels extends ProviderInfo {
  models: ModelInfo[];
  configured: boolean;
}

interface ProviderInfo {
  name: string;                    // 'anthropic', 'openai', etc.
  displayName: string;             // 'Anthropic Claude', 'OpenAI', etc.
  requiresApiKey: boolean;         // Needs API key vs local provider
  configurationHint?: string;      // e.g., "Set ANTHROPIC_KEY environment variable"
}

interface ModelInfo {
  id: string;                      // 'claude-3-opus-20240229'
  displayName: string;             // 'Claude 3 Opus'
  description?: string;            // 'Most capable model for complex tasks'
  contextWindow: number;           // 200000
  maxOutputTokens: number;         // 8192
  capabilities?: string[];         // ['vision', 'function-calling']
  isDefault?: boolean;             // Recommended default for this provider
}
```

**POST /api/providers/{provider}/configure** (Future)
Configure credentials for a specific provider.

```typescript
interface ConfigureProviderRequest {
  apiKey?: string;
  baseUrl?: string;              // For custom endpoints
  // Other provider-specific config
}

interface ConfigureProviderResponse {
  success: boolean;
  provider: ProviderInfo;        // Updated provider info
  error?: string;
}
```

**GET /api/providers/{provider}/test**
Test if a provider is properly configured and working.

```typescript
interface TestProviderResponse {
  success: boolean;
  message: string;               // "Successfully connected to Anthropic API"
  error?: string;
}
```

#### 5.2 Backend Requirements ✅

1. **ProviderRegistry Enhancement:** ✅
   - Added `getAvailableProviders()` method for provider metadata
   - Checks if provider is configured via `isConfigured()` 
   - Lists available models per provider

2. **Provider Base Class Enhancement:** ✅
   - Added abstract methods: `getProviderInfo()`, `getAvailableModels()`, `isConfigured()`
   - Each provider returns metadata about display name, requirements

3. **Individual Provider Updates:** ✅
   - Anthropic: Lists all Claude models with context windows and capabilities
   - OpenAI: Lists GPT-4, GPT-3.5 models with metadata
   - LMStudio: Lists discovered local models dynamically
   - Ollama: Lists installed models via API

**Implementation Files:**
- `src/providers/base-provider.ts` - Added abstract methods and interfaces
- `src/providers/anthropic-provider.ts` - Full model list implementation
- `src/providers/openai-provider.ts` - GPT model list implementation
- `src/providers/lmstudio-provider.ts` - Dynamic model discovery
- `src/providers/ollama-provider.ts` - API-based model listing
- `src/providers/registry.ts` - Added `getAvailableProviders()` method
- `packages/web/app/api/providers/route.ts` - GET endpoint implementation

#### 5.3 Frontend Integration ✅

Updated `AgentSpawner.tsx` to use the API:
```typescript
// Fetch providers on component mount
useEffect(() => {
  fetch('/api/providers')
    .then(res => res.json())
    .then((data: ProvidersResponse) => {
      // Group models by provider
      const modelOptions = data.providers.flatMap(provider => {
        if (!provider.configured) {
          return [{
            value: '',
            label: `${provider.displayName} (Not Configured)`,
            description: provider.configurationHint,
            disabled: true,
          }];
        }
        
        return provider.models.map(model => ({
          value: `${provider.name}:${model.id}`,
          label: model.displayName,
          description: model.description,
          group: provider.displayName,
        }));
      });
      
      setProviderModels(modelOptions);
    });
}, []);

// When spawning, parse the combined value
const [providerName, ...modelParts] = selectedModel.split(':');
const modelId = modelParts.join(':'); // Handle model IDs with colons
```

**Key Implementation Details:**
- Single source of truth for provider/model lists (no more hardcoding)
- Shows configuration status inline (unconfigured providers show hint)
- Graceful degradation if provider discovery fails
- Supports model IDs with colons (e.g., "llama3.2:1b")
- Groups models by provider in the dropdown

## Implementation Order

1. **Week 1**: Write all API tests (Phase 1)
2. **Week 2**: Implement API to pass tests (Phase 2)
3. **Week 3**: Build simple UI (Phase 3)
4. **Week 4**: Polish and testing (Phase 4)
5. **Week 5**: Provider/Model Discovery API (Phase 5)

## Future Considerations

- **Multi-user support**: Authentication and session isolation
- **Persistence**: Database backing for sessions and events
- **Scaling**: Event distribution for multiple processes
- **Mobile support**: Responsive design considerations
- **Real-time collaboration**: Multiple users in same session
- **Dynamic Provider Configuration**: Web-based credential management
- **Provider Hot-Reload**: Add/remove providers without restart

This plan provides a clear path from test-driven API development to a functional web UI that proves the architecture works for both single-agent and future multi-agent scenarios.