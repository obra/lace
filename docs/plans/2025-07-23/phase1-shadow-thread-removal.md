# Phase 1: Complete Shadow Thread Removal

**Date:** 2025-07-23  
**Engineer Context:** You are skilled in JavaScript but new to this codebase, TypeScript, NextJS, and agentic systems  
**Goal:** Remove all shadow thread complexity while keeping core conversation functionality working

## What You're Removing

Shadow threads were a complex system that created "compacted" versions of conversations by:
- Creating new thread IDs when conversations got too long
- Maintaining lookup tables between "canonical" (external) and "version" (internal) thread IDs
- Storing multiple versions of the same conversation thread

This created significant complexity without much benefit. You're removing it entirely.

## Critical TypeScript Rules

1. **NEVER use `any` type** - Always use proper types or `unknown` with type guards
2. **Use strict TypeScript** - The project has strict mode enabled
3. **Import types correctly** - Use `import type` for type-only imports when possible

## Development Workflow

1. **Test-Driven Development**: Write failing tests first, then implement
2. **Frequent commits**: Commit after each small task completion  
3. **YAGNI**: Don't add features not explicitly required
4. **DRY**: Remove duplication, but don't over-engineer

## Task Breakdown

### Task 1: Set Up Your Environment

**Files to examine:**
- `package.json` - Understand available scripts
- `CLAUDE.md` - Read project guidelines 
- `src/threads/types.ts` - Understand core thread types

**Commands to run:**
```bash
npm install
npm run build  # Make sure it builds
npm test       # See current test status
npm run lint   # Check linting rules
```

**What to verify:**
- Build succeeds
- You understand the `Thread` and `ThreadEvent` interfaces
- You know how to run tests

**Commit:** "Setup: verify build and test environment"

### Task 2: Remove Shadow Thread Database Schema

**Context:** The database uses SQLite with migration system. You need to remove shadow thread tables.

**Files to modify:**
- `src/persistence/database.ts`

**What to do:**
1. **Delete migration v2 completely** - Remove `migrateToV2()` method (lines 170-199)
2. **Remove migration v2 call** - Delete line 99-101 in `runMigrations()`
3. **Renumber migrations** - Change `currentVersion < 3` to `currentVersion < 2` (line 103), etc.
4. **Update schema version check** - The highest version should now be 5 (was 6)

**Critical details:**
- The `migrateToV2()` method creates `thread_versions` and `version_history` tables
- These tables are ONLY used for shadow threads
- Removing them will not break existing conversations

**Test your changes:**
```bash
npm run build
# Should build without errors
```

**Commit:** "Remove shadow thread database schema migration"

### Task 3: Remove Shadow Thread Methods from DatabasePersistence

**Files to modify:**
- `src/persistence/database.ts`

**Methods to delete completely:**
1. `getCurrentVersion(canonicalId: string)` (lines 598-607)
2. `createVersion(canonicalId, newVersionId, reason)` (lines 609-629) 
3. `getVersionHistory(canonicalId: string)` (lines 631-655)
4. `findCanonicalIdForVersion(versionId: string)` (lines 657-668)
5. `createShadowThreadTransaction(...)` (lines 671-724)
6. `cleanupOldShadows(canonicalId, keepLast)` (lines 727-777)

**Also remove:**
- `VersionHistoryEntry` import from line 10
- Any references to these methods in comments

**What to preserve:**
- All other database methods (saveThread, loadThread, saveEvent, loadEvents, etc.)
- Task-related methods
- Session-related methods  
- Project-related methods

**Test your changes:**
```bash
npm run build
# Should build without errors about missing methods
```

**Commit:** "Remove shadow thread methods from DatabasePersistence"

### Task 4: Simplify Thread Loading Logic

**File to modify:**
- `src/persistence/database.ts`

**Method to simplify:**
- `loadThread(threadId: string)` (lines 417-462)

**What to change:**
```typescript
// OLD (lines 420-422):
const currentVersionId = this.getCurrentVersion(threadId);
const actualThreadId = currentVersionId || threadId;

// NEW (replace with):
const actualThreadId = threadId;
```

**Also remove:**
- Comment on line 424 about "version mapping support"

**Why this works:**
- Without shadow threads, thread IDs are always direct
- No need for canonical → version ID lookup

**Test your changes:**
```bash
npm run build
npm test
# Core database tests should still pass
```

**Commit:** "Simplify thread loading - remove canonical ID lookup"

### Task 5: Remove Shadow Thread Methods from ThreadManager

**File to modify:**
- `src/threads/thread-manager.ts`

**Methods to delete completely:**
1. `getCanonicalId(threadId: string)` (lines 551-556)
2. `createCompactedVersion(reason, provider?)` (lines 576-642) 
3. `createShadowThread(reason, provider?)` (lines 646-648)
4. `needsCompaction(provider?)` (lines 651-673)
5. `cleanupOldShadows(canonicalId?, keepLast)` (lines 558-567)

**Also remove:**
- `_providerStrategyCache` property (line 30)
- Any cache clearing in constructors
- Comments explaining canonical ID system (lines 540-548, 573-579)

**Test your changes:**
```bash
npm run build
# Should build without TypeScript errors
```

**Commit:** "Remove shadow thread methods from ThreadManager"

### Task 6: Remove Shadow Thread Types

**File to modify:**
- `src/threads/types.ts`

**Interface to delete:**
```typescript
export interface VersionHistoryEntry {
  id: number;
  canonicalId: string;
  versionId: string;
  createdAt: Date;
  reason: string;  
}
```

**Test your changes:**
```bash
npm run build
# Should build without errors about unknown types
```

**Commit:** "Remove VersionHistoryEntry interface"

### Task 7: Update Agent Class

**File to modify:**
- `src/agents/agent.ts`

**What to remove:**
1. All calls to `this._threadManager.getCanonicalId()` 
2. All calls to `this._threadManager.needsCompaction()`
3. All calls to `this._threadManager.createCompactedVersion()`
4. Comments explaining canonical ID system (lines 322-336)

**Specific locations to fix:**
- Line 455: Remove `canonicalId: this._threadManager.getCanonicalId(this._threadId)`
- Line 453: Remove `canonicalThreadId: this._threadId` (this was duplicate)
- Around line 453: Remove compaction checking in `_processConversation()`

**How to handle compaction removal:**
- The Agent should just work with regular thread IDs
- Remove any logic that triggers automatic compaction
- Conversations will just continue without compaction (that's fine for now)

**Test your changes:**
```bash
npm run build
npm run test:unit
# Agent tests should pass
```

**Commit:** "Remove shadow thread integration from Agent class"

### Task 8: Update Debug Utilities

**File to modify:**
- `src/debug-thread.ts`

**What to change:**
1. Remove `canonicalId` field from debug info interface (line 25)
2. Remove `getCanonicalId()` call (line 57)
3. Remove canonical ID from debug output (line 186)

**Updated interface should look like:**
```typescript
interface DebugInfo {
  threadId: string;
  // Remove: canonicalId: string;
  provider: string;
  // ... other fields remain
}
```

**Test your changes:**
```bash
npm run build
node dist/debug-thread.js --help
# Should run without errors
```

**Commit:** "Remove canonical ID from debug utilities"

### Task 9: Clean Up Test Files

**Files to modify:**
- `src/test-utils/thread-manager-mock.ts`
- Delete: `src/threads/compaction-integration.test.ts`

**In thread-manager-mock.ts:**
Remove these mock methods:
- `createCompactedVersion: vi.fn()`
- `needsCompaction: vi.fn().mockResolvedValue(false)`

**Delete entire file:**
- `src/threads/compaction-integration.test.ts` - This file tests shadow thread functionality

**Test your changes:**
```bash
npm test
# Tests should run without import errors
```

**Commit:** "Remove shadow thread test files and mocks"

### Task 10: Update Documentation

**Files to modify:**
- `docs/DEBUG_TOOLS.md`
- Delete: `docs/implementation/01-thread-shadowing.md`

**In DEBUG_TOOLS.md:**
- Remove references to "canonical ID" in debug output description (line 42)
- Update example output to not show canonical ID

**Delete entire file:**
- `docs/implementation/01-thread-shadowing.md`

**Commit:** "Remove shadow thread documentation"

### Task 11: Run Full Test Suite

**What to do:**
```bash
npm run build
npm run lint
npm test
```

**Expected results:**
- Build should succeed
- Linting should pass
- Most tests should pass (except any that specifically test compaction)
- Any failing tests should be compaction-related only

**If tests fail:**
1. Read the error message carefully
2. Check if it's related to shadow threads (canonical ID, version, etc.)
3. Remove or update the failing test
4. Do NOT try to fix by adding shadow thread code back

**Common issues you might see:**
- Tests trying to call removed methods
- Tests expecting canonical ID behavior
- TypeScript errors about missing properties

**Commit:** "Fix remaining test failures after shadow thread removal"

### Task 12: Verify Core Functionality

**Manual testing:**
1. Start the application: `npm start`
2. Create a new conversation
3. Add some messages
4. Verify the conversation persists correctly
5. Check that thread IDs remain stable

**What should work:**
- Creating new conversations
- Adding events to conversations
- Loading existing conversations
- Thread persistence in SQLite

**What won't work (expected):**
- Automatic compaction when conversations get long
- Any compaction-related features

**If core functionality is broken:**
- Check that you didn't remove essential methods
- Verify thread creation and event persistence still work
- Thread IDs should be simple strings, no versioning

**Commit:** "Verify core conversation functionality works without shadow threads"

## Success Criteria

When Phase 1 is complete:

1. **Build succeeds** - `npm run build` works without errors
2. **Tests pass** - All non-compaction tests pass
3. **Core functionality works** - Can create conversations, add messages, persist data
4. **No shadow thread code remains** - All shadow thread methods, types, and logic removed
5. **Thread IDs are simple** - No canonical/version ID complexity
6. **Database schema clean** - No shadow thread tables

## What You've Accomplished

- Removed 500+ lines of complex shadow thread code
- Simplified thread management to use direct thread IDs only
- Eliminated dual-ID lookup complexity
- Cleaned database schema
- Maintained all core conversation functionality

The codebase is now ready for Phase 2: implementing the new, simpler compaction event system.

## If You Get Stuck

1. **TypeScript errors:** Remember, never use `any` - use proper types or `unknown`
2. **Test failures:** Check if they're testing shadow thread behavior (remove those tests)
3. **Build errors:** Usually missing imports or undefined methods you need to remove
4. **Runtime errors:** Check that core Thread and ThreadEvent types are intact

The goal is complete removal - when in doubt, delete rather than preserve shadow thread complexity.