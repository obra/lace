# Entity Caching Implementation Plan

**Problem**: Session and Project classes have a database query anti-pattern where they load data from the database multiple times within milliseconds, causing performance issues in single-process mode.

**Root Cause**: These classes load their data from the database during construction but immediately discard it, then reload the same data every time metadata is needed.

**Solution**: Implement proper caching patterns similar to ThreadManager, where data is loaded once and cached in the object.

## Background Context

### Current Anti-Pattern
```typescript
// BAD: Session.getById() pattern
static async getById(sessionId: ThreadId): Promise<Session | null> {
  const sessionData = Session.getSession(sessionId); // 📊 Database query #1
  // Create session object but throw away sessionData
  return new Session(sessionId);
}

// BAD: Every method hits database again
getInfo(): SessionInfo | null {
  const sessionData = this.getSessionData(); // 📊 Database query #2 (same data!)
  return { /* convert sessionData */ };
}
```

### Good Pattern (ThreadManager)
```typescript
// GOOD: ThreadManager.getThread() pattern  
getThread(threadId: string): Thread | undefined {
  const cached = cache.get(threadId); // ✅ Check cache first
  if (cached) return cached;
  
  const thread = persistence.loadThread(threadId); // 📊 Database query only if needed
  cache.set(threadId, thread); // ✅ Cache the result
  return thread;
}
```

## Architecture Rules

### Code Quality Standards
- **Never use `any` types** - Use proper TypeScript types with generics and utility types
- **No mocking functionality under test** - Use real code paths, only mock external dependencies
- **TDD Required** - Write failing test first, implement minimal code to pass, refactor
- **YAGNI** - Only implement what's needed for the current task
- **DRY** - Don't repeat yourself, extract common patterns
- **Frequent commits** - Commit after each working test/implementation pair

### Testing Standards
- Tests must use real database operations, not mocks
- Each test should set up its own data and clean up after itself
- Test files should be co-located with source files (e.g., `session.ts` → `session.test.ts`)
- Use factory functions to create test data, not inline object literals
- Verify both positive and negative test cases

## Implementation Tasks

### Task 1: Add SessionData Caching to Session Class

**Files to modify:**
- `src/sessions/session.ts` (main implementation)
- `src/sessions/session.test.ts` (tests)

**Goal**: Store SessionData as private field to eliminate repeated database queries.

#### Step 1.1: Write failing tests for cached SessionData access

**File**: `src/sessions/session.test.ts`

Add these test cases to the existing test file:

```typescript
describe('Session data caching', () => {
  it('should cache SessionData after first load to avoid duplicate database queries', async () => {
    // Arrange: Create a session with known data
    const session = Session.create({
      name: 'Test Session',
      projectId: testProjectId,
      configuration: { testKey: 'testValue' }
    });
    
    // Spy on database calls to count them
    const persistence = getPersistence();
    const loadSessionSpy = vi.spyOn(persistence, 'loadSession');
    
    // Act: Call methods that need SessionData multiple times
    const info1 = session.getInfo();
    const info2 = session.getInfo();
    const projectId1 = session.getProjectId();
    const projectId2 = session.getProjectId();
    
    // Assert: Database should only be called once (during creation)
    // After creation, all data should come from cache
    expect(loadSessionSpy).toHaveBeenCalledTimes(0); // No additional calls
    expect(info1).toEqual(info2);
    expect(projectId1).toEqual(projectId2);
  });

  it('should reload SessionData from database when explicitly requested', async () => {
    // This test ensures we can still force a database reload when needed
    const session = Session.create({
      name: 'Original Name',
      projectId: testProjectId,
      configuration: {}
    });
    
    // Simulate external update to session name in database
    const persistence = getPersistence();
    persistence.updateSession(session.getId(), { name: 'Updated Name' });
    
    // The cached data should still show old name
    expect(session.getInfo()?.name).toBe('Original Name');
    
    // After refresh, should show new name
    session.refreshFromDatabase();
    expect(session.getInfo()?.name).toBe('Updated Name');
  });
});
```

**Run test to confirm it fails**:
```bash
npm test src/sessions/session.test.ts
```

#### Step 1.2: Implement SessionData caching in Session class

**File**: `src/sessions/session.ts`

1. Add private field to store SessionData:

```typescript
export class Session {
  private static _sessionRegistry = new Map<ThreadId, Session>();
  private _sessionData: SessionData; // 👈 NEW: Cache the session data
  
  private _sessionAgent: Agent;
  private _sessionId: ThreadId;
  // ... existing fields
```

2. Modify constructor to accept and cache SessionData:

```typescript
constructor(sessionData: SessionData, options: { 
  threadManager?: ThreadManager;
  toolExecutor?: ToolExecutor;
} = {}) {
  this._sessionData = sessionData; // 👈 NEW: Store the data
  this._sessionId = sessionData.id as ThreadId;
  this._projectId = sessionData.projectId;
  
  // ... rest of existing constructor logic
}
```

3. Update `getById` to pass SessionData to constructor:

```typescript
static async getById(sessionId: ThreadId): Promise<Session | null> {
  logger.debug(`Session.getById called for sessionId: ${sessionId}`);

  // Check if session already exists in registry
  const existingSession = Session._sessionRegistry.get(sessionId);
  if (existingSession && !existingSession._destroyed) {
    logger.debug(`Session.getById: Found existing session in registry for ${sessionId}`);
    return existingSession;
  }

  if (existingSession && existingSession._destroyed) {
    logger.debug(`Session.getById: Removing destroyed session from registry for ${sessionId}`);
    Session._sessionRegistry.delete(sessionId);
  }

  // Get session from the sessions table
  const sessionData = Session.getSession(sessionId);
  if (!sessionData) {
    logger.warn(`Session not found in database: ${sessionId}`);
    return null;
  }

  // 👈 NEW: Pass sessionData to constructor instead of discarding it
  const session = new Session(sessionData);
  return session;
}
```

4. Replace `getSessionData()` method to return cached data:

```typescript
// Replace the existing getSessionData method with this:
private getSessionData(): SessionData {
  return this._sessionData; // 👈 NEW: Return cached data instead of database query
}

// Add method to force refresh from database when needed
refreshFromDatabase(): void {
  const freshData = Session.getSession(this._sessionId);
  if (freshData) {
    this._sessionData = freshData;
  }
}
```

5. Update methods that modify SessionData to update the cache:

```typescript
updateConfiguration(updates: Partial<SessionConfiguration>): void {
  // Validate configuration
  const validatedConfig = Session.validateConfiguration(updates);

  const currentConfig = this._sessionData.configuration || {};
  const newConfig = { ...currentConfig, ...validatedConfig };

  // Update database
  Session.updateSession(this._sessionId, { configuration: newConfig });
  
  // 👈 NEW: Update cached data
  this._sessionData = { 
    ...this._sessionData, 
    configuration: newConfig,
    updatedAt: new Date()
  };
}
```

**Run tests to confirm they pass**:
```bash
npm test src/sessions/session.test.ts
```

**Commit your work**:
```bash
git add src/sessions/session.ts src/sessions/session.test.ts
git commit -m "feat: add SessionData caching to eliminate duplicate database queries

- Store SessionData as private field in Session constructor
- Replace getSessionData() to return cached data instead of DB query
- Add refreshFromDatabase() method for explicit cache refresh
- Update configuration methods to maintain cache consistency
- Add tests to verify caching behavior and cache invalidation"
```

### Task 2: Optimize Session.getSession() to Check Registry First

**Files to modify:**
- `src/sessions/session.ts` (main implementation)
- `src/sessions/session.test.ts` (tests)

**Goal**: Make `Session.getSession()` check the in-memory registry before hitting the database.

#### Step 2.1: Write failing test for registry optimization

**File**: `src/sessions/session.test.ts`

```typescript
describe('Session.getSession registry optimization', () => {
  it('should return cached SessionData from registry instead of database when session exists in memory', async () => {
    // Arrange: Create an active session
    const session = Session.create({
      name: 'Active Session',
      projectId: testProjectId,
      configuration: { cached: true }
    });
    
    const sessionId = session.getId();
    
    // Spy on database to ensure it's not called
    const persistence = getPersistence();
    const loadSessionSpy = vi.spyOn(persistence, 'loadSession');
    
    // Act: Call static getSession method
    const sessionData = Session.getSession(sessionId);
    
    // Assert: Should get data without database call
    expect(sessionData).toBeTruthy();
    expect(sessionData?.name).toBe('Active Session');
    expect(sessionData?.configuration?.cached).toBe(true);
    expect(loadSessionSpy).not.toHaveBeenCalled();
  });

  it('should fall back to database when session not in registry', () => {
    // Arrange: Create session data directly in database (not in registry)
    const sessionId = 'test-session-not-in-registry';
    const directSessionData: SessionData = {
      id: sessionId,
      projectId: testProjectId,
      name: 'Database Only Session',
      description: 'This session exists only in database',
      configuration: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const persistence = getPersistence();
    persistence.saveSession(directSessionData);
    
    // Spy on database to verify it gets called
    const loadSessionSpy = vi.spyOn(persistence, 'loadSession');
    
    // Act: Call getSession for session not in registry
    const sessionData = Session.getSession(sessionId);
    
    // Assert: Should load from database
    expect(sessionData).toBeTruthy();
    expect(sessionData?.name).toBe('Database Only Session');
    expect(loadSessionSpy).toHaveBeenCalledWith(sessionId);
  });
});
```

**Run test to confirm it fails**:
```bash
npm test src/sessions/session.test.ts -t "Session.getSession registry optimization"
```

#### Step 2.2: Implement registry check in getSession

**File**: `src/sessions/session.ts`

Update the `getSession` method:

```typescript
static getSession(sessionId: string): SessionData | null {
  logger.debug('Session.getSession() called', {
    sessionId: sessionId,
  });

  // 👈 NEW: Check registry first to avoid database query for active sessions
  const existingSession = Session._sessionRegistry.get(sessionId as ThreadId);
  if (existingSession && !existingSession._destroyed) {
    logger.debug('Session.getSession() - found in registry, avoiding database query', {
      sessionId: sessionId,
    });
    // Return cached SessionData from the existing session
    return existingSession._sessionData;
  }

  // Fall back to database query for sessions not in memory
  const sessionData = getPersistence().loadSession(sessionId);

  logger.debug('Session.getSession() - database lookup result', {
    sessionId: sessionId,
    hasSessionData: !!sessionData,
    sessionData: sessionData,
  });

  // ... rest of existing method (error handling, etc.)
  return sessionData;
}
```

**Run tests to confirm they pass**:
```bash
npm test src/sessions/session.test.ts
```

**Commit your work**:
```bash
git add src/sessions/session.ts src/sessions/session.test.ts
git commit -m "perf: optimize Session.getSession() to check registry before database

- Check in-memory session registry first before database query
- Return cached SessionData from active sessions
- Fall back to database only for sessions not in memory
- Add tests to verify registry optimization and database fallback
- Reduces duplicate database queries for active sessions"
```

### Task 3: Apply Same Caching Pattern to Project Class

**Files to modify:**
- `src/projects/project.ts` (main implementation) 
- `src/projects/project.test.ts` (tests)

**Goal**: Store ProjectData as private field to eliminate repeated database queries, following the same pattern as Session.

#### Step 3.1: Write failing tests for Project data caching

**File**: `src/projects/project.test.ts`

Add these test cases:

```typescript
describe('Project data caching', () => {
  it('should cache ProjectData after first load to avoid duplicate database queries', () => {
    // Arrange: Create project data in database
    const projectData: ProjectData = {
      id: 'test-project-cache',
      name: 'Cached Project',
      description: 'Test project for caching',
      workingDirectory: '/tmp/test',
      configuration: { testSetting: 'value' },
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date()
    };
    
    const persistence = getPersistence();
    persistence.saveProject(projectData);
    
    // Spy on database calls
    const loadProjectSpy = vi.spyOn(persistence, 'loadProject');
    
    // Act: Load project and call methods that need ProjectData
    const project = Project.getById('test-project-cache');
    expect(project).toBeTruthy();
    
    const info1 = project!.getInfo();
    const info2 = project!.getInfo();
    const name1 = project!.getName();
    const name2 = project!.getName();
    
    // Assert: Database should only be called once (in getById)
    expect(loadProjectSpy).toHaveBeenCalledTimes(1);
    expect(info1).toEqual(info2);
    expect(name1).toEqual(name2);
    expect(name1).toBe('Cached Project');
  });

  it('should refresh ProjectData from database when explicitly requested', () => {
    // Create project
    const project = Project.create(
      'Original Name',
      'Original description', 
      '/tmp/original',
      {}
    );
    
    // Simulate external update in database
    const persistence = getPersistence();
    persistence.updateProject(project.getId(), { 
      name: 'Updated Name',
      description: 'Updated description'
    });
    
    // Cached data should show old values
    expect(project.getName()).toBe('Original Name');
    
    // After refresh, should show new values
    project.refreshFromDatabase();
    expect(project.getName()).toBe('Updated Name');
    expect(project.getInfo()?.description).toBe('Updated description');
  });
});
```

**Run test to confirm it fails**:
```bash
npm test src/projects/project.test.ts -t "Project data caching"
```

#### Step 3.2: Implement ProjectData caching in Project class

**File**: `src/projects/project.ts`

1. Add private field to store ProjectData:

```typescript
export class Project {
  private _id: string;
  private _projectData: ProjectData; // 👈 NEW: Cache the project data
  private _promptTemplateManager: PromptTemplateManager;
  private _environmentManager: ProjectEnvironmentManager;
```

2. Modify constructor to accept and cache ProjectData:

```typescript
constructor(projectData: ProjectData) {
  this._id = projectData.id;
  this._projectData = projectData; // 👈 NEW: Store the data
  this._promptTemplateManager = new PromptTemplateManager();
  this._environmentManager = new ProjectEnvironmentManager();
}
```

3. Update `getById` to pass ProjectData to constructor:

```typescript
static getById(projectId: string): Project | null {
  const persistence = getPersistence();
  const projectData = persistence.loadProject(projectId);

  if (!projectData) {
    return null;
  }

  // 👈 NEW: Pass projectData to constructor instead of discarding it
  return new Project(projectData);
}
```

4. Update `getInfo()` to use cached data:

```typescript
getInfo(): ProjectInfo | null {
  // 👈 NEW: Use cached data instead of database query
  return {
    id: this._projectData.id,
    name: this._projectData.name,
    description: this._projectData.description,
    workingDirectory: this._projectData.workingDirectory,
    isArchived: this._projectData.isArchived,
    createdAt: this._projectData.createdAt,
    lastUsedAt: this._projectData.lastUsedAt,
    sessionCount: this.getSessionCount(),
  };
}
```

5. Add convenience methods and cache management:

```typescript
getName(): string {
  return this._projectData.name;
}

getDescription(): string {
  return this._projectData.description;
}

getWorkingDirectory(): string {
  return this._projectData.workingDirectory;
}

// Add method to force refresh from database
refreshFromDatabase(): void {
  const persistence = getPersistence();
  const freshData = persistence.loadProject(this._id);
  if (freshData) {
    this._projectData = freshData;
  }
}
```

6. Update methods that modify ProjectData to update the cache:

```typescript
updateProject(updates: Partial<ProjectData>): void {
  const persistence = getPersistence();
  persistence.updateProject(this._id, updates);
  
  // 👈 NEW: Update cached data
  this._projectData = { 
    ...this._projectData, 
    ...updates,
    lastUsedAt: new Date() // Always update last used when modifying
  };
}
```

**Run tests to confirm they pass**:
```bash
npm test src/projects/project.test.ts
```

**Commit your work**:
```bash
git add src/projects/project.ts src/projects/project.test.ts
git commit -m "feat: add ProjectData caching to eliminate duplicate database queries

- Store ProjectData as private field in Project constructor
- Replace getInfo() to use cached data instead of DB query
- Add convenience methods getName(), getDescription(), getWorkingDirectory()
- Add refreshFromDatabase() method for explicit cache refresh
- Update modification methods to maintain cache consistency
- Add tests to verify caching behavior and cache invalidation"
```

### Task 4: Update API Routes to Use Optimized Methods

**Files to modify:**
- `packages/web/app/api/sessions/[sessionId]/route.ts`
- Any other API routes that call both Session object methods and Session.getSession()

**Goal**: Eliminate redundant database calls in API routes by using cached data from Session objects.

#### Step 4.1: Identify and fix redundant Session data access

**File**: `packages/web/app/api/sessions/[sessionId]/route.ts`

The current PATCH method has this problematic pattern:

```typescript
// BEFORE: Redundant database calls
const updatedSession = await sessionService.getSession(sessionId); // Session object
const updatedSessionData = Session.getSession(sessionId); // SessionData from DB again!
```

Replace with:

```typescript
// AFTER: Use Session object's cached data
const updatedSession = await sessionService.getSession(sessionId);
if (!updatedSession) {
  return createErrorResponse('Session not found after update', 500, {
    code: 'INTERNAL_SERVER_ERROR',
  });
}

// Force refresh from database to get latest values after update
updatedSession.refreshFromDatabase();

// Get session info from the refreshed object (no additional DB call)
const sessionInfo = updatedSession.getInfo();
const agents = updatedSession.getAgents();

const sessionData = {
  id: updatedSession.getId(),
  name: sessionInfo?.name ?? 'Unknown',
  description: sessionInfo?.description ?? '',
  status: 'active', // From session object, not separate DB query
  createdAt: sessionInfo?.createdAt ?? new Date(),
  agents: agents,
};
```

#### Step 4.2: Write integration test to verify optimization

**File**: `packages/web/app/api/sessions/[sessionId]/route.test.ts`

Add test to verify database queries are minimized:

```typescript
it('should minimize database queries when updating session', async () => {
  // Arrange: Create session
  const session = Session.create({
    name: 'Test Session',
    projectId: testProjectId,
    configuration: {}
  });
  
  const sessionId = session.getId();
  
  // Spy on database calls
  const persistence = getPersistence();
  const loadSessionSpy = vi.spyOn(persistence, 'loadSession');
  
  // Act: Make PATCH request to update session
  const response = await PATCH(
    new NextRequest('http://localhost:3000', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name' })
    }),
    { params: Promise.resolve({ sessionId }) }
  );
  
  // Assert: Should succeed with minimal database calls
  expect(response.status).toBe(200);
  
  // Database should only be called for the explicit refresh, not redundant queries
  expect(loadSessionSpy).toHaveBeenCalledTimes(1);
});
```

**Run test to confirm optimization works**:
```bash
npm test packages/web/app/api/sessions/[sessionId]/route.test.ts
```

**Commit your work**:
```bash
git add packages/web/app/api/sessions/[sessionId]/route.ts packages/web/app/api/sessions/[sessionId]/route.test.ts
git commit -m "perf: eliminate redundant database queries in session API routes

- Use Session object's cached data instead of separate SessionData queries
- Replace dual database calls with single refresh operation
- Add integration test to verify database query optimization
- Maintain same API response format with improved performance"
```

### Task 5: Update Documentation

**Files to modify:**
- `src/sessions/session.ts` (JSDoc comments)
- `src/projects/project.ts` (JSDoc comments) 
- `docs/architecture/caching.md` (new file)

**Goal**: Document the caching behavior for future developers.

#### Step 5.1: Add comprehensive JSDoc comments

**File**: `src/sessions/session.ts`

Add documentation to key methods:

```typescript
/**
 * Get a Session instance by ID, using registry cache when possible.
 * 
 * This method implements a two-tier lookup strategy:
 * 1. Check in-memory session registry first (fastest)
 * 2. Fall back to database query if not in registry
 * 
 * The returned Session object caches its SessionData internally,
 * eliminating the need for repeated database queries.
 * 
 * @param sessionId - The unique session identifier
 * @returns Session instance or null if not found
 */
static async getById(sessionId: ThreadId): Promise<Session | null> {
  // ... existing implementation
}

/**
 * Get SessionData for a session, checking registry before database.
 * 
 * This method is optimized to avoid database queries when the session
 * is already loaded in memory. Use this instead of direct database
 * queries for better performance.
 * 
 * @param sessionId - The unique session identifier
 * @returns SessionData or null if not found
 */
static getSession(sessionId: string): SessionData | null {
  // ... existing implementation
}

/**
 * Force refresh of cached SessionData from database.
 * 
 * Use this method when you know the session data has been modified
 * externally and you need to update the cache. Normal operations
 * that modify data through this Session instance will automatically
 * update the cache.
 */
refreshFromDatabase(): void {
  // ... existing implementation
}
```

#### Step 5.2: Create caching architecture documentation

**File**: `docs/architecture/caching.md`

```markdown
# Caching Architecture

This document describes the caching patterns used in Lace to minimize database queries and improve performance.

## Overview

Lace uses a multi-tier caching strategy for entity objects:

1. **In-Memory Registries**: Active objects are kept in memory registries
2. **Internal Data Caching**: Objects cache their database data internally
3. **Smart Loading**: Check cache before database, load once and cache

## Entity Caching Patterns

### Session Caching

**Registry**: `Session._sessionRegistry` - Maps ThreadId → Session instance

**Pattern**:
```typescript
// 1. Check registry first
const existingSession = Session._sessionRegistry.get(sessionId);
if (existingSession) return existingSession;

// 2. Load from database once
const sessionData = persistence.loadSession(sessionId);
const session = new Session(sessionData); // Cache data internally

// 3. Store in registry
Session._sessionRegistry.set(sessionId, session);
```

**Benefits**:
- ✅ Eliminates repeated `Session.getSession()` database calls
- ✅ Session methods use cached data instead of database queries
- ✅ Registry provides fast lookup for active sessions

### Project Caching

**Pattern**: Similar to Session but without registry (Projects are shorter-lived)

```typescript
// Load once and cache internally
const projectData = persistence.loadProject(projectId);
const project = new Project(projectData); // Cache data internally

// All methods use cached data
project.getInfo(); // No database query
project.getName(); // No database query
```

### ThreadManager Caching (Reference Implementation)

ThreadManager demonstrates good caching patterns that Session and Project now follow:

```typescript
// Check process-local cache first
const cached = processLocalThreadCache.get(threadId);
if (cached) return cached;

// Load from database and cache
const thread = persistence.loadThread(threadId);
processLocalThreadCache.set(threadId, thread);
return thread;
```

## Cache Invalidation

### Automatic Updates
When data is modified through the cached object, the cache is automatically updated:

```typescript
session.updateConfiguration(updates);
// 👆 This updates both database AND internal cache
```

### Manual Refresh
For external updates, manually refresh the cache:

```typescript
session.refreshFromDatabase(); // Reload from database
project.refreshFromDatabase(); // Reload from database
```

## Performance Impact

**Before Optimization**:
```
Multiple Session.getInfo() calls:
- Call 1: Load SessionData from database
- Call 2: Load SessionData from database again
- Call 3: Load SessionData from database again
```

**After Optimization**:
```
Multiple Session.getInfo() calls:
- Call 1: Use cached SessionData (loaded during construction)
- Call 2: Use cached SessionData  
- Call 3: Use cached SessionData
```

**Result**: Eliminates 2/3 of database queries for active sessions.

## Implementation Guidelines

### For New Entity Classes
1. Store the data object as a private field
2. Load data once in constructor/factory method
3. Use cached data in all getter methods
4. Update cache when modifying data
5. Provide refresh method for external updates

### For Database Queries
- Always check cache/registry before database
- Cache the result after loading
- Only query database when absolutely necessary

### Testing Caching
- Spy on database methods to count calls
- Verify cache hits vs misses
- Test cache invalidation scenarios
- Use real database operations, not mocks
```

**Commit your work**:
```bash
git add src/sessions/session.ts src/projects/project.ts docs/architecture/caching.md
git commit -m "docs: add comprehensive caching documentation and JSDoc comments

- Document two-tier lookup strategy and caching benefits
- Add JSDoc comments to key Session and Project methods
- Create caching architecture documentation for future developers
- Document cache invalidation patterns and performance impact
- Provide implementation guidelines for new entity classes"
```

## Testing Strategy

### Unit Tests
- Test cache hits vs database misses
- Verify data consistency between cache and database
- Test cache invalidation scenarios
- Verify error handling when database is unavailable

### Integration Tests  
- Test API routes with optimized caching
- Measure database query counts in realistic scenarios
- Verify performance improvements in end-to-end flows

## Rollout Plan

1. **Phase 1**: Implement Session caching (Tasks 1-2)
2. **Phase 2**: Implement Project caching (Task 3) 
3. **Phase 3**: Update API routes (Task 4)
4. **Phase 4**: Documentation and knowledge transfer (Task 5)

Each phase should be fully tested and committed before proceeding to the next phase.

## Success Criteria

- [ ] Zero duplicate database queries for Session metadata when session is in registry
- [ ] Zero duplicate database queries for Project metadata when project is cached
- [ ] All existing tests pass without modification
- [ ] API response times improve (measurable via logging)
- [ ] Memory usage remains stable (no memory leaks from caching)
- [ ] Cache invalidation works correctly for external updates

## Risk Mitigation

### Memory Leaks
- Ensure objects are removed from registries when destroyed
- Monitor registry sizes in production
- Implement registry cleanup for inactive sessions

### Cache Inconsistency  
- Always update cache when modifying data through object methods
- Provide explicit refresh methods for external updates
- Test cache invalidation scenarios thoroughly