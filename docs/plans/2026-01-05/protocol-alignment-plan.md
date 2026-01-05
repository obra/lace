# Protocol Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align Ent protocol implementation with spec, clean up type flow, add missing HTTP handlers

**Architecture:** The supervisor HTTP server acts as a bridge between web clients and agent processes. Some protocol methods have schemas defined but aren't exposed via HTTP. The translation layer between protocol events and LaceEvent needs type safety improvements.

**Tech Stack:** TypeScript, Zod schemas, Node.js HTTP server

---

## Task 1: Add Missing HTTP Method Handlers

**Files:**
- Modify: `packages/supervisor/src/http/server.ts:150-294` (agentMethodHandlers object)

**Step 1: Add ent/connections/test handler**

After line 223 (after `ent/connections/credentials/clear`), add:

```typescript
  'ent/connections/test': {
    kind: 'request',
    paramsSchema: EntConnectionsTestRequestSchema.shape.params,
    resultSchema: EntConnectionsTestResponseSchema.shape.result,
  },
```

**Step 2: Add ent/session/compact handler**

After line 183 (after `ent/session/events`), add:

```typescript
  'ent/session/compact': {
    kind: 'request',
    paramsSchema: EntSessionCompactRequestSchema.shape.params,
    resultSchema: EntSessionCompactResponseSchema.shape.result,
  },
```

**Step 3: Add ent/session/checkpoint handler**

After the compact handler, add:

```typescript
  'ent/session/checkpoint': {
    kind: 'request',
    paramsSchema: EntSessionCheckpointRequestSchema.shape.params,
    resultSchema: EntSessionCheckpointResponseSchema.shape.result,
  },
```

**Step 4: Add ent/session/rewind handler**

After the checkpoint handler, add:

```typescript
  'ent/session/rewind': {
    kind: 'request',
    paramsSchema: EntSessionRewindRequestSchema.shape.params,
    resultSchema: EntSessionRewindResponseSchema.shape.result,
  },
```

**Step 5: Add ent/job/inject notification handler**

After line 243 (after `ent/job/kill`), add:

```typescript
  'ent/job/inject': {
    kind: 'notify',
    paramsSchema: EntJobInjectNotificationSchema.shape.params,
  },
```

**Step 6: Add missing schema imports**

At the imports section (around line 20), ensure these are imported:

```typescript
import {
  // ... existing imports ...
  EntConnectionsTestRequestSchema,
  EntConnectionsTestResponseSchema,
  EntSessionCompactRequestSchema,
  EntSessionCompactResponseSchema,
  EntSessionCheckpointRequestSchema,
  EntSessionCheckpointResponseSchema,
  EntSessionRewindRequestSchema,
  EntSessionRewindResponseSchema,
  EntJobInjectNotificationSchema,
} from '@lace/ent-protocol';
```

**Step 7: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors

**Step 8: Commit**

```bash
git add packages/supervisor/src/http/server.ts
git commit -m "feat(supervisor): expose missing protocol methods via HTTP

Add HTTP handlers for:
- ent/connections/test
- ent/session/compact
- ent/session/checkpoint
- ent/session/rewind
- ent/job/inject (notification)"
```

---

## Task 2: Fix session/update Notification Semantics

**Context:** The spec says `session/update` is a notification (fire-and-forget), but it's registered as a request handler.

**Files:**
- Modify: `packages/supervisor/src/supervisor-agent-process.ts`

**Step 1: Find the current handler**

Search for `onRequest('session/update'` in the file.

**Step 2: Change to notification handler**

Change from:
```typescript
this.peer.onRequest('session/update', async (params) => {
```

To:
```typescript
this.peer.onNotification('session/update', (params) => {
```

Note: Remove `async` since notifications don't return values. The callback should not return anything.

**Step 3: Remove any return statement in the handler**

The handler should just process the event without returning.

**Step 4: Verify peer has onNotification**

Check `packages/ent-protocol/src/rpc/peer.ts` for `onNotification` method. If it doesn't exist, add it (similar to `onRequest` but without response handling).

**Step 5: Build and test**

Run: `npm run build && npm test`
Expected: Build succeeds, tests pass

**Step 6: Commit**

```bash
git add packages/supervisor/src/supervisor-agent-process.ts packages/ent-protocol/src/rpc/peer.ts
git commit -m "fix(protocol): use notification handler for session/update

Per spec section 7.1, session/update is fire-and-forget notification,
not a request expecting a response."
```

---

## Task 3: Clean Up Translation Layer Type Safety

**Context:** The `updateToLaceEvents` function uses defensive `typeof` checks instead of trusting Zod-validated types.

**Files:**
- Modify: `packages/web/lib/server/supervisor-service.ts:56-129`

**Step 1: Import protocol types**

Add import:
```typescript
import type { z } from 'zod';
import {
  SessionUpdateNotificationSchema,
} from '@lace/ent-protocol';

type SessionUpdateParams = z.infer<typeof SessionUpdateNotificationSchema>['params'];
```

**Step 2: Add type narrowing helper**

Before `updateToLaceEvents`, add:

```typescript
function isTextDelta(update: SessionUpdateParams): update is SessionUpdateParams & { type: 'text_delta' } {
  return update.type === 'text_delta';
}

function isToolUse(update: SessionUpdateParams): update is SessionUpdateParams & { type: 'tool_use' } {
  return update.type === 'tool_use';
}
```

**Step 3: Rewrite updateToLaceEvents with proper types**

Replace the function body to use discriminated union narrowing instead of `typeof` checks:

```typescript
function updateToLaceEvents(params: {
  workspaceSessionId: string;
  projectId?: string;
  agentSessionId?: string;
  update: SupervisorSessionUpdate;
}): LaceEvent[] {
  const { workspaceSessionId, projectId, agentSessionId, update } = params;

  const baseContext: LaceEvent['context'] = {
    sessionId: workspaceSessionId,
    ...(projectId ? { projectId } : {}),
    ...(agentSessionId ? { threadId: agentSessionId } : {}),
  };

  if (isTextDelta(update)) {
    return [{
      type: 'AGENT_TOKEN',
      timestamp: new Date(),
      transient: true,
      data: { token: update.text },
      context: baseContext,
    }];
  }

  if (isToolUse(update)) {
    const events: LaceEvent[] = [];

    if (update.status === 'pending' || update.status === 'awaiting_permission') {
      events.push({
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: {
          id: update.toolCallId,
          name: update.name,
          arguments: update.input ?? {},
        },
        context: baseContext,
      });
    }

    if (['completed', 'failed', 'denied', 'timeout', 'cancelled'].includes(update.status) && update.result) {
      events.push({
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: {
          id: update.toolCallId,
          status: update.status === 'completed' ? 'completed' : update.status === 'denied' ? 'denied' : 'failed',
          content: toToolResultContent(update.result.content ?? []),
        },
        context: baseContext,
      });
    }

    return events;
  }

  return [];
}
```

**Step 4: Remove defensive type checks**

Delete the `isRecord` helper and manual `typeof` checks that are no longer needed.

**Step 5: Build and test**

Run: `npm run build`
Expected: No TypeScript errors

**Step 6: Commit**

```bash
git add packages/web/lib/server/supervisor-service.ts
git commit -m "refactor(web): use type narrowing in updateToLaceEvents

Replace defensive typeof checks with proper discriminated union
narrowing. The protocol types from Zod are trustworthy."
```

---

## Task 4: Align PersonaInfo Schema with Implementation

**Context:** Spec says `{id, name, description?, tags?}` but implementation has `{name, isUserDefined, path}`. The implementation seems correct for Lace's file-based persona system.

**Files:**
- Modify: `docs/protocol-spec.md` (Section 6.26)

**Step 1: Update spec to match implementation**

Find the PersonaInfo interface in the spec and update to:

```typescript
interface PersonaInfo {
  name: string;
  isUserDefined: boolean;
  path: string;
}
```

Add note explaining this is Lace-specific for file-based persona discovery.

**Step 2: Commit**

```bash
git add docs/protocol-spec.md
git commit -m "docs(protocol): align PersonaInfo spec with implementation

The file-based persona system uses {name, isUserDefined, path}
rather than the generic {id, name, description?, tags?}."
```

---

## Task 5: Document Tool Status State Machine

**Context:** The `tool_use` update has status values but state transitions aren't documented.

**Files:**
- Modify: `docs/protocol-spec.md` or create `docs/design/tool-status-state-machine.md`

**Step 1: Create state machine documentation**

```markdown
## Tool Execution State Machine

Tool execution follows this state machine:

```
┌─────────┐
│ pending │──────────────────────────────────────┐
└────┬────┘                                      │
     │ requires permission?                      │ no permission needed
     ▼                                           │
┌──────────────────────┐                         │
│ awaiting_permission  │                         │
└──────────┬───────────┘                         │
           │                                     │
     ┌─────┴─────┬──────────┐                    │
     ▼           ▼          ▼                    │
┌────────┐  ┌────────┐  ┌─────────┐              │
│ denied │  │timeout │  │ allowed │◀─────────────┘
└────────┘  └────────┘  └────┬────┘
                             │ execute
                             ▼
                    ┌────────┴────────┐
                    ▼                 ▼
               ┌───────────┐    ┌────────┐
               │ completed │    │ failed │
               └───────────┘    └────────┘
                                     ▲
                                     │
                              ┌──────────┐
                              │cancelled │ (user interrupt)
                              └──────────┘
```

### Terminal States
- `completed`: Tool executed successfully
- `failed`: Tool execution error
- `denied`: User denied permission
- `timeout`: Permission request timed out
- `cancelled`: User cancelled during execution

### Status Meanings
- `pending`: Tool call received, determining if permission needed
- `awaiting_permission`: Waiting for user decision
- `completed`: Success with result
- `failed`: Execution error (may include error in result)
- `denied`: User explicitly denied
- `timeout`: Permission request expired (default 5 min)
- `cancelled`: User interrupted execution
```

**Step 2: Commit**

```bash
git add docs/design/tool-status-state-machine.md
git commit -m "docs: add tool status state machine documentation

Explicitly documents the tool_use status transitions:
pending → awaiting_permission → completed|failed|denied|timeout|cancelled"
```

---

## Summary

| Task | Priority | Effort |
|------|----------|--------|
| 1. Add missing HTTP handlers | High | Small |
| 2. Fix notification semantics | Medium | Small |
| 3. Clean up type safety | Medium | Medium |
| 4. Align PersonaInfo spec | Low | Small |
| 5. Document state machine | Low | Small |

Tasks 1-3 are implementation fixes. Tasks 4-5 are documentation alignment.
