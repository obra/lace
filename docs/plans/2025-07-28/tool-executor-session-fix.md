# Tool Executor Session Context Fix

**Date**: 2025-07-28  
**Author**: Claude  
**Status**: Planning  

## Problem Statement

Tool execution in Lace currently has a critical security flaw: tools can be executed without proper session context, bypassing security policy enforcement. This was discovered while debugging why approval events weren't being generated in SessionService tests.

### Root Cause Analysis

1. **Missing Session Context**: Agent's `_executeSingleTool()` and `_executeApprovedTool()` methods create `ToolContext` without the `session` property
2. **Bypass Security**: ToolExecutor's `requestToolPermission()` has `if (context?.session)` logic that skips policy checks when session is missing
3. **Inconsistent Architecture**: Session context is optional in `ToolContext` but required for security policy enforcement

### Current Behavior
```typescript
// Agent creates ToolContext WITHOUT session
const toolContext = {
  threadId: asThreadId(this._threadId),
  parentThreadId: asThreadId(this._getParentThreadId()),
  workingDirectory,
  // session: MISSING!
};

// ToolExecutor skips security when no session
if (context?.session) {
  // Check policies
} else {
  // BYPASS SECURITY - goes straight to approval callback
}
```

## Proposed Solution

### Architecture Principle
**All tool execution must have session context for security policy enforcement.** Tools without session context should be denied execution (fail-safe).

### Implementation Plan

#### Phase 1: Make Session Mandatory (Security Fix)
1. **Update ToolContext Interface** ✅ DONE
   ```typescript
   export interface ToolContext {
     // ... other properties
     session: import('~/sessions/session').Session; // MANDATORY
   }
   ```

2. **Update ToolExecutor Security Logic** ✅ DONE
   ```typescript
   async requestToolPermission(call: ToolCall, context?: ToolContext): Promise<'granted' | 'pending'> {
     // SECURITY: Fail-safe - require session context
     if (!context?.session) {
       throw new Error('Tool execution denied: session context required for security policy enforcement');
     }
     
     const session = context.session;
     const policy = session.getToolPolicy(call.name); // Always 'require-approval' by default
     // ... rest of security logic
   }
   ```

#### Phase 2: Fix Agent Session Context Passing
1. **Add `_getFullSession()` Method** ✅ DONE
   ```typescript
   private async _getFullSession(): Promise<Session | undefined> {
     const thread = this._threadManager.getThread(this._threadId);
     if (!thread?.sessionId) return undefined;
     return await Session.getById(thread.sessionId) || undefined;
   }
   ```

2. **Update Tool Execution Methods** ✅ DONE
   - Fix `_executeSingleTool()` to pass session
   - Fix `_executeApprovedTool()` to pass session
   - Both methods now fail if no session context available

#### Phase 3: Fix Compilation Errors (Current Status)

**TypeScript Errors Found:**
```
../../src/agents/agent.ts(2006,36): error TS2345: Argument of type 'string' is not assignable to parameter of type 'ThreadId'
../../src/tools/bash.test.ts: Missing session property in ToolContext
../../src/tools/context-working-directory.test.ts: Missing session property  
../../src/tools/file-edit.test.ts: Missing session property
../../src/tools/executor.ts: 'session' variable scope issue ✅ FIXED
```

**Fix Strategy:**
1. **Agent Type Error**: Fix ThreadId type conversion in `_getFullSession()`
2. **Test Context Errors**: Systematically fix all tool tests to provide mock session
3. **Validation**: Ensure all tool execution paths have proper session context

#### Phase 4: Test Infrastructure Updates

**Test Categories to Fix:**
1. **Unit Tests**: Tools that create ToolContext directly
2. **Integration Tests**: Agent/Session interactions
3. **Mock Strategy**: Create `createMockSession()` helper for tests

**Mock Session Helper:**
```typescript
function createMockSession(): Session {
  return {
    getToolPolicy: vi.fn().mockReturnValue('require-approval'),
    getEffectiveConfiguration: vi.fn().mockReturnValue({}),
    // ... other required methods
  } as unknown as Session;
}
```

## Implementation Steps

### Immediate (Current Sprint)
- [ ] Fix Agent ThreadId type error
- [ ] Fix ToolExecutor variable scope issue ✅ DONE
- [ ] Create mock session helper for tests
- [ ] Fix 3-5 critical tool tests to validate approach

### Short Term (This Week)
- [ ] Systematically fix all tool test files with missing session context
- [ ] Validate SessionService approval test works with proper session context
- [ ] Run full test suite to ensure no regressions

### Medium Term (Next Sprint)
- [ ] Review all tool execution paths for proper session context
- [ ] Add session context validation to other tool execution methods
- [ ] Update documentation on tool development patterns

## Success Criteria

1. **Security**: All tool execution has mandatory session context
2. **Tests Pass**: Full test suite passes with proper session context
3. **Approval Flow**: SessionService test demonstrates working approval event generation
4. **No Bypass**: ToolExecutor cannot skip security policy checks

## Risks and Mitigations

**Risk**: Breaking many existing tests  
**Mitigation**: Incremental approach with mock session helper

**Risk**: Performance impact of session lookups  
**Mitigation**: Session already cached in Agent, minimal overhead

**Risk**: Complex test setup  
**Mitigation**: Standardized mock session factory

## Architecture Benefits

1. **Security**: Explicit session requirement prevents security bypasses
2. **Clarity**: Makes session dependency explicit in type system
3. **Debugging**: Easier to trace tool execution context
4. **Consistency**: All tool paths follow same security model

## Files Modified

### Core Implementation
- `src/tools/types.ts` - Made session mandatory in ToolContext ✅
- `src/tools/executor.ts` - Added fail-safe session checks ✅
- `src/agents/agent.ts` - Added session context passing ✅

### Tests to Fix
- `src/tools/bash.test.ts`
- `src/tools/context-working-directory.test.ts`
- `src/tools/file-edit.test.ts`
- Multiple other tool test files
- `packages/web/lib/server/session-service.test.ts`

### New Test Utilities
- `src/test-utils/mock-session.ts` (to create)

## Next Actions

1. Fix immediate TypeScript compilation errors
2. Create mock session helper utility
3. Fix critical tool tests as proof of concept
4. Validate SessionService approval test works
5. Systematically fix remaining test files