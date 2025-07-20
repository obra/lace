# SessionService Cleanup Plan

## Context

The SessionService was over-engineered by duplicating functionality that already exists in the core Session class. This plan removes duplication incrementally while maintaining working functionality.

### Background for Engineers New to Lace

**Lace Architecture Overview:**
- **Core Classes** (in `src/`): `Session`, `Project`, `Agent` - handle business logic and data persistence
- **Web Package** (in `packages/web/`): Next.js web interface with API routes
- **Service Layer** (in `packages/web/lib/server/`): Web-specific adapters for core classes

**Key Concepts:**
- **Session**: A conversation context that can contain multiple agents
- **Agent**: AI assistant that executes tools and responds to messages  
- **ThreadId**: Unique identifier for sessions and agents (agents have format `sessionId.agentId`)
- **Project**: Configuration container that sessions belong to
- **Tool Approval**: User approval workflow for agent tool execution

**File Structure:**
```
packages/web/
├── app/api/                     # Next.js API routes
├── lib/server/session-service.ts # Service layer (needs cleanup)
├── lib/server/lace-imports.ts   # Imports core classes from src/
└── lib/server/core-types.ts     # Type imports for API routes
```

**Current Problem:**
SessionService duplicates methods that already exist in core Session class, creating confusion and maintenance burden.

## Principles

- **TDD**: Test-Driven Development - write failing tests first, then minimal implementation
- **YAGNI**: Don't create abstractions we don't need
- **DRY**: Remove duplication as we find it
- **Incremental**: One small change per commit
- **Direct Usage**: Call core classes directly when service layer adds no value

## TDD Process for Every Task

**Strict TDD Workflow:**
1. **Red**: Write a failing test that describes the desired behavior
2. **Green**: Write minimal code to make the test pass
3. **Refactor**: Clean up code while keeping tests green
4. **Commit**: One cycle per commit

**No Exceptions**: Never write implementation code before writing a failing test.

## Testing Strategy

**Test Files Location:**
- API routes: `app/api/[route]/__tests__/route.test.ts`
- Services: `lib/server/__tests__/[service].test.ts`

**Testing Commands:**
```bash
# Run specific test file during TDD
npm test -- --testPathPattern="session-service.test.ts"

# Run in watch mode for TDD cycles
npm test -- --watch --testPathPattern="session-service.test.ts"

# Run all tests after changes
npm test

# Run specific route tests
npm test -- --testPathPattern="api/sessions.*route.test.ts"
```

## Progress Summary

### ✅ Completed Tasks (Parallelized)

**Track 2: Agent Utilities for Tool Approval**
- ✅ **Task 5**: Create agent utilities for tool approval
  - Created `packages/web/lib/server/agent-utils.ts` with `setupAgentApprovals()` utility
  - Added TDD tests for agent approval setup functionality
  - Commit: `4d6082e5` - "refactor: create agent utilities for tool approval (Task 5)"

- ✅ **Task 6**: Remove agent methods from SessionService  
  - Removed `setupApprovalCallback`, `spawnAgent`, `getAgent` methods from SessionService
  - Updated agents route to use `session.spawnAgent()` directly with `setupAgentApprovals()` utility
  - Updated thread message route to get agents through session instead of service
  - Replaced all `setupApprovalCallback` calls with `setupAgentApprovals()` utility
  - Commit: `6f3f4167` - "refactor: remove agent methods from SessionService (Task 6)"

**Track 3: Provider Routes - Direct Usage**  
- ✅ **Task 8**: Provider routes already using `ProviderRegistry.createWithAutoDiscovery()` directly
  - No changes needed - routes already follow desired pattern
  - All tests passing

**Track 4: Project Routes - Direct Usage**
- ✅ **Task 7**: Project routes already using `Project` class directly  
  - Routes use `Project.getById()`, `Project.getAll()`, `Project.create()` directly
  - No changes needed - routes already follow desired pattern  
  - All tests passing

### 🔄 Remaining Tasks (Sequential - Merge Conflicts)

**Phase 1**: Remove duplicate SessionService methods that conflict on shared session routes

## Phase 1: Remove Duplicate SessionService Methods

### Task 1: Remove getProjectForSession() Method  

**Status**: ⏳ PENDING  
**Goal**: Delete `getProjectForSession()` and update routes to call `Project.getById()` directly

**Background**: The core `Session` class already has `getProjectId()` method and `Project.getById()` is the standard way to get projects.

#### Step 1: TDD - Write Failing Test for Direct Usage

**File**: `packages/web/lib/server/__tests__/session-service.test.ts`

**Red Phase - Write failing test:**
```typescript
describe('SessionService after getProjectForSession removal', () => {
  it('should not have getProjectForSession method', () => {
    const sessionService = new SessionService();
    
    // This test should FAIL initially because method still exists
    expect(sessionService.getProjectForSession).toBeUndefined();
  });
});
```

**Run test - should FAIL:**
```bash
npm test -- --testPathPattern="session-service.test.ts"
# Should fail because getProjectForSession still exists
```

#### Step 2: Find Routes Using getProjectForSession

```bash
# Find all usages
grep -r "getProjectForSession" packages/web/app/api/
```

For each route found, write TDD test for direct usage.

#### Step 3: TDD - Update Route Tests to Use Direct Approach

**Example - If configuration route uses getProjectForSession:**

**File**: `packages/web/app/api/sessions/[sessionId]/configuration/__tests__/route.test.ts`

**Red Phase - Write failing test for direct approach:**
```typescript
import { GET, PUT } from '../route';
import { Session, Project } from '@/lib/server/lace-imports';

// Mock the core classes
jest.mock('@/lib/server/lace-imports', () => ({
  Session: {
    getSession: jest.fn(),
  },
  Project: {
    getById: jest.fn(),
  },
}));

describe('Configuration Route - Direct Core Class Usage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should get project using Project.getById() directly', async () => {
    // Arrange
    const mockSessionData = { 
      projectId: 'test-project-id',
      configuration: { tool: 'policy' }
    };
    const mockProject = {
      getConfiguration: jest.fn().mockReturnValue({ projectConfig: true }),
    };

    (Session.getSession as jest.Mock).mockReturnValue(mockSessionData);
    (Project.getById as jest.Mock).mockReturnValue(mockProject);

    const mockRequest = new Request('http://localhost');
    const mockParams = { sessionId: 'test-session-id' };

    // Act
    const response = await GET(mockRequest, { params: mockParams });

    // Assert - This should FAIL initially because route still uses SessionService
    expect(Project.getById).toHaveBeenCalledWith('test-project-id');
    expect(mockProject.getConfiguration).toHaveBeenCalled();
    
    const data = await response.json();
    expect(data.configuration).toBeDefined();
  });
});
```

**Run test - should FAIL:**
```bash
npm test -- --testPathPattern="configuration.*route.test.ts"
# Should fail because route still uses SessionService.getProjectForSession
```

#### Step 4: Green Phase - Update Route Implementation

**File**: `packages/web/app/api/sessions/[sessionId]/configuration/route.ts`

**Minimal code to make test pass:**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Session, Project } from '@/lib/server/lace-imports';

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    // Get session data directly
    const sessionData = Session.getSession(params.sessionId);
    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get project directly using Project.getById
    const project = Project.getById(sessionData.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const projectConfig = project.getConfiguration();
    const sessionConfig = sessionData.configuration || {};
    
    // Merge configurations (minimal implementation)
    const configuration = {
      ...projectConfig,
      ...sessionConfig,
      toolPolicies: {
        ...projectConfig.toolPolicies,
        ...sessionConfig.toolPolicies,
      },
    };

    return NextResponse.json({ configuration });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}
```

**Run test - should PASS:**
```bash
npm test -- --testPathPattern="configuration.*route.test.ts"
# Should pass now
```

#### Step 5: Green Phase - Remove Method from SessionService

**File**: `packages/web/lib/server/session-service.ts`

**Remove the method to make SessionService test pass:**
```typescript
// DELETE this method entirely:
// async getProjectForSession(sessionId: ThreadId): Promise<Project | null> { ... }
```

**Run SessionService test - should PASS:**
```bash
npm test -- --testPathPattern="session-service.test.ts"
# Should pass because method is now undefined
```

#### Step 6: Refactor Phase - Clean Up

**Remove related test cases for deleted method:**
```typescript
// DELETE test cases that tested getProjectForSession method
```

**Run all tests:**
```bash
npm test
# All tests should pass
```

#### Step 7: Commit

```bash
git add -A
git commit -m "refactor: remove getProjectForSession() - use Project.getById() directly

- Remove getProjectForSession() method from SessionService
- Update configuration route to use Project.getById() directly  
- Update tests to mock Project class instead of SessionService
- TDD: wrote failing tests first, minimal implementation to pass"
```

### Task 2: Remove getEffectiveConfiguration() Method

**Status**: ⏳ PENDING  
**Goal**: Delete `getEffectiveConfiguration()` and use core Session method directly

#### Step 1: TDD - Write Failing Test

**File**: `packages/web/lib/server/__tests__/session-service.test.ts`

**Red Phase:**
```typescript
describe('SessionService after getEffectiveConfiguration removal', () => {
  it('should not have getEffectiveConfiguration method', () => {
    const sessionService = new SessionService();
    
    // This should FAIL initially
    expect(sessionService.getEffectiveConfiguration).toBeUndefined();
  });
});
```

**Run test - should FAIL:**
```bash
npm test -- --testPathPattern="session-service.test.ts"
```

#### Step 2: Find Usages

```bash
grep -r "sessionService.getEffectiveConfiguration" packages/web/app/api/
```

#### Step 3: TDD - Update Route Tests for Direct Usage

**For each route found, write failing test that expects Session.getEffectiveConfiguration() to be called:**

**Red Phase:**
```typescript
it('should call session.getEffectiveConfiguration() directly', async () => {
  // Arrange
  const mockSession = {
    getEffectiveConfiguration: jest.fn().mockReturnValue({ config: 'data' }),
  };
  const mockSessionService = {
    getSession: jest.fn().mockReturnValue(mockSession),
  };

  // Mock getSessionService to return our mock
  (getSessionService as jest.Mock).mockReturnValue(mockSessionService);

  // Act
  const response = await GET(mockRequest, { params: mockParams });

  // Assert - This should FAIL initially
  expect(mockSession.getEffectiveConfiguration).toHaveBeenCalled();
  expect(mockSessionService.getSession).toHaveBeenCalledWith(mockParams.sessionId);
});
```

**Run test - should FAIL.**

#### Step 4: Green Phase - Update Route

**Minimal code to make test pass:**
```typescript
export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const sessionService = getSessionService();
  const session = await sessionService.getSession(params.sessionId);
  
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const configuration = session.getEffectiveConfiguration();
  return NextResponse.json({ configuration });
}
```

**Run test - should PASS.**

#### Step 5: Green Phase - Remove Method from SessionService

**Delete the method:**
```typescript
// DELETE this method:
// async getEffectiveConfiguration(sessionId: ThreadId): Promise<...> { ... }
```

**Run SessionService test - should PASS.**

#### Step 6: Commit

```bash
git add -A
git commit -m "refactor: remove getEffectiveConfiguration() - use Session method directly

- Remove getEffectiveConfiguration() from SessionService
- Routes now call session.getEffectiveConfiguration() directly
- TDD: failing tests first, minimal implementation"
```

### Task 3: Remove updateSessionConfiguration() Method

**Status**: ⏳ PENDING  
**Goal**: Use `session.updateConfiguration()` directly

#### Step 1: TDD - Write Failing Test

**Red Phase:**
```typescript
it('should not have updateSessionConfiguration method', () => {
  const sessionService = new SessionService();
  expect(sessionService.updateSessionConfiguration).toBeUndefined();
});
```

**Run test - should FAIL.**

#### Step 2: Find Usages and Write Route Tests

```bash
grep -r "updateSessionConfiguration" packages/web/app/api/
```

**Red Phase - Route test:**
```typescript
it('should call session.updateConfiguration() directly', async () => {
  const mockSession = {
    updateConfiguration: jest.fn(),
  };
  const mockSessionService = {
    getSession: jest.fn().mockReturnValue(mockSession),
  };

  // This should FAIL initially
  expect(mockSession.updateConfiguration).toHaveBeenCalledWith(mockConfigUpdates);
});
```

**Run test - should FAIL.**

#### Step 3: Green Phase - Update Route

```typescript
export async function PUT(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const body = await request.json();
  const sessionService = getSessionService();
  const session = await sessionService.getSession(params.sessionId);
  
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  session.updateConfiguration(body);
  return NextResponse.json({ success: true });
}
```

**Run test - should PASS.**

#### Step 4: Green Phase - Remove Method

**Delete from SessionService.**

#### Step 5: Commit

```bash
git commit -m "refactor: remove updateSessionConfiguration() - use Session.updateConfiguration()

- TDD: failing tests first, minimal implementation"
```

### Task 4: Remove getSessionData() Method

**Status**: ⏳ PENDING

#### Step 1: TDD - Write Failing Test

**Red Phase:**
```typescript
it('should not have getSessionData method', () => {
  const sessionService = new SessionService();
  expect(sessionService.getSessionData).toBeUndefined();
});
```

#### Step 2: Find Usages and Create Route Tests

```bash
grep -r "getSessionData" packages/web/app/api/
```

**Red Phase - Route test:**
```typescript
it('should call Session.getSession() directly', async () => {
  // Mock Session static method
  const mockSessionData = { id: 'test', name: 'Test Session' };
  (Session.getSession as jest.Mock).mockReturnValue(mockSessionData);

  const response = await GET(mockRequest, { params: mockParams });

  // This should FAIL initially
  expect(Session.getSession).toHaveBeenCalledWith(mockParams.sessionId);
});
```

#### Step 3: Green Phase - Update Route

```typescript
import { Session } from '@/lib/server/lace-imports';

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const sessionData = Session.getSession(params.sessionId);
  
  if (!sessionData) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json({ session: sessionData });
}
```

#### Step 4: Green Phase - Remove Method

**Delete from SessionService.**

#### Step 5: Commit

```bash
git commit -m "refactor: remove getSessionData() - use Session.getSession() directly

- Routes bypass service layer for simple data fetching
- TDD: failing tests first"
```

## ✅ Phase 2: Fix Tool Approval Architecture - COMPLETED

### ✅ Task 5: Create Agent Utility for Tool Approval - COMPLETED

**Goal**: Move tool approval from SessionService to agent-level utility

#### Step 1: TDD - Write Failing Test for Utility

**File**: `packages/web/lib/server/__tests__/agent-utils.test.ts`

**Red Phase:**
```typescript
import { setupAgentApprovals } from '../agent-utils';
import { Agent } from '@/lib/server/lace-imports';

describe('Agent Utilities', () => {
  it('should setup approval callback on agent', () => {
    const mockAgent = {
      on: jest.fn(),
      threadId: 'test-thread-id',
    };
    const sessionId = 'test-session-id';

    // This should FAIL because file doesn't exist yet
    setupAgentApprovals(mockAgent as unknown as Agent, sessionId);

    expect(mockAgent.on).toHaveBeenCalledWith('approval_request', expect.any(Function));
  });
});
```

**Run test - should FAIL (file doesn't exist).**

#### Step 2: Green Phase - Create Minimal Utility

**File**: `packages/web/lib/server/agent-utils.ts`

```typescript
// ABOUTME: Utilities for agent-specific web concerns
// ABOUTME: Handles tool approval and SSE setup for individual agents

import { Agent } from '@/lib/server/lace-imports';
import { ThreadId } from '@/lib/server/core-types';
import { getApprovalManager } from './approval-manager';

export function setupAgentApprovals(agent: Agent, sessionId: ThreadId): void {
  const approvalManager = getApprovalManager();
  
  agent.on('approval_request', async ({ toolName, input, callback }) => {
    try {
      const decision = await approvalManager.requestApproval(
        agent.threadId,
        sessionId,
        toolName,
        'Tool execution request',
        undefined, // annotations
        input,
        false, // isReadOnly
      );
      callback(decision);
    } catch (error) {
      callback('deny');
    }
  });
}
```

**Run test - should PASS.**

#### Step 3: TDD - Test Moving Logic from SessionService

**Red Phase - Test that SessionService doesn't have approval setup:**
```typescript
it('should not have setupApprovalCallback method', () => {
  const sessionService = new SessionService();
  expect(sessionService.setupApprovalCallback).toBeUndefined();
});
```

**Run test - should FAIL (method still exists).**

#### Step 4: Green Phase - Move Logic and Remove from SessionService

**Move the approval setup logic from SessionService to agent-utils.ts**

**Delete setupApprovalCallback from SessionService.**

**Run test - should PASS.**

#### Step 5: Commit

```bash
git commit -m "refactor: move tool approval from SessionService to agent utilities

- Create agent-utils.ts for agent-specific concerns
- Move approval callback setup to setupAgentApprovals()
- Remove setupApprovalCallback from SessionService
- TDD: failing tests first, minimal implementation"
```

### ✅ Task 6: Remove Agent Methods from SessionService - COMPLETED

#### Step 1: TDD - Write Failing Tests

**Red Phase:**
```typescript
describe('SessionService after agent method removal', () => {
  it('should not have spawnAgent method', () => {
    const sessionService = new SessionService();
    expect(sessionService.spawnAgent).toBeUndefined();
  });

  it('should not have getAgent method', () => {
    const sessionService = new SessionService();
    expect(sessionService.getAgent).toBeUndefined();
  });
});
```

#### Step 2: Find Routes Using These Methods

```bash
grep -r "sessionService.spawnAgent\|sessionService.getAgent" packages/web/app/api/
```

#### Step 3: TDD - Update Route Tests

**Red Phase - Test direct session usage:**
```typescript
it('should spawn agent using session.spawnAgent() directly', async () => {
  const mockAgent = { threadId: 'agent-id' };
  const mockSession = {
    spawnAgent: jest.fn().mockReturnValue(mockAgent),
  };
  
  // This should FAIL initially
  expect(mockSession.spawnAgent).toHaveBeenCalledWith('agent-name', 'provider', 'model');
});
```

#### Step 4: Green Phase - Update Route

```typescript
import { setupAgentApprovals } from '@/lib/server/agent-utils';

export async function POST(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const body = await request.json();
  const sessionService = getSessionService();
  const session = await sessionService.getSession(params.sessionId);
  
  const agent = session.spawnAgent(body.name, body.provider, body.model);
  setupAgentApprovals(agent, params.sessionId);
  
  return NextResponse.json({ agent: { threadId: agent.threadId } });
}
```

#### Step 5: Green Phase - Remove Methods

**Delete spawnAgent and getAgent from SessionService.**

#### Step 6: Commit

```bash
git commit -m "refactor: remove agent methods from SessionService

- Routes call session.spawnAgent() directly
- Use setupAgentApprovals() utility for approval setup
- TDD: failing tests first"
```

## ✅ Phase 3: Direct Backend Usage - COMPLETED

### ✅ Task 7: Project Routes - TDD Direct Usage - COMPLETED

#### Step 1: Pick One Project Route

```bash
# Start with simplest project route
ls packages/web/app/api/projects/[projectId]/
```

**Start with configuration route.**

#### Step 2: TDD - Write Failing Test for Direct Project Usage

**File**: `packages/web/app/api/projects/[projectId]/configuration/__tests__/route.test.ts`

**Red Phase:**
```typescript
import { GET } from '../route';
import { Project } from '@/lib/server/lace-imports';

jest.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: jest.fn(),
  },
}));

describe('Project Configuration Route - Direct Usage', () => {
  it('should use Project.getById() directly', async () => {
    const mockProject = {
      getConfiguration: jest.fn().mockReturnValue({ setting: 'value' }),
    };
    (Project.getById as jest.Mock).mockReturnValue(mockProject);

    const mockRequest = new Request('http://localhost');
    const mockParams = { projectId: 'test-project-id' };

    const response = await GET(mockRequest, { params: mockParams });

    // This should FAIL initially if route uses SessionService
    expect(Project.getById).toHaveBeenCalledWith('test-project-id');
    expect(mockProject.getConfiguration).toHaveBeenCalled();
  });
});
```

**Run test - should FAIL.**

#### Step 3: Green Phase - Update Route

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';

export async function GET(request: NextRequest, { params }: { params: { projectId: string } }) {
  const project = Project.getById(params.projectId);
  
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const configuration = project.getConfiguration();
  return NextResponse.json({ configuration });
}
```

**Run test - should PASS.**

#### Step 4: Commit

```bash
git commit -m "refactor: project configuration route - use Project.getById() directly

- Remove service layer dependency
- TDD: failing test first, minimal implementation"
```

#### Step 5: Repeat for Each Project Route

**Apply same TDD process to:**
- `packages/web/app/api/projects/route.ts`
- `packages/web/app/api/projects/[projectId]/route.ts`
- `packages/web/app/api/projects/[projectId]/environment/route.ts`
- etc.

**One route per commit.**

### ✅ Task 8: Provider Routes - TDD Direct Usage - COMPLETED

#### Step 1: TDD - Write Failing Test

**File**: `packages/web/app/api/providers/__tests__/route.test.ts`

**Red Phase:**
```typescript
import { GET } from '../route';
import { ProviderRegistry } from '@/lib/server/lace-imports';

jest.mock('@/lib/server/lace-imports', () => ({
  ProviderRegistry: {
    createWithAutoDiscovery: jest.fn(),
  },
}));

describe('Providers Route - Direct Usage', () => {
  it('should use ProviderRegistry directly', async () => {
    const mockRegistry = {
      getAvailableProviders: jest.fn().mockReturnValue([]),
    };
    (ProviderRegistry.createWithAutoDiscovery as jest.Mock).mockReturnValue(mockRegistry);

    const response = await GET();

    // This should FAIL initially
    expect(ProviderRegistry.createWithAutoDiscovery).toHaveBeenCalled();
    expect(mockRegistry.getAvailableProviders).toHaveBeenCalled();
  });
});
```

#### Step 2: Green Phase - Update Route

```typescript
import { NextResponse } from 'next/server';
import { ProviderRegistry } from '@/lib/server/lace-imports';

export async function GET() {
  const registry = ProviderRegistry.createWithAutoDiscovery();
  const providers = registry.getAvailableProviders();
  return NextResponse.json({ providers });
}
```

#### Step 3: Commit

```bash
git commit -m "refactor: providers route - use ProviderRegistry directly

- Remove service layer dependency  
- TDD: failing test first"
```

## Phase 4: SessionService Final State

### Task 9: Define Final SessionService - TDD

#### Step 1: TDD - Write Test for Final Interface

**Red Phase:**
```typescript
describe('SessionService Final Interface', () => {
  it('should only have essential web-specific methods', () => {
    const sessionService = new SessionService();
    
    // Should have these methods (web-specific value)
    expect(typeof sessionService.getSession).toBe('function');
    expect(typeof sessionService.createSession).toBe('function');
    expect(typeof sessionService.listSessions).toBe('function');
    expect(typeof sessionService.clearSessionCache).toBe('function');
    
    // Should NOT have these methods (duplicated core functionality)
    expect(sessionService.getProjectForSession).toBeUndefined();
    expect(sessionService.getEffectiveConfiguration).toBeUndefined();
    expect(sessionService.updateSessionConfiguration).toBeUndefined();
    expect(sessionService.getSessionData).toBeUndefined();
    expect(sessionService.spawnAgent).toBeUndefined();
    expect(sessionService.getAgent).toBeUndefined();
    expect(sessionService.setupApprovalCallback).toBeUndefined();
  });
});
```

**Run test - should PASS (if we've done previous tasks correctly).**

#### Step 2: Document Final State

**File**: `packages/web/lib/server/session-service.ts`

**Add documentation:**
```typescript
/**
 * SessionService - Web-specific session management
 * 
 * Responsibilities:
 * - Session caching for performance
 * - Session lifecycle with web setup
 * - Session metadata management
 * 
 * NOT responsible for:
 * - Business logic (use core Session class)
 * - Agent operations (use session.spawnAgent() + agent utilities)
 * - Project operations (use Project class directly)
 * - Configuration merging (use session.getEffectiveConfiguration())
 */
class SessionService {
  // Implementation
}
```

#### Step 3: Commit

```bash
git commit -m "docs: document final SessionService responsibilities

- Clear boundaries between service layer and core classes
- Web-specific concerns only"
```

## Verification Process

**After each task:**

1. **Run specific test:**
```bash
npm test -- --testPathPattern="[test-file-name]"
```

2. **Run all tests:**
```bash
npm test
```

3. **Check TypeScript:**
```bash
npm run typecheck
```

4. **Check linting:**
```bash
npm run lint
```

5. **Build verification:**
```bash
npm run build
```

**All must pass before committing.**

## Final Verification Commands

**After completing all tasks:**

```bash
# No routes should use deleted methods
grep -r "getProjectForSession\|sessionService.getEffectiveConfiguration\|updateSessionConfiguration\|getSessionData" packages/web/app/api/
# Should return no results

# Service layer should be minimal
wc -l packages/web/lib/server/session-service.ts
# Should be significantly smaller than before

# All tests pass
npm test

# No TypeScript errors
npm run typecheck

# Clean build
npm run build
```

## Success Criteria

1. **All tests pass** throughout the process
2. **Zero duplicate methods** in SessionService
3. **Clear domain boundaries** - sessions/agents/projects have distinct responsibilities
4. **TDD compliance** - every change was driven by a failing test first
5. **No functionality regression** - all existing features still work
6. **Smaller codebase** - eliminated unnecessary abstraction layers

## Common TDD Pitfalls to Avoid

1. **Writing implementation before test** - Always red → green → refactor
2. **Testing implementation details** - Test behavior, not internal methods
3. **Complex tests** - Keep tests simple and focused
4. **Skipping refactor phase** - Clean up code after making tests pass
5. **Large commits** - One TDD cycle per commit
6. **Not running tests frequently** - Run tests after every small change