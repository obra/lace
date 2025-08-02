# Type System Simplification with Superjson - BURN THE BOATS

## Overview

**Problem:** We have two parallel type systems - "core" types with branded strings and Date objects, and "API" types with plain strings for JSON serialization. This creates complexity, bugs, and manual transformation code.

**Solution:** **DESTROY THE DUAL TYPE SYSTEM COMPLETELY.** Delete all transformation code and API types. Use superjson everywhere. Break everything, then fix it with strong types.

**Outcome:** One set of types used everywhere. ~200 lines of transformation code deleted. No backward compatibility. Clean slate.

## ⚠️ THIS IS A BREAKING CHANGE - NO ROLLBACK

This plan **intentionally destroys** the existing API serialization system. There is no gradual migration. We delete the transformation layer first, then fix all the compilation errors. This forces a clean, consistent implementation.

## Prerequisites

- TypeScript fundamentals (types, interfaces, branded types)
- Next.js API routes and client-side data fetching
- Basic understanding of JSON serialization limitations
- **NEVER use `any` types - use `unknown` and type guards instead**
- **NEVER mock functionality under test - use real implementations**

## Current Architecture

```
Core Types (server):           API Types (client):
- SessionInfo                  - ApiSession  
- ProjectInfo                  - ApiProject
- ThreadId (branded string)    - string
- Date objects                 - ISO strings

Manual transformations in lib/validation/api-schemas.ts convert between them.
```

## Target Architecture

```
Core Types (everywhere):
- SessionInfo, ProjectInfo, ThreadId, Date objects
- Superjson handles serialization transparently
- No API-specific types needed
```

## Implementation Plan - DESTRUCTION FIRST

### Task 1: DESTROY THE TRANSFORMATION LAYER

**Goal:** Delete all transformation code. Break the build. Force superjson adoption.

**Files to DELETE entirely:**
- `lib/validation/api-schemas.ts` - **DELETE THE WHOLE FILE**
- All `Api*` interfaces from `types/api.ts`

**What to do:**
1. **DELETE `lib/validation/api-schemas.ts`** - The entire file. Gone. Forever.
2. **DELETE from `types/api.ts`:**
   ```typescript
   // DELETE THESE INTERFACES - NO MERCY
   export interface ApiSession { ... }
   export interface ApiAgent { ... } 
   export interface ApiProject { ... }
   ```
3. **KEEP ONLY** request/response wrappers in `types/api.ts`:
   ```typescript
   // KEEP THESE - they're just wrappers
   export interface CreateSessionRequest { name?: string; }
   export interface SessionsResponse { sessions: SessionInfo[]; }  // Uses core type now
   ```

**Expected result:** BUILD WILL FAIL. Hundreds of TypeScript errors. This is GOOD.

**Commit:** "feat: DESTROY dual type system - delete api-schemas and Api* types"

### Task 2: Setup Superjson Configuration

**Files to create:**
- `packages/web/lib/serialization.ts` (already exists)

**Files to verify:**
- `packages/web/package.json` - confirm superjson is installed

**What to do:**
1. Read `lib/serialization.ts` to understand the branded type transformers
2. Write a test to verify all branded type serialization works:

```typescript
// lib/serialization.test.ts
import { serialize, deserialize } from './serialization';
import type { ThreadId } from '@/types/core';

// Define NewAgentSpec locally for testing (it's defined in serialization.ts)
type NewAgentSpec = string & { readonly __brand: 'NewAgentSpec' };

describe('Serialization', () => {
  it('should preserve ThreadId branded types', () => {
    const threadId = 'lace_20250801_abc123' as ThreadId;
    const serialized = serialize(threadId);
    const deserialized = deserialize<ThreadId>(serialized);
    
    expect(deserialized).toBe(threadId);
    expect(typeof deserialized).toBe('string');
  });

  it('should preserve NewAgentSpec branded types', () => {
    const agentSpec = 'agent-claude-3-5' as NewAgentSpec;
    const serialized = serialize(agentSpec);
    const deserialized = deserialize<NewAgentSpec>(serialized);
    
    expect(deserialized).toBe(agentSpec);
    expect(typeof deserialized).toBe('string');
  });

  it('should preserve Date objects', () => {
    const date = new Date('2025-08-01T12:00:00Z');
    const serialized = serialize(date);
    const deserialized = deserialize<Date>(serialized);
    
    expect(deserialized).toEqual(date);
    expect(deserialized instanceof Date).toBe(true);
  });

  it('should handle complex objects with multiple branded types', () => {
    const complexObject = {
      sessionId: 'lace_20250801_abc123' as ThreadId,
      assignedTo: 'agent-claude-3-5' as NewAgentSpec,
      createdAt: new Date('2025-08-01T12:00:00Z'),
      metadata: { key: 'value' }
    };
    
    const serialized = serialize(complexObject);
    const deserialized = deserialize<typeof complexObject>(serialized);
    
    expect(deserialized.sessionId).toBe(complexObject.sessionId);
    expect(deserialized.assignedTo).toBe(complexObject.assignedTo);
    expect(deserialized.createdAt).toEqual(complexObject.createdAt);
    expect(deserialized.createdAt instanceof Date).toBe(true);
    expect(deserialized.metadata).toEqual(complexObject.metadata);
  });
});
```

**How to test:**
```bash
npm test lib/serialization.test.ts
```

**Commit:** "feat: add superjson serialization tests"

### Task 3: FIX ALL API ROUTES - NO PRISONERS

**Goal:** Every API route now returns core types with superjson. No exceptions.

**Strategy:** Find every compilation error from deleted transformations. Fix with superjson.

**Find broken API routes:**
```bash
npm run build  # Will show all the broken imports
rg "transformSessionInfo|transformProjectInfo" app/api/  # Find usage
rg "ApiSession|ApiAgent|ApiProject" app/api/  # Find type usage
```

**Pattern for EVERY API route:**
```typescript
// BEFORE (BROKEN after Task 1):
import { transformSessionInfo } from '@/lib/validation/api-schemas';  // DELETED
export async function GET() {
  const sessions = await sessionService.listSessions();
  const apiSessions = sessions.map(transformSessionInfo);  // BROKEN
  return NextResponse.json({ sessions: apiSessions });
}

// AFTER (SUPERJSON with NextResponse):
import { createSuperjsonResponse } from '@/lib/serialization';
export async function GET() {
  const sessions = await sessionService.listSessions(); // Returns SessionInfo[]
  return createSuperjsonResponse({ sessions });
}
```

**Fix ALL routes in one commit. No partial fixes.**

**Step 2b: Update Client Hook**

```typescript
// hooks/useSessionAPI.ts
// BEFORE:
import type { ApiSession } from '@/types/api';
const data = await response.json() as { sessions: ApiSession[] };

// AFTER:
import type { SessionInfo } from '@/types/core';
import { parse } from '@/lib/serialization';
const responseText = await response.text();
const data = parse(responseText) as { sessions: SessionInfo[] };
```

**Step 2c: Update Components Using This Hook**

Find components importing `ApiSession` and change to `SessionInfo`:
- Search: `rg "ApiSession" --type ts`
- Update each import and type annotation

**Step 2d: Write Integration Test**

```typescript
// app/api/sessions/route.test.ts
import { GET } from './route';
import { parse } from '@/lib/serialization';
import type { SessionInfo } from '@/types/core';

describe('/api/sessions', () => {
  it('should return sessions with preserved types', async () => {
    const response = await GET();
    const text = await response.text();
    const data = parse(text) as { sessions: SessionInfo[] };
    
    expect(Array.isArray(data.sessions)).toBe(true);
    if (data.sessions.length > 0) {
      const session = data.sessions[0];
      expect(typeof session.id).toBe('string');
      expect(session.createdAt instanceof Date).toBe(true);
      // ThreadId should be preserved as branded string
      expect(session.id).toMatch(/^lace_\d{8}_[a-z0-9]{6}/);
    }
  });
});
```

**How to test:**
```bash
npm test app/api/sessions/route.test.ts
npm run build # Should compile without errors
```

**Commit:** "feat: convert sessions API route to use superjson"

### Task 3: Convert SSE Streaming

**Target:** `app/api/sessions/[sessionId]/stream/route.ts`
**Goal:** Use superjson for event serialization instead of JSON.stringify

**Files to modify:**
1. `app/api/sessions/[sessionId]/stream/route.ts`
2. `hooks/useEventStream.ts`
3. `lib/server/session-service.ts`

**Step 3a: Update SSE Route**

```typescript
// app/api/sessions/[sessionId]/stream/route.ts
// BEFORE:
const data = `data: ${JSON.stringify(event)}\n\n`;

// AFTER:
import { stringify } from '@/lib/serialization';
const data = `data: ${stringify(event)}\n\n`;
```

**Step 3b: Update Client SSE Consumer**

```typescript
// hooks/useEventStream.ts
// BEFORE:
import type { SessionEvent } from '@/types/web-sse';
eventSource.onmessage = (event) => {
  const sessionEvent: SessionEvent = JSON.parse(event.data);
  // ...
};

// AFTER:
import type { SessionEvent } from '@/types/web-sse';
import { parse } from '@/lib/serialization';
eventSource.onmessage = (event) => {
  const sessionEvent = parse(event.data) as SessionEvent;
  // sessionEvent.timestamp is now a Date object!
  // sessionEvent.threadId is now a branded ThreadId!
  // ...
};
```

**Step 3c: Update Session Service**

```typescript
// lib/server/session-service.ts
// Find where events are broadcast and ensure we're using superjson
// Look for EventStreamManager.broadcast calls
```

**Step 3d: Write E2E Test**

```typescript
// e2e/sse-superjson.test.ts
import { createSSEConnection } from '@/test-utils/sse-helpers';
import { parse } from '@/lib/serialization';

describe('SSE with Superjson', () => {
  it('should preserve event types over SSE', async () => {
    const { eventSource, cleanup } = await createSSEConnection('/api/sessions/test_session_id/stream');
    
    return new Promise<void>((resolve, reject) => {
      eventSource.onmessage = (event) => {
        try {
          const sessionEvent = parse(event.data);
          
          // Verify timestamp is a Date object
          expect(sessionEvent.timestamp instanceof Date).toBe(true);
          
          // Verify threadId is branded
          expect(typeof sessionEvent.threadId).toBe('string');
          expect(sessionEvent.threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}/);
          
          cleanup();
          resolve();
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      
      // Trigger an event by sending a message
      // Implementation depends on your test setup
    });
  });
});
```

**How to test:**
```bash
npm test e2e/sse-superjson.test.ts
# Manual test: Open browser dev tools, watch SSE events in Network tab
```

**Commit:** "feat: convert SSE streaming to use superjson"

### Task 4: DESTROY ALL CLIENT-SIDE API PARSING

**Goal:** Every client hook now expects core types with superjson. Break all existing parsing.

**Strategy:** Find every `response.json()` call. Replace with superjson parsing.

**Find broken client code:**
```bash
rg "response\.json\(\)" hooks/  # Find all JSON parsing
rg "ApiSession|ApiAgent|ApiProject" hooks/  # Find type usage
```

**Pattern for EVERY client hook:**
```typescript
// BEFORE (BROKEN after Task 1):
import type { ApiSession } from '@/types/api';  // DELETED TYPE
const response = await fetch('/api/sessions');
const data = await response.json() as { sessions: ApiSession[] };  // BROKEN

// AFTER (SUPERJSON):
import type { SessionInfo } from '@/types/core';
import { parse } from '@/lib/serialization';
const response = await fetch('/api/sessions');
const data = parse(await response.text()) as { sessions: SessionInfo[] };
```

**Fix ALL hooks in one commit. No mercy for old JSON parsing.**

### Task 5: Update All Client Hooks and Components

**Goal:** Replace all `Api*` type imports with core types

**Files to find and update:**
```bash
rg "ApiSession|ApiAgent|ApiProject" --type ts
```

**Pattern for each file:**
1. Change imports: `ApiSession` → `SessionInfo`
2. Update type annotations in function signatures
3. Update parsing: `response.json()` → `parse(await response.text())`
4. Run type checker: `npm run build`
5. Fix any remaining type errors

**Common patterns:**

```typescript
// BEFORE:
import type { ApiSession } from '@/types/api';
const response = await fetch('/api/sessions');
const data = await response.json() as { sessions: ApiSession[] };

// AFTER:
import type { SessionInfo } from '@/types/core';
import { parse } from '@/lib/serialization';
const response = await fetch('/api/sessions');
const data = parse(await response.text()) as { sessions: SessionInfo[] };
```

**Test each component:**
```bash
npm run build  # Should compile without errors
npm test       # Should pass all tests
```

**Commit after each file:** "refactor: convert [component-name] to use core types"

### Task 5: FINAL DESTRUCTION - VERIFY NOTHING REMAINS

**Goal:** Confirm the dual type system is completely eliminated.

**Verification commands:**
```bash
# These should return ZERO results:
rg "api-schemas" --type ts  # Transformation imports
rg "ApiSession|ApiAgent|ApiProject" --type ts  # Old API types
rg "transformSessionInfo|transformProjectInfo" --type ts  # Transform functions

# Build should work:
npm run build  # Should compile successfully
```

**If ANY results found:** You missed something. Find it. Delete it. No survivors.

**Final verification:**
- `lib/validation/api-schemas.ts` - **SHOULD NOT EXIST**
- `types/api.ts` - **ONLY request/response wrappers remain**
- All imports use core types: `SessionInfo`, `ProjectInfo`, `ThreadId`
- All serialization uses superjson: `stringify()` and `parse()`

**Commit:** "feat: COMPLETE DESTRUCTION - dual type system eliminated"

### Task 7: Final Testing and Cleanup

**Integration tests to run:**
```bash
npm run build          # TypeScript compilation
npm run lint           # Linting
npm test               # Unit tests
npm run test:e2e       # End-to-end tests
```

**Manual testing checklist:**
1. Load application in browser
2. Create a new session - verify it appears correctly
3. Send messages - verify they display with correct timestamps
4. Check browser Network tab - verify SSE events are properly formatted
5. Verify no console errors related to type parsing

**Performance check:**
- Superjson adds ~2-5KB to bundle size
- Check that SSE events still stream smoothly
- Verify API response times haven't increased significantly

**Documentation to update:**
- Update any API documentation that mentions response formats
- Update component props documentation if types changed

**Final commit:** "feat: complete superjson migration - single type system achieved"

## Success Criteria

1. **Build passes:** `npm run build` succeeds without type errors
2. **Tests pass:** All existing tests continue to work
3. **No dual types:** No more `Api*` prefixed types in codebase
4. **Strong typing:** ThreadId brands and Date objects preserved across client-server
5. **Simplified code:** ~200 lines of transformation code removed
6. **Performance maintained:** No significant performance regression

## NO ROLLBACK PLAN

**There is no rollback.** This is intentional destruction of legacy code. 

**If something breaks:**
1. Fix it forward with superjson
2. Use TypeScript errors to guide you to broken code
3. **Never restore the dual type system**

**The old way is dead. Long live the new way.**

## TypeScript Tips for Non-TS Developers

- **Branded types:** `type ThreadId = string & { __brand: 'ThreadId' }` - prevents mixing different string types
- **Type assertions:** Use `as TypeName` to tell TS about types it can't infer
- **Unknown vs any:** Always use `unknown` instead of `any` - forces you to check types at runtime
- **Type guards:** Functions that return `x is Type` to narrow unknown types safely

## Testing Guidelines

- **No mocking:** Always test real implementations, not mocks
- **Integration over unit:** Test the full API request/response cycle
- **Type preservation:** Always verify that complex types (Dates, branded strings) survive serialization
- **Error cases:** Test malformed responses, network failures, etc.