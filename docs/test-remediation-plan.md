# Test Remediation Plan - Detailed Task Breakdown

## Overview

This plan fixes fundamental testing issues in the Lace codebase by eliminating mocks that test mock behavior instead of real functionality, reorganizing test files, and establishing proper testing patterns.

## Prerequisites

- Read `docs/testing.md` completely - contains essential patterns and anti-patterns
- Understand TypeScript basics - never use `any` type, use `unknown` with type guards
- Know React Testing Library - focus on user interactions, not implementation details
- Understand Next.js API routes - test actual HTTP responses, not mock responses

## Phase 1: Cleanup & Reorganization

### Task 1.1: Remove Terminal Interface Tests
**Files to delete:**
```bash
rm -rf src/interfaces/terminal/__tests__/
```

**Why:** We're moving to web-only interface. Terminal tests are no longer needed.

**Test it:** Run `npm test` - should have fewer test files, no terminal-related failures.

**Commit:** `refactor: remove terminal interface tests - web interface only`

### Task 1.2: Move Tests to Colocated Pattern
**What to do:** Move all `__tests__/` directory tests to colocated pattern.

**Example transformation:**
```
BEFORE:
src/agents/__tests__/agent.test.ts
src/threads/__tests__/thread-manager.test.ts

AFTER:  
src/agents/agent.test.ts
src/threads/thread-manager.test.ts
```

**Script to help:**
```bash
# Create this as move-tests.sh
find src -name "__tests__" -type d | while read dir; do
  parent=$(dirname "$dir")
  for test_file in "$dir"/*.test.ts "$dir"/*.test.tsx; do
    if [ -f "$test_file" ]; then
      basename_file=$(basename "$test_file")
      mv "$test_file" "$parent/$basename_file"
    fi
  done
  rmdir "$dir" 2>/dev/null || true
done
```

**Test it:** Run `npm test` - same test count, different file locations.

**Commit:** `refactor: move tests to colocated pattern`

### Task 1.3: Rename Tests with Behavior Focus
**Pattern:** Change implementation-focused names to behavior-focused names.

**Examples:**
```typescript
// ❌ Before
it('should call updateSession with correct params', () => {});

// ✅ After  
it('should save updated session name and reflect in session list', () => {});
```

**Files to check:** Every `.test.ts` and `.test.tsx` file.

**How to find bad names:**
```bash
# Find tests with implementation-focused names
grep -r "should call\|should invoke\|toHaveBeenCalled" src --include="*.test.*"
grep -r "should mock\|mock.*called" src --include="*.test.*"
```

**Test it:** Read test names aloud - they should describe user-observable behavior.

**Commit:** `refactor: rename tests to describe behavior not implementation`

## Phase 2: Mock Audit & Documentation

### Task 2.1: Create Mock Inventory
**Create file:** `docs/mock-inventory.md`

**Content template:**
```markdown
# Mock Inventory

## Essential Mocks (Keep)
- File: `src/tools/file-operations.test.ts`
- Mock: `fs/promises`  
- Reason: Avoid disk I/O in tests, focus on business logic
- Status: ✅ Documented

## Behavior Mocks (Remove)
- File: `src/services/session-service.test.ts`
- Mock: `Session.updateSession`
- Problem: Tests mock interaction, not real update behavior  
- Status: ❌ Needs fixing
```

**How to find all mocks:**
```bash
grep -r "vi\.mock\|jest\.mock" src --include="*.test.*" > mock-inventory.txt
grep -r "mockImplementation\|mockReturnValue" src --include="*.test.*" >> mock-inventory.txt
```

**Test it:** Every mock should have a documented reason or be marked for removal.

**Commit:** `docs: create mock inventory for remediation`

### Task 2.2: Document Essential Mocks
**For each essential mock, add comment:**

```typescript
// Mock file system operations to avoid disk I/O in tests  
// Tests focus on business logic, not file handling implementation
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));
```

**Essential mock categories:**
- File system operations (`fs`, `path`)
- Network calls (`fetch`, HTTP clients)  
- Time/randomness (`Date.now()`, `Math.random()`)
- Process/environment (`process.env`, `process.exit`)

**Test it:** Every `vi.mock()` call should have a comment explaining why.

**Commit:** `docs: add explanatory comments to essential mocks`

## Phase 3: Core Logic De-mocking

### Task 3.1: Fix Service Layer Tests
**High priority files:**
- `packages/web/lib/server/session-service.test.ts`
- `src/agents/agent.test.ts` 
- `src/threads/thread-manager.test.ts`

**Pattern to fix:**
```typescript
// ❌ Before - tests mock interaction
it('should update session metadata', async () => {
  const mockUpdateSession = vi.mocked(Session.updateSession);
  sessionService.updateSession(sessionId, updates);
  expect(mockUpdateSession).toHaveBeenCalledWith(sessionId, updates);
});

// ✅ After - tests actual behavior  
it('should update session metadata', async () => {
  const service = new SessionService();
  const sessionId = service.createSession({ name: 'Original' });
  
  service.updateSession(sessionId, { name: 'Updated' });
  const result = service.getSession(sessionId);
  
  expect(result.name).toBe('Updated');
});
```

**Key principle:** Test state changes, not method calls.

**Test it:** Tests should pass without any mocks of your own code.

**Commit after each file:** `refactor: test real session service behavior not mocks`

### Task 3.2: Fix Agent Tests
**File:** `src/agents/agent.test.ts`

**Current problem:** Mocks the entire Agent system, tests mock orchestration.

**Fix approach:**
1. Remove all mocks of Agent, ThreadManager, ToolExecutor
2. Use real instances with test data
3. Test actual agent state transitions
4. Test real message processing

**Example fix:**
```typescript
// ✅ Test real agent behavior
it('should transition to thinking state when processing message', async () => {
  const agent = new Agent({
    provider: mockProvider, // Only mock external dependency
    threadManager: new ThreadManager(), // Real instance
    toolExecutor: new ToolExecutor(), // Real instance  
    threadId: 'test-thread',
    tools: []
  });
  
  const statePromise = new Promise(resolve => {
    agent.on('state_change', (state) => {
      if (state === 'thinking') resolve(state);
    });
  });
  
  await agent.sendMessage('hello');
  const state = await statePromise;
  
  expect(state).toBe('thinking');
});
```

**Test it:** Agent tests should verify real state machine behavior.

**Commit:** `refactor: test real agent behavior not mock orchestration`

### Task 3.3: Fix Tool Tests  
**Files:** `src/tools/**/*.test.ts`

**Pattern:** Tools should test actual execution results, not mock calls.

**Example:**
```typescript
// ❌ Before - tests mock
it('should call file read with correct path', () => {
  const mockReadFile = vi.mocked(fs.readFile);
  tool.execute({ path: '/test.txt' });
  expect(mockReadFile).toHaveBeenCalledWith('/test.txt');
});

// ✅ After - tests behavior (with essential mock)
it('should return file contents when file exists', async () => {
  // Mock file system (essential - avoid disk I/O)
  vi.mocked(fs.readFile).mockResolvedValue('file contents');
  
  const result = await tool.execute({ path: '/test.txt' });
  
  expect(result.content).toBe('file contents');
  expect(result.success).toBe(true);
});
```

**Test it:** Tool tests should verify outputs and error handling.

**Commit after each tool:** `refactor: test file tool outputs not implementation calls`

## Phase 4: API & Service Layer Testing

### Task 4.1: Fix API Route Tests ✅ COMPLETED
**Files:** `packages/web/app/api/**/*.test.ts`

**COMPLETED 2025-07-21:** Successfully replaced complex mock-based API tests with proper temp directory setup.

**Achievement:** 
- Sessions API: 3/3 tests passing with real SessionService and isolated persistence
- Tasks API: 8/8 tests passing with real TaskManager and isolated persistence  
- Removed 138 lines of complex mocks, added proper persistence isolation
- Uses `setupTestPersistence()` / `teardownTestPersistence()` pattern from main project
- Minimal mocking: only environment variables for API keys
- Tests validate real HTTP behavior with real business logic

**Pattern established:**
```typescript
// Before: Complex stateful mocks
const projectStore = new Map<string, any>();
const sessionStore = new Map<string, any>();
vi.mock('~/persistence/database', () => ({ /* 50+ lines of mocks */ }));
vi.mock('~/threads/thread-manager', () => ({ /* more mocks */ }));
vi.mock('~/agents/agent', () => ({ /* fake thread IDs */ }));

// After: Minimal mocking with real persistence  
vi.mock('~/config/env-loader', () => ({ /* only env vars */ }));

beforeEach(() => {
  setupTestPersistence(); // Real temp SQLite DB per test
});

afterEach(() => {
  teardownTestPersistence(); // Clean isolation
});
```

**Key fixes applied:**
- **Real business logic**: Tests now use actual Project, Session, TaskManager classes
- **Isolated persistence**: Each test gets fresh temporary SQLite database  
- **Real HTTP responses**: Tests validate actual NextResponse objects with real data
- **Proper error handling**: Tests verify real error propagation from persistence layer
- **Mock request pattern**: Uses NextRequest with direct handler invocation (no network calls)

**Results:**
- Sessions API: `app/api/sessions/route.test.ts` - 3/3 tests passing
- Tasks API: `app/api/tasks/route.test.ts` - 8/8 tests passing
- Zero test failures across 373 web package tests

**Final established pattern for all API route tests:**
```typescript  
// Mock HTTP request calling real handler with real persistence
const request = new NextRequest('http://localhost:3005/api/sessions');
const response = await GET(request); // Direct handler call
const data = await response.json();

// Verify real HTTP behavior with real data
expect(response.status).toBe(200);
expect(data.sessions).toHaveLength(2);
expected(data.sessions[0].name).toBe('Test Session 1');
```

### Task 4.2: Fix Hook Tests ✅ COMPLETED
**Files:** `packages/web/hooks/**/*.test.ts`

**COMPLETED 2025-07-21:** Successfully improved hook tests to focus on state management behavior rather than API implementation verification.

**Achievement:**
- **useSessionAPI**: 14/14 tests passing with improved behavior-focused test names and state management verification
- **useTaskManager**: 10/10 tests passing with better hook behavior testing patterns  
- **useSSEStream**: 9/9 tests passing (already following good patterns)
- Added proper mock documentation with explanatory comments
- Enhanced loading state lifecycle testing with comprehensive coverage

**Key improvements made:**
- **Behavior-focused test names**: Changed from "should call fetch with correct params" to "should manage loading and success states during session creation"
- **State management testing**: Tests now verify loading state transitions, error state handling, and error state clearing behavior
- **Essential mock documentation**: Added clear comments explaining why each mock is necessary (avoid network calls, focus on hook behavior)
- **Hook lifecycle testing**: Added comprehensive tests for loading state management during async operations

**Pattern established:**
```typescript
// ✅ BEFORE: Implementation-focused
it('should call fetch with correct parameters', async () => {
  await result.current.createSession({ name: 'Test' });
  expect(global.fetch).toHaveBeenCalledWith('/api/sessions', { ... });
});

// ✅ AFTER: Behavior-focused  
it('should manage loading and success states during session creation', async () => {
  // Verify initial state
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBe(null);
  
  await act(async () => {
    session = await result.current.createSession({ name: 'Test Session' });
  });
  
  // Verify successful operation result and final state
  expect(session).toEqual(mockSession);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBe(null);
});
```

**Results:**
- Total hook tests: 33/33 passing across 3 hook files
- Web package total: 374/376 tests passing (2 skipped)
- All hooks now test state management behavior instead of API implementation details
- Comprehensive loading state lifecycle testing added
- Error state clearing behavior verified

**Mock strategy:** 
- ✅ Essential mocks only: `fetch` for network calls, `EventSource` for SSE connections, `TaskAPIClient` for API abstraction
- ✅ All mocks documented with explanatory comments
- ✅ Focus on testing hook behavior, not mock interactions
- ✅ State management verification prioritized over API call verification

## Phase 5: Integration & E2E Testing

### Task 5.1: Add Component Integration Tests
**Create:** `packages/web/components/integration.test.tsx`

**Purpose:** Test multiple components working together.

**Example:**
```typescript
it('should create and display new session', async () => {
  render(
    <SessionProvider>
      <SessionForm />
      <SessionList />
    </SessionProvider>
  );
  
  // User creates session
  fireEvent.change(screen.getByPlaceholderText('Session name'), {
    target: { value: 'My New Session' }
  });
  fireEvent.click(screen.getByText('Create Session'));
  
  // Session appears in list
  await waitFor(() => {
    expect(screen.getByText('My New Session')).toBeInTheDocument();
  });
});
```

**Test it:** Integration tests should verify component interactions.

**Commit:** `test: add component integration tests`

### Task 5.2: Add Critical Path E2E Tests
**Files to create:** 
- `packages/web/__tests__/e2e/session-management.e2e.ts`
- `packages/web/__tests__/e2e/task-workflow.e2e.ts`

**Use:** Playwright for real browser testing.

**Example:**
```typescript
test('complete session workflow', async ({ page }) => {
  await page.goto('/');
  
  // Create session
  await page.click('[data-testid="create-session"]');
  await page.fill('[data-testid="session-name"]', 'E2E Test Session');
  await page.click('[data-testid="submit"]');
  
  // Verify session created
  await expect(page.locator('text=E2E Test Session')).toBeVisible();
  
  // Create task in session
  await page.click('[data-testid="create-task"]');
  await page.fill('[data-testid="task-title"]', 'Test Task');
  await page.click('[data-testid="submit-task"]');
  
  // Verify task appears
  await expect(page.locator('text=Test Task')).toBeVisible();
});
```

**Test it:** E2E tests should verify complete user workflows.

**Commit:** `test: add critical path e2e tests`

## Testing Each Phase

### Phase 1 Testing
```bash
npm test
# Should pass with fewer test files
# No terminal interface tests
# All tests in colocated pattern
```

### Phase 2 Testing  
```bash
grep -r "vi\.mock" src --include="*.test.*" | grep -v "^.*:.*//.*Mock"
# Should return empty (all mocks documented)
```

### Phase 3 Testing
```bash
npm test
# Should pass without mocking your own business logic
# Focus on behavior verification
```

### Phase 4 Testing
```bash
npm test packages/web
# API tests should make real HTTP calls
# Hook tests should verify state management
```

### Phase 5 Testing
```bash
npm run test:e2e
# Should verify complete user workflows
# No mocked backend components
```

## Success Criteria

- ✅ All tests pass
- ✅ Test execution under 30 seconds
- ✅ Zero mocks of own business logic
- ✅ All mocks have explanatory comments
- ✅ Test names describe behavior, not implementation  
- ✅ Integration tests verify component interactions
- ✅ E2E tests cover critical user journeys
- ✅ No `any` types in test code

## Common Pitfalls for Engineers

### 1. Don't Test Mock Calls
```typescript
// ❌ Bad
expect(mockService.create).toHaveBeenCalledWith(data);

// ✅ Good
expect(result.id).toBeDefined();
expect(result.name).toBe(data.name);
```

### 2. Don't Mock What You're Testing
```typescript
// ❌ Bad - mocking the component being tested
vi.mock('~/components/TaskList');

// ✅ Good - only mock external dependencies  
vi.mock('~/utils/api-client');
```

### 3. Don't Use `any` Types
```typescript
// ❌ Bad
const mockData: any = { id: 1 };

// ✅ Good
const mockData: Task = createMockTask({ id: 'task-1' });
```

### 4. Don't Skip the "Why" Comments
```typescript
// ❌ Bad - no explanation
vi.mock('fs/promises');

// ✅ Good - explains reasoning
// Mock file system to avoid disk I/O in tests
vi.mock('fs/promises');
```

## Getting Help

- **Read error messages** - they usually tell you exactly what's wrong
- **Check `docs/testing.md`** - comprehensive patterns and examples
- **Ask questions about business logic** - don't guess what behavior should be
- **Test one thing at a time** - isolate failures for easier debugging

## Commit Message Pattern

Use descriptive commits that explain the improvement:

```bash
git commit -m "refactor: test real session behavior not mock interactions

- Remove Session.updateSession mock
- Test actual session state changes
- Verify data persistence and retrieval
- Focus on user-observable outcomes"
```

Remember: **The goal is confidence in your code's behavior, not confidence in your mocks.**