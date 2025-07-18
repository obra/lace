# Service Layer Architecture Refactoring Plan

## Overview

The web UI currently has API routes that directly import and call business logic classes instead of using proper service layer abstraction. This creates tight coupling, makes testing difficult, and violates separation of concerns.

**Problem**: API routes directly call `Session.getSession()`, `Project.getById()`, etc. instead of using the existing `SessionService`.

**Solution**: Ensure all API routes only interact with service layer methods, never directly with business logic classes.

## Architecture Principles

### Current (Broken) Pattern
```typescript
// ❌ BAD - API route directly imports business logic
import { Session, Project } from '@/lib/server/lace-imports';

export function GET() {
  const session = Session.getSession(id);  // Direct business logic call
  const project = Project.getById(projectId);  // Direct business logic call
}
```

### Target Pattern
```typescript
// ✅ GOOD - API route uses service layer
import { getSessionService } from '@/lib/server/session-service';

export function GET() {
  const sessionService = getSessionService();
  const session = sessionService.getSession(id);  // Service layer call
  const project = sessionService.getProjectForSession(sessionId);  // Service layer call
}
```

## Project Structure Context

### Core Business Logic (src/)
- `src/sessions/session.ts` - Session domain logic
- `src/projects/project.ts` - Project domain logic
- `src/agents/agent.ts` - Agent domain logic
- `src/threads/thread-manager.ts` - Thread management

### Web Package (packages/web/)
- `packages/web/lib/server/session-service.ts` - Service layer (singleton)
- `packages/web/lib/server/lace-imports.ts` - Import abstraction
- `packages/web/app/api/` - Next.js API routes
- `packages/web/types/api.ts` - Web-specific types

### Service Layer Rules
1. **Only** `SessionService` should import business logic classes
2. API routes should **only** call `SessionService` methods
3. `SessionService` is a singleton accessed via `getSessionService()`
4. All database operations go through the service layer

## Task Breakdown

### Task 1: Audit SessionService Coverage
**Goal**: Identify what methods SessionService needs to provide

**Files to examine**:
- `packages/web/lib/server/session-service.ts`
- `packages/web/app/api/sessions/[sessionId]/route.ts`
- `packages/web/app/api/sessions/[sessionId]/configuration/route.ts`
- `packages/web/app/api/projects/[projectId]/sessions/route.ts`

**Steps**:
1. Read `session-service.ts` and list all existing methods
2. Grep for `Session\.` and `Project\.` calls in API routes:
   ```bash
   find packages/web/app/api -name "*.ts" -exec grep -n "Session\.\|Project\." {} +
   ```
3. Create a spreadsheet mapping:
   - Current API route calls → Required SessionService methods
   - Missing SessionService methods that need to be added

**Expected output**: A markdown table like:
```markdown
| API Route | Current Call | Required SessionService Method | Status |
|-----------|-------------|-------------------------------|--------|
| sessions/[id]/route.ts | Session.getSession() | getSession() | ✅ Exists |
| sessions/[id]/configuration/route.ts | Session.getSession() | getSession() | ✅ Exists |
| sessions/[id]/configuration/route.ts | Project.getById() | getProjectForSession() | ❌ Missing |
```

**Testing**: No code changes, just documentation

**Commit**: `docs: audit SessionService API coverage for service layer refactoring`

## Task 1 Results: SessionService Coverage Audit

### Current SessionService Methods
- `createSession(name, provider, model, projectId)` - ✅ Exists
- `listSessions()` - ✅ Exists  
- `getSession(sessionId)` - ✅ Exists
- `spawnAgent(sessionId, provider, model, name)` - ✅ Exists
- `getAgent(threadId)` - ✅ Exists

### API Route Analysis

| API Route | Current Call | Required SessionService Method | Status |
|-----------|-------------|-------------------------------|--------|
| sessions/[sessionId]/configuration/route.ts | Session.getSession() | getSession() | ✅ Exists |
| sessions/[sessionId]/configuration/route.ts | Project.getById() | getProjectForSession() | ❌ Missing |
| sessions/[sessionId]/configuration/route.ts | Project.getConfiguration() | getEffectiveConfiguration() | ❌ Missing |
| sessions/[sessionId]/configuration/route.ts | persistence.updateSession() | updateSessionConfiguration() | ❌ Missing |
| sessions/[sessionId]/route.ts | Session.updateSession() | updateSession() | ❌ Missing |
| sessions/[sessionId]/route.ts | Session.getSession() | getSession() | ✅ Exists |

### Missing Methods Needed
1. **getProjectForSession(sessionId)** - Get project associated with session
2. **getEffectiveConfiguration(sessionId)** - Get merged project + session configuration
3. **updateSessionConfiguration(sessionId, config)** - Update session configuration
4. **updateSession(sessionId, updates)** - Update session metadata

### Task 2: Add Missing SessionService Methods
**Goal**: Implement missing methods in SessionService

## Task 2 Results: Missing Methods Implemented

### TDD Implementation Complete
- ✅ **9 tests written first** - All tests failed initially as expected
- ✅ **4 methods implemented** - All tests now pass
- ✅ **Type safety enforced** - Proper TypeScript types with safety assertions
- ✅ **Linting clean** - All ESLint errors resolved

### Methods Added to SessionService
1. **getProjectForSession(sessionId)** - Returns project associated with session
2. **getEffectiveConfiguration(sessionId)** - Returns merged project + session configuration
3. **updateSessionConfiguration(sessionId, config)** - Updates session configuration with merging
4. **updateSession(sessionId, updates)** - Updates session metadata

### Implementation Details
- Used proper type assertions for Session class methods
- Implemented configuration merging with toolPolicies special handling
- Added comprehensive error handling and null checks
- Maintained consistency with existing SessionService patterns

### Task 3: Refactor Configuration API Route
**Goal**: Remove direct business logic calls from configuration route

**Files to modify**:
- `packages/web/lib/server/session-service.ts`

**TDD Approach**:
1. **Write failing tests first** in `packages/web/lib/server/__tests__/session-service.test.ts`
2. **Run tests** to confirm they fail
3. **Implement minimal code** to make tests pass
4. **Refactor** if needed

**Example missing methods** (based on audit):
```typescript
// Add to SessionService class
getProjectForSession(sessionId: ThreadId): Project | null {
  const sessionData = this.getSession(sessionId);
  if (!sessionData?.projectId) return null;
  
  const { Project } = require('@/lib/server/lace-imports');
  return Project.getById(sessionData.projectId);
}

updateSessionConfiguration(sessionId: ThreadId, config: Partial<SessionConfiguration>): void {
  const sessionData = this.getSession(sessionId);
  if (!sessionData) throw new Error('Session not found');
  
  const { getPersistence } = require('~/persistence/database');
  const persistence = getPersistence();
  
  persistence.updateSession(sessionId, {
    configuration: { ...sessionData.configuration, ...config },
    updatedAt: new Date(),
  });
}

getEffectiveConfiguration(sessionId: ThreadId): SessionConfiguration {
  const sessionData = this.getSession(sessionId);
  if (!sessionData) throw new Error('Session not found');
  
  const project = this.getProjectForSession(sessionId);
  const projectConfig = project?.getConfiguration() || {};
  const sessionConfig = sessionData.configuration || {};
  
  return {
    ...projectConfig,
    ...sessionConfig,
    toolPolicies: {
      ...projectConfig.toolPolicies,
      ...sessionConfig.toolPolicies,
    },
  };
}
```

**Testing commands**:
```bash
# Run specific test file
npm test -- --testPathPattern=session-service.test.ts

# Run in watch mode during development
npm test -- --watch --testPathPattern=session-service.test.ts
```

**Test structure**:
```typescript
describe('SessionService', () => {
  describe('getProjectForSession', () => {
    it('should return project when session has projectId', () => {
      // Arrange: Create session with projectId
      // Act: Call getProjectForSession
      // Assert: Returns correct project
    });
    
    it('should return null when session has no projectId', () => {
      // Test edge case
    });
  });
});
```

**Commit**: `feat: add missing SessionService methods for configuration management`

### Task 3: Refactor Configuration API Route
**Goal**: Remove direct business logic calls from configuration route

**Files to modify**:
- `packages/web/app/api/sessions/[sessionId]/configuration/route.ts`

**Before (current broken code)**:
```typescript
import { Session, Project } from '@/lib/server/lace-imports';

export function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const sessionData = Session.getSession(params.sessionId);
  const projectConfig = sessionData.projectId
    ? Project.getById(sessionData.projectId)?.getConfiguration() || {}
    : {};
  // ... merge logic
}
```

**After (target code)**:
```typescript
import { getSessionService } from '@/lib/server/session-service';

export function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const sessionService = getSessionService();
  const configuration = sessionService.getEffectiveConfiguration(params.sessionId);
  return NextResponse.json({ configuration });
}
```

**TDD Steps**:
1. **Write API route test** in `packages/web/app/api/sessions/[sessionId]/configuration/__tests__/route.test.ts`
2. **Run test** - should fail because route doesn't use SessionService yet
3. **Refactor route** to use SessionService methods
4. **Run test** - should pass
5. **Remove unused imports** (`Session`, `Project`)

**Testing the API route**:
```typescript
// Test file structure
describe('GET /api/sessions/[sessionId]/configuration', () => {
  it('should return effective configuration', async () => {
    // Arrange: Create session with project
    const sessionService = getSessionService();
    const session = await sessionService.createSession(/* params */);
    
    // Act: Call API route
    const response = await GET(mockRequest, { params: { sessionId: session.id } });
    
    // Assert: Response has correct structure
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.configuration).toBeDefined();
  });
});
```

**Manual testing**:
```bash
# Start dev server
npm run dev

# Test API endpoint
curl -X GET http://localhost:3000/api/sessions/test-session-id/configuration

# Should return session configuration JSON
```

**Commit**: `refactor: use SessionService in configuration API route`

## Task 3 Results: Configuration API Route Refactored

### TDD Implementation Complete
- ✅ **Tests updated first** - Modified existing tests to use real SessionService with mocked dependencies
- ✅ **Route implementation refactored** - Removed direct Session/Project imports, now uses SessionService
- ✅ **Proper error handling** - SessionService errors are caught and converted to appropriate HTTP responses
- ✅ **All tests passing** - 7/7 configuration API tests pass
- ✅ **Linting clean** - No ESLint errors

### Changes Made
1. **Updated route imports** - `import { getSessionService } from '@/lib/server/session-service'` instead of direct business logic
2. **Refactored GET endpoint** - Uses `sessionService.getEffectiveConfiguration()` with proper error handling
3. **Refactored PUT endpoint** - Uses `sessionService.updateSessionConfiguration()` and `sessionService.getEffectiveConfiguration()`
4. **Updated tests** - Mock Session/Project dependencies while using real SessionService
5. **Error handling** - Session not found errors are caught and converted to 404 responses

### API Route Pattern
```typescript
// Before (Direct business logic calls)
import { Session, Project } from '@/lib/server/lace-imports';
const sessionData = Session.getSession(params.sessionId);
const project = Project.getById(sessionData.projectId);

// After (Service layer calls)
import { getSessionService } from '@/lib/server/session-service';
const sessionService = getSessionService();
const configuration = await sessionService.getEffectiveConfiguration(params.sessionId);
```

### Task 4: Refactor Session Detail API Route
**Goal**: Remove direct Session calls from session detail route

**Files to modify**:
- `packages/web/app/api/sessions/[sessionId]/route.ts`

**Current issues**:
- Line 114: `Session.updateSession(sessionId, {...})`
- Line 131: `Session.getSession(sessionId)`

**Target pattern**:
```typescript
// Replace direct calls with service methods
const sessionService = getSessionService();
const session = sessionService.getSession(sessionId);
sessionService.updateSession(sessionId, updates);
```

**Testing**:
- Update existing tests in `packages/web/app/api/sessions/[sessionId]/__tests__/route.test.ts`
- Ensure all test cases still pass
- Add new test cases for error conditions

**Commit**: `refactor: use SessionService in session detail API route`

## Task 4 Results: Session Detail API Route Refactored

### TDD Implementation Complete
- ✅ **Tests were already correct** - Existing tests used real SessionService and real database
- ✅ **Route implementation refactored** - Replaced direct Session.updateSession() with sessionService.updateSession()
- ✅ **Removed unused imports** - Removed direct Session import from route, added dynamic import for fresh data
- ✅ **All tests passing** - 8/8 session detail API tests pass
- ✅ **Linting clean** - No ESLint errors

### Changes Made
1. **Replaced direct Session.updateSession()** - Now uses `sessionService.updateSession(sessionId, updates)`
2. **Removed unused Session import** - Session is now imported dynamically only when needed for fresh data
3. **Maintained session data refresh** - Still calls `Session.getSession()` to get updated database values after update
4. **Fixed typo** - Corrected "createdId" to "createdAt" in type assertion

### API Route Pattern
```typescript
// Before (Mixed service + direct calls)
sessionService.updateSession(sessionId, updates);
const updatedSessionData = Session.getSession(sessionId); // Direct call

// After (Primarily service layer)
sessionService.updateSession(sessionId, updates);
const { Session } = await import('@/lib/server/lace-imports');
const updatedSessionData = Session.getSession(sessionId); // Dynamic import for fresh data
```

### Note on Architecture
The route still uses `Session.getSession()` for getting updated session data after updates. This ensures we get fresh database values rather than potentially stale cached values. This is a pragmatic approach that balances service layer principles with the need for data consistency.

### Task 5: Remove Business Logic Imports from API Routes
**Goal**: Clean up imports and ensure no API route directly imports business logic

**Files to audit**:
```bash
# Find all API routes that import business logic
find packages/web/app/api -name "*.ts" -exec grep -l "from '@/lib/server/lace-imports'" {} \;
```

**For each file found**:
1. **Check if it uses SessionService** - if not, refactor to use it
2. **Remove direct imports** of Session, Project, Agent, etc.
3. **Update tests** to match new patterns
4. **Run linter** to catch any issues

**Before**:
```typescript
import { Session, Project, Agent } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
```

**After**:
```typescript
import { getSessionService } from '@/lib/server/session-service';
```

**Testing each file**:
```bash
# Run tests for specific API route
npm test -- --testPathPattern="api/sessions/.*route.test.ts"

# Run all API route tests
npm test -- --testPathPattern="api/.*route.test.ts"
```

**Commit**: `refactor: remove direct business logic imports from API routes`

## Task 5 Results: Complete Elimination of Business Logic Imports

### TDD Implementation Complete
- ✅ **Added SessionService.getSessionData() method** - Provides fresh session data from database
- ✅ **Updated session detail API route** - Eliminated final dynamic import of business logic
- ✅ **All tests passing** - 319/319 tests pass
- ✅ **Zero direct business logic imports** - All API routes now use SessionService exclusively

### Final Pattern Achieved
```typescript
// Before (Last remaining violation)
const { Session } = await import('@/lib/server/lace-imports');
const updatedSessionData = Session.getSession(sessionId);

// After (Complete service layer)
const sessionService = getSessionService();
const updatedSessionData = await sessionService.getSessionData(sessionId);
```

### Verification
```bash
# No API routes import business logic directly
find packages/web/app/api -name "*.ts" -exec grep -l "lace-imports" {} \;
# Returns: No files found

# All 319 tests pass
npm run test:run
# All tests passing
```

### Architecture Achievement
- **100% Service Layer Compliance** - All API routes use SessionService methods only
- **Zero Direct Business Logic Coupling** - Complete separation of concerns achieved
- **Maintainable Testing** - All tests use proper mocking strategies
- **Type Safety** - Proper TypeScript type assertions throughout

### Task 6: Update lace-imports.ts
**Goal**: Remove unnecessary exports that API routes should not use

**Files to modify**:
- `packages/web/lib/server/lace-imports.ts`

**Current exports to evaluate**:
```typescript
export { Agent } from '~/agents/agent';
export { Session } from '~/sessions/session';
export { Project } from '~/projects/project';
export { ThreadManager } from '~/threads/thread-manager';
```

**Decision matrix**:
- **Keep**: Classes that SessionService needs to import
- **Remove**: Classes that only API routes were importing (now they use SessionService)

**Expected result**:
```typescript
// Only keep what SessionService actually needs
export { Agent } from '~/agents/agent';        // ✅ Keep - SessionService uses this
export { Session } from '~/sessions/session';  // ✅ Keep - SessionService uses this
export { Project } from '~/projects/project';  // ✅ Keep - SessionService uses this
// Remove anything that was only used by API routes
```

**Testing**:
```bash
# Ensure build still works
npm run build

# Ensure all tests pass
npm test
```

**Commit**: `refactor: clean up lace-imports exports after service layer refactoring`

### Task 7: Add Integration Tests
**Goal**: Test the complete service layer architecture

**Files to create**:
- `packages/web/__tests__/integration/service-layer.test.ts`

**Test scenarios**:
```typescript
describe('Service Layer Integration', () => {
  it('should handle session creation through service layer', async () => {
    // Test complete flow: API route → SessionService → Business logic
  });
  
  it('should handle configuration updates through service layer', async () => {
    // Test configuration inheritance and updates
  });
  
  it('should handle errors gracefully', async () => {
    // Test error handling in service layer
  });
});
```

**Testing commands**:
```bash
# Run integration tests
npm test -- --testPathPattern="integration/service-layer"

# Run all tests to ensure nothing broke
npm test
```

**Commit**: `test: add integration tests for service layer architecture`

### Task 8: Documentation and Review
**Goal**: Document the new architecture and create review checklist

**Files to create/update**:
- `docs/architecture/service-layer.md` - Architecture documentation
- `packages/web/README.md` - Update with service layer patterns

**Architecture documentation should include**:
1. **Service Layer Principles** - What it is, why we use it
2. **API Route Patterns** - How to write new API routes correctly
3. **Testing Patterns** - How to test service layer methods
4. **Common Mistakes** - What not to do

**Review checklist**:
- [ ] No API route directly imports business logic classes
- [ ] All API routes use `getSessionService()` methods
- [ ] All new methods have unit tests
- [ ] Integration tests cover happy path and error cases
- [ ] Build passes without errors
- [ ] All existing tests still pass

**Final testing**:
```bash
# Full test suite
npm test

# Build check
npm run build

# Lint check
npm run lint

# Type check
npm run typecheck
```

**Commit**: `docs: document service layer architecture and patterns`

## Success Criteria

### Before (Broken)
```typescript
// API routes directly import business logic
import { Session, Project } from '@/lib/server/lace-imports';

export function GET() {
  const session = Session.getSession(id);  // ❌ Direct coupling
  const project = Project.getById(projectId);  // ❌ Direct coupling
}
```

### After (Fixed)
```typescript
// API routes only use service layer
import { getSessionService } from '@/lib/server/session-service';

export function GET() {
  const sessionService = getSessionService();
  const session = sessionService.getSession(id);  // ✅ Service layer
  const config = sessionService.getEffectiveConfiguration(id);  // ✅ Service layer
}
```

### Verification Commands
```bash
# Should find no API routes importing business logic
find packages/web/app/api -name "*.ts" -exec grep -l "Session\|Project\|Agent" {} \; | grep -v __tests__

# Should return empty result (only SessionService imports business logic)

# All tests should pass
npm test

# Build should work
npm run build
```

## Common Pitfalls

1. **Forgetting to write tests first** - Always TDD, write failing test before implementation
2. **Making too many changes at once** - One task, one commit
3. **Not running tests between changes** - Test after each small change
4. **Importing business logic in API routes** - Only import `getSessionService`
5. **Not testing error cases** - Test both happy path and error scenarios
6. **Skipping manual testing** - Use curl/Postman to test API endpoints
7. **Not updating existing tests** - When you change code, update tests too

## Next.js Specific Notes

### API Route Structure
```typescript
// pages/web/app/api/sessions/[sessionId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  const { sessionId } = await params;  // Next.js 15+ async params
  const sessionService = getSessionService();
  
  try {
    const session = sessionService.getSession(sessionId);
    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
}
```

### Testing API Routes
```typescript
// Use Next.js testing patterns
import { GET } from '../route';

describe('API Route', () => {
  it('should return session data', async () => {
    const mockRequest = new NextRequest('http://localhost');
    const mockParams = { params: Promise.resolve({ sessionId: 'test-id' }) };
    
    const response = await GET(mockRequest, mockParams);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.session).toBeDefined();
  });
});
```

This plan ensures clean separation of concerns, proper testing, and maintainable code architecture.