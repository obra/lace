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

## Success Criteria

- [x] Zero duplicate database queries for Session metadata when session is in registry
- [x] Zero duplicate database queries for Project metadata when project is cached
- [x] All existing tests pass without modification
- [x] Cache invalidation works correctly for external updates

## Risk Mitigation

### Memory Leaks
- Ensure objects are removed from registries when destroyed
- Monitor registry sizes in production
- Implement registry cleanup for inactive sessions

### Cache Inconsistency  
- Always update cache when modifying data through object methods
- Provide explicit refresh methods for external updates
- Test cache invalidation scenarios thoroughly