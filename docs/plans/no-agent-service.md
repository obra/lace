# Plan: Remove SharedAgentService and Use Direct Agent Communication

## Context

The web interface currently uses a `SharedAgentService` singleton that creates unnecessary abstraction and complexity. This singleton pattern fights against Lace's clean architecture where components take direct dependencies.

## Goal

Replace the SharedAgentService with direct Agent usage, following the same pattern as TerminalInterface. The Agent instance stays server-side and gets passed to Next.js API routes via request context.

## Background Knowledge

### Lace Architecture
- **Agent**: Core conversation engine (`src/agents/agent.ts`)
- **ThreadManager**: Manages conversation persistence (`src/threads/`)
- **WebInterface**: Embeds Next.js server in main app (`src/interfaces/web/web-interface.ts`)
- **Event-Sourcing**: All conversations stored as immutable event sequences

### Next.js Custom Server
- We use a custom Node.js server that embeds Next.js (`web-interface.ts`)
- API routes are in `src/interfaces/web/app/api/` and run **server-side only**
- Agent cannot go to client (contains SQLite, file handles, API keys)
- Custom servers can pass context to API routes via request objects

### Key Files
- `src/interfaces/web/web-interface.ts` - Main web interface class
- `src/interfaces/web/lib/agent-service.ts` - Current singleton (to be removed)
- `src/interfaces/web/app/api/sessions/route.ts` - Session management API
- `src/interfaces/web/app/api/agents/route.ts` - Agent management API
- `src/interfaces/web/app/api/conversations/route.ts` - Chat API

## Implementation Plan

### Task 1: Create TypeScript Types for Request Context
**Files**: `src/interfaces/web/types.ts` (new file)

**Objective**: Create proper TypeScript interface instead of using `any` casts.

**Code**:
```typescript
// ABOUTME: TypeScript interfaces for web interface request context
// ABOUTME: Extends Node.js IncomingMessage to include Lace Agent instance

import type { IncomingMessage } from 'http';
import type { Agent } from '~/agents/agent';

export interface LaceRequest extends IncomingMessage {
  laceAgent?: Agent;
}
```

**Test**: Write unit test first to verify type safety.

**Commit**: "feat: add TypeScript types for Agent request context"

### Task 2: Setup Agent Context Passing
**Files**: `src/interfaces/web/web-interface.ts`

**Objective**: Modify the custom server to pass the Agent instance to Next.js API routes through request context.

**Code Changes**:
```typescript
// In web-interface.ts, modify the request handler
import type { LaceRequest } from './types';

this.server = createServer((req: LaceRequest, res) => {
  try {
    // Add agent to request context
    req.laceAgent = this.agent;
    void handle(req, res);
  } catch (err) {
    // error handling
  }
});
```

**Test**: Write test first, then implement.

**Commit**: "feat: pass Agent instance to Next.js API routes via request context"

### Task 3: Create Agent Context Helper
**Files**: `src/interfaces/web/lib/agent-context.ts` (new file)

**Objective**: Create a helper function to extract the Agent from Next.js request context with proper error handling.

**Code**:
```typescript
// ABOUTME: Helper to extract Agent instance from Next.js request context
// ABOUTME: Provides type-safe access to Agent passed from main web interface

import type { NextRequest } from 'next/server';
import type { Agent } from '~/agents/agent';

export function getAgentFromRequest(request: NextRequest): Agent {
  const agent = (request as any).laceAgent as Agent | undefined;
  
  if (!agent) {
    throw new Error('Agent not available in request context. WebInterface must be running in integrated mode.');
  }
  
  return agent;
}
```

**Test**: Write unit test first, then implement.

**Commit**: "feat: add agent context helper for Next.js API routes"

### Task 4: Update Sessions API to Use Direct Agent
**Files**: `src/interfaces/web/app/api/sessions/route.ts`

**Objective**: Replace SharedAgentService calls with direct Agent calls.

**Code Changes**: Replace SharedAgentService with direct Agent usage following existing patterns.

**Analysis First**: Check what SharedAgentService.createAgentForThread() actually returns vs what Agent methods provide:
- SharedAgentService returns `{ agent, threadInfo: { threadId, isNew } }`
- Agent.resumeOrCreateThread() returns `ThreadSessionInfo` with different structure
- Need to adapt to Agent's actual API, not force incompatible interfaces

**Test First**: Write failing tests, then implement to make them pass.

**Commit**: "refactor: sessions API uses direct Agent instead of SharedAgentService"

### Task 5: Update All Other API Routes
**Files**: All remaining API routes that use SharedAgentService

**Objective**: Update all APIs to use direct Agent following same pattern.

**Strategy**: 
1. Search codebase for SharedAgentService usage
2. Update each route systematically
3. Update tests for each route
4. Each route gets its own commit

### Task 6: Remove SharedAgentService
**Files**: 
- `src/interfaces/web/lib/agent-service.ts` (delete)
- `src/interfaces/web/web-interface.ts` (remove setSharedAgent call)

**Objective**: Delete SharedAgentService files and remove references.

**Test**: Comprehensive build and manual testing.

**Commit**: "refactor: remove obsolete SharedAgentService"

### Task 7: Integration Testing
**Files**: Manual testing

**Objective**: Verify the entire flow works end-to-end.

**Test Steps**:
1. `npm run build`
2. `npm run start -- --ui=web`
3. Open browser to `http://localhost:3000`
4. Verify session creation works
5. Verify conversation works
6. Ensure terminal interface still works: `npm run start`

**Expected**: Clean, working web interface with no SharedAgentService complexity.

**Commit**: "test: verify web interface works with direct Agent communication"

## Key Principles

### YAGNI - No Overengineering
- Direct Agent usage like TerminalInterface
- No unnecessary service layers or abstractions
- Simple request context passing

### Test-Driven Development
- Write failing tests first for each component
- Implement only enough to make tests pass
- Use existing Agent API instead of forcing custom interfaces

### Follow Lace Architecture
- Agent stays server-side (contains SQLite, file handles)
- Clean separation: WebInterface → Agent → API routes
- Event-sourcing and immutable conversations preserved

## Success Criteria

1. ✅ No SharedAgentService references in codebase
2. ✅ Web interface creates proper Lace thread IDs
3. ✅ All existing tests pass
4. ✅ Manual browser testing works
5. ✅ No console errors in browser
6. ✅ Agent properly initialized in API routes

## Rollback Plan

If issues arise:
1. Revert commits in reverse order
2. The SharedAgentService approach should still work
3. Each task is atomic and can be individually reverted

## Performance Considerations

- Direct Agent access is more efficient than singleton lookup
- No cross-process communication overhead
- Request context passing has minimal performance impact

## Security Considerations

- Agent instance is only available to API routes in integrated mode
- No change to existing security model
- Agent methods still require proper authentication/authorization