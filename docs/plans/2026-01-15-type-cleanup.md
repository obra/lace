# Type Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate all `as any` type assertions and inline imports from production code in `packages/agent/src/`.

**Architecture:** Create discriminated union types for durable events, typed error classes, and proper permission types. Replace ad-hoc type casts with type-safe accessors and type guards.

**Tech Stack:** TypeScript 5.6+, Zod for runtime validation

---

## Task 1: Create DurableEventData Discriminated Union

**Files:**
- Create: `packages/agent/src/storage/event-types.ts`
- Modify: `packages/agent/src/storage/event-log.ts:35-42`
- Test: `packages/agent/src/storage/__tests__/event-types.test.ts`

**Step 1.1: Write the failing test for event type narrowing**

Create `packages/agent/src/storage/__tests__/event-types.test.ts`:

```typescript
// ABOUTME: Tests for DurableEventData discriminated union type narrowing

import { describe, it, expect } from 'vitest';
import type { DurableEventData, TypedDurableEvent } from '../event-types';

describe('DurableEventData', () => {
  it('narrows prompt event data correctly', () => {
    const event: TypedDurableEvent = {
      eventSeq: 1,
      timestamp: '2026-01-15T00:00:00Z',
      type: 'prompt',
      data: { type: 'prompt', content: [{ type: 'text', text: 'hello' }] },
    };

    if (event.data.type === 'prompt') {
      // TypeScript should know this is PromptEventData
      expect(event.data.content).toBeDefined();
      expect(Array.isArray(event.data.content)).toBe(true);
    }
  });

  it('narrows tool_use event data correctly', () => {
    const event: TypedDurableEvent = {
      eventSeq: 2,
      timestamp: '2026-01-15T00:00:00Z',
      type: 'tool_use',
      data: {
        type: 'tool_use',
        toolCallId: 'tc_123',
        name: 'bash',
        input: { command: 'ls' },
      },
    };

    if (event.data.type === 'tool_use') {
      // TypeScript should know this is ToolUseEventData
      expect(event.data.toolCallId).toBe('tc_123');
      expect(event.data.name).toBe('bash');
    }
  });

  it('narrows job_started event data correctly', () => {
    const event: TypedDurableEvent = {
      eventSeq: 3,
      timestamp: '2026-01-15T00:00:00Z',
      type: 'job_started',
      data: {
        type: 'job_started',
        jobId: 'job_123',
        jobType: 'shell',
      },
    };

    if (event.data.type === 'job_started') {
      expect(event.data.jobId).toBe('job_123');
      expect(event.data.jobType).toBe('shell');
    }
  });
});
```

**Step 1.2: Run test to verify it fails**

Run: `npm test -- --run packages/agent/src/storage/__tests__/event-types.test.ts`
Expected: FAIL with module not found error

**Step 1.3: Create the event-types.ts file with discriminated union**

Create `packages/agent/src/storage/event-types.ts`:

```typescript
// ABOUTME: Type-safe discriminated union for durable event data
// All event types are defined here with their specific data shapes

import type { ToolResult } from '@lace/ent-protocol';

// Content block types used in prompts and messages
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

// Individual event data types
export type PromptEventData = {
  type: 'prompt';
  content: ContentBlock[];
};

export type MessageEventData = {
  type: 'message';
  content: ContentBlock[] | string;
};

export type ToolUseEventData = {
  type: 'tool_use';
  toolCallId: string;
  name: string;
  kind?: string;
  input: Record<string, unknown>;
  result?: ToolResult;
};

export type TurnStartEventData = {
  type: 'turn_start';
};

export type TurnEndEventData = {
  type: 'turn_end';
  stopReason: string;
};

export type ContextCompactedEventData = {
  type: 'context_compacted';
  strategy: string;
  preserved: unknown[];
  summary?: string;
};

export type ContextInjectedEventData = {
  type: 'context_injected';
  content: ContentBlock[];
  priority?: string;
};

export type JobStartedEventData = {
  type: 'job_started';
  jobId: string;
  jobType: 'shell' | 'delegate';
  command?: string;
  description?: string;
  prompt?: string;
};

export type JobFinishedEventData = {
  type: 'job_finished';
  jobId: string;
  outcome: 'completed' | 'failed' | 'cancelled';
  exitCode?: number;
  error?: string;
};

export type JobUpdateEventData = {
  type: 'job_update';
  jobId: string;
  update: Record<string, unknown>;
};

export type JobSessionAssignedEventData = {
  type: 'job_session_assigned';
  jobId: string;
  subagentSessionId: string;
};

export type PermissionRequestedEventData = {
  type: 'permission_requested';
  toolCallId: string;
  turnSeq: number;
  jobId?: string;
  tool: string;
  kind?: string;
  resource: string;
  options: Array<{ optionId: string; label: string }>;
  requestedAt: string;
  input: Record<string, unknown>;
};

export type PermissionDecidedEventData = {
  type: 'permission_decided';
  toolCallId: string;
  turnSeq: number;
  decision?: string;
  updatedInput?: Record<string, unknown>;
};

export type PermissionCancelledEventData = {
  type: 'permission_cancelled';
  toolCallId: string;
  turnSeq: number;
  reason: string;
};

export type CheckpointCreatedEventData = {
  type: 'checkpoint_created';
  checkpointId: string;
  label?: string;
};

export type FilesRewoundEventData = {
  type: 'files_rewound';
  checkpointId: string;
  filesRestored: string[];
};

// The discriminated union of all event data types
export type DurableEventData =
  | PromptEventData
  | MessageEventData
  | ToolUseEventData
  | TurnStartEventData
  | TurnEndEventData
  | ContextCompactedEventData
  | ContextInjectedEventData
  | JobStartedEventData
  | JobFinishedEventData
  | JobUpdateEventData
  | JobSessionAssignedEventData
  | PermissionRequestedEventData
  | PermissionDecidedEventData
  | PermissionCancelledEventData
  | CheckpointCreatedEventData
  | FilesRewoundEventData;

// A typed durable event with proper type narrowing
export type TypedDurableEvent = {
  eventSeq: number;
  timestamp: string;
  turnId?: string;
  turnSeq?: number;
  type: DurableEventData['type'];
  data: DurableEventData;
};

// Type guard to check if event data matches a specific type
export function isEventDataOfType<T extends DurableEventData['type']>(
  data: DurableEventData,
  type: T
): data is Extract<DurableEventData, { type: T }> {
  return data.type === type;
}
```

**Step 1.4: Run test to verify it passes**

Run: `npm test -- --run packages/agent/src/storage/__tests__/event-types.test.ts`
Expected: PASS

**Step 1.5: Update event-log.ts to use new types**

Modify `packages/agent/src/storage/event-log.ts`:

```typescript
// Change import at top of file
import type { DurableEventData, TypedDurableEvent } from './event-types';

// Replace existing DurableEvent type (lines 35-42) with:
export type DurableEvent = {
  eventSeq: number;
  timestamp: string;
  turnId?: string;
  turnSeq?: number;
  type: string;
  data: Record<string, unknown>;
};

// Add typed version for callers that want type safety
export type { TypedDurableEvent, DurableEventData } from './event-types';
```

**Step 1.6: Run full test suite**

Run: `npm test -- --run packages/agent/src/storage/`
Expected: All tests PASS

**Step 1.7: Commit**

```bash
git add packages/agent/src/storage/event-types.ts packages/agent/src/storage/__tests__/event-types.test.ts packages/agent/src/storage/event-log.ts
git commit -m "$(cat <<'EOF'
feat(agent): add DurableEventData discriminated union type

Adds type-safe event data types that enable compile-time narrowing
when accessing event data properties. This is the foundation for
eliminating `as any` casts throughout the codebase.
EOF
)"
```

---

## Task 2: Create Error Classes

**Files:**
- Create: `packages/agent/src/errors/agent-errors.ts`
- Modify: `packages/agent/src/storage/session-store.ts:85-92`
- Modify: `packages/agent/src/rpc/handlers/session.ts:92`
- Test: `packages/agent/src/errors/__tests__/agent-errors.test.ts`

**Step 2.1: Write failing test for error classes**

Create `packages/agent/src/errors/__tests__/agent-errors.test.ts`:

```typescript
// ABOUTME: Tests for typed error classes

import { describe, it, expect } from 'vitest';
import { SessionStorageError, RpcError } from '../agent-errors';

describe('SessionStorageError', () => {
  it('has correct code property', () => {
    const error = new SessionStorageError('Storage failed', '/path/to/sessions');
    expect(error.code).toBe('SessionStorageUnavailable');
    expect(error.path).toBe('/path/to/sessions');
    expect(error.message).toBe('Storage failed');
    expect(error.name).toBe('SessionStorageError');
  });

  it('is instanceof Error', () => {
    const error = new SessionStorageError('Test', '/path');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SessionStorageError);
  });
});

describe('RpcError', () => {
  it('has correct properties', () => {
    const error = new RpcError('Not found', -32602, { category: 'protocol' });
    expect(error.code).toBe(-32602);
    expect(error.data).toEqual({ category: 'protocol' });
    expect(error.message).toBe('Not found');
    expect(error.name).toBe('RpcError');
  });

  it('works without data', () => {
    const error = new RpcError('Simple error', -32600);
    expect(error.code).toBe(-32600);
    expect(error.data).toBeUndefined();
  });
});
```

**Step 2.2: Run test to verify it fails**

Run: `npm test -- --run packages/agent/src/errors/`
Expected: FAIL with module not found error

**Step 2.3: Create the error classes**

Create `packages/agent/src/errors/agent-errors.ts`:

```typescript
// ABOUTME: Typed error classes for agent-specific errors

/**
 * Error thrown when session storage is unavailable.
 * Includes the path that was attempted for debugging.
 */
export class SessionStorageError extends Error {
  readonly code = 'SessionStorageUnavailable' as const;

  constructor(
    message: string,
    public readonly path: string
  ) {
    super(message);
    this.name = 'SessionStorageError';
    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, SessionStorageError);
  }
}

/**
 * Error for RPC protocol errors with structured data.
 */
export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: { category?: string; path?: string; reason?: string }
  ) {
    super(message);
    this.name = 'RpcError';
    Error.captureStackTrace?.(this, RpcError);
  }
}
```

**Step 2.4: Run test to verify it passes**

Run: `npm test -- --run packages/agent/src/errors/`
Expected: PASS

**Step 2.5: Update session-store.ts to use SessionStorageError**

In `packages/agent/src/storage/session-store.ts`, replace lines 85-92:

```typescript
// Add import at top:
import { SessionStorageError } from '../errors/agent-errors';

// Replace the error creation (lines 85-92):
// Before:
//   const msg = lastError instanceof Error ? lastError.message : String(lastError);
//   const e = new Error(`Session storage unavailable: ${msg}`) as Error & {
//     code: string;
//     path: string;
//   };
//   e.code = 'SessionStorageUnavailable';
//   e.path = candidates[0];
//   throw e;

// After:
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new SessionStorageError(`Session storage unavailable: ${msg}`, candidates[0]);
```

**Step 2.6: Run tests to verify storage still works**

Run: `npm test -- --run packages/agent/src/storage/`
Expected: PASS

**Step 2.7: Commit**

```bash
git add packages/agent/src/errors/ packages/agent/src/storage/session-store.ts
git commit -m "$(cat <<'EOF'
feat(agent): add typed error classes

Adds SessionStorageError and RpcError classes with proper typed
properties instead of ad-hoc property assignments via type assertions.
EOF
)"
```

---

## Task 3: Fix ProviderMessage Property Access

**Files:**
- Modify: `packages/agent/src/message-building/message-builder.ts:217-220`
- Test: Existing tests should cover this

**Step 3.1: Read and understand current code**

The issue is at lines 217-220 in message-builder.ts:
```typescript
if ((message as any).toolCalls)
  total += estimateTokens(JSON.stringify((message as any).toolCalls));
if ((message as any).toolResults)
  total += estimateTokens(JSON.stringify((message as any).toolResults));
```

But `ProviderMessage` already has `toolCalls?: ToolCall[]` and `toolResults?: ToolResult[]` defined.

**Step 3.2: Fix the type assertions**

In `packages/agent/src/message-building/message-builder.ts`, replace lines 217-220:

```typescript
// Before:
//     if ((message as any).toolCalls)
//       total += estimateTokens(JSON.stringify((message as any).toolCalls));
//     if ((message as any).toolResults)
//       total += estimateTokens(JSON.stringify((message as any).toolResults));

// After:
    if (message.toolCalls) {
      total += estimateTokens(JSON.stringify(message.toolCalls));
    }
    if (message.toolResults) {
      total += estimateTokens(JSON.stringify(message.toolResults));
    }
```

**Step 3.3: Run tests to verify**

Run: `npm test -- --run packages/agent/src/message-building/`
Expected: PASS

**Step 3.4: Commit**

```bash
git add packages/agent/src/message-building/message-builder.ts
git commit -m "$(cat <<'EOF'
fix(agent): remove unnecessary type assertions in message-builder

ProviderMessage already defines toolCalls and toolResults as optional
properties, so the `as any` casts were unnecessary.
EOF
)"
```

---

## Task 4: Fix permissions-from-events.ts Type Assertions

**Files:**
- Modify: `packages/agent/src/storage/permissions-from-events.ts:35-36`
- Test: Run existing tests

**Step 4.1: Fix toOptions function type assertions**

In `packages/agent/src/storage/permissions-from-events.ts`, replace the `toOptions` function (lines 30-41):

```typescript
// Define the expected shape explicitly
type OptionItem = { optionId?: unknown; label?: unknown };

function toOptions(value: unknown): Array<{ optionId: string; label: string }> | null {
  if (!Array.isArray(value)) return null;
  const parsed: Array<{ optionId: string; label: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const itemObj = item as OptionItem;
    const optionId = toNonEmptyString(itemObj.optionId);
    const label = typeof itemObj.label === 'string' ? itemObj.label : null;
    if (!optionId || label === null) return null;
    parsed.push({ optionId, label });
  }
  return parsed;
}
```

**Step 4.2: Run tests to verify**

Run: `npm test -- --run packages/agent/src/storage/`
Expected: PASS

**Step 4.3: Commit**

```bash
git add packages/agent/src/storage/permissions-from-events.ts
git commit -m "$(cat <<'EOF'
fix(agent): replace any with typed intermediate in permissions-from-events
EOF
)"
```

---

## Task 5: Fix rpc/utils.ts Config Access

**Files:**
- Modify: `packages/agent/src/rpc/utils.ts:67-74`
- Test: `packages/agent/src/rpc/__tests__/utils.test.ts`

**Step 5.1: Fix parseProviderInstanceOverridesFromConnectionConfig**

In `packages/agent/src/rpc/utils.ts`, replace the function body (lines 60-95):

```typescript
export function parseProviderInstanceOverridesFromConnectionConfig(options: {
  displayName: string;
  catalogProviderId: string;
  config: Record<string, unknown>;
}): Partial<Pick<ProviderInstance, 'endpoint' | 'timeout' | 'retryPolicy' | 'modelConfig'>> {
  const endpoint = getEndpointFromConfig(options.config);

  const timeoutInput = options.config.timeout;
  const timeout = timeoutInput === undefined ? undefined : toPositiveInt(timeoutInput);
  if (timeoutInput !== undefined && timeout === null) {
    throwInvalidParams('timeout must be a positive integer');
  }

  const retryPolicy = toNonEmptyString(options.config.retryPolicy) ?? undefined;
  const modelConfigInput = options.config.modelConfig;

  const parsed = ProviderInstanceSchema.safeParse({
    displayName: options.displayName,
    catalogProviderId: options.catalogProviderId,
    ...(endpoint ? { endpoint } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(retryPolicy ? { retryPolicy } : {}),
    ...(modelConfigInput !== undefined ? { modelConfig: modelConfigInput } : {}),
  });

  if (!parsed.success) {
    throwInvalidParams(parsed.error.issues[0]?.message ?? 'Invalid connection config');
  }

  return {
    ...(parsed.data.endpoint ? { endpoint: parsed.data.endpoint } : {}),
    ...(parsed.data.timeout !== undefined ? { timeout: parsed.data.timeout } : {}),
    ...(parsed.data.retryPolicy ? { retryPolicy: parsed.data.retryPolicy } : {}),
    ...(parsed.data.modelConfig ? { modelConfig: parsed.data.modelConfig } : {}),
  };
}
```

**Step 5.2: Run tests to verify**

Run: `npm test -- --run packages/agent/src/rpc/__tests__/utils.test.ts`
Expected: PASS

**Step 5.3: Commit**

```bash
git add packages/agent/src/rpc/utils.ts
git commit -m "$(cat <<'EOF'
fix(agent): remove any casts from rpc/utils config access

Access config properties directly using proper Record<string, unknown>
indexing instead of casting to any.
EOF
)"
```

---

## Task 6: Fix rpc/handlers/connections.ts Credential Values

**Files:**
- Modify: `packages/agent/src/rpc/handlers/connections.ts:258-261`
- Test: Run existing tests

**Step 6.1: Fix credential value extraction**

In `packages/agent/src/rpc/handlers/connections.ts`, replace lines 255-263:

```typescript
// Define expected shape for credential values
type CredentialValues = Record<string, unknown>;

// ... inside the handler:
    const values = parsed?.values;
    if (!values || typeof values !== 'object') return { ok: false, error: 'values is required' };

    const credentialValues = values as CredentialValues;
    const apiKey =
      toNonEmptyString(credentialValues.apiKey) ??
      toNonEmptyString(credentialValues.api_key) ??
      toNonEmptyString(credentialValues.key);
```

**Step 6.2: Run tests to verify**

Run: `npm test -- --run packages/agent/src/rpc/`
Expected: PASS

**Step 6.3: Commit**

```bash
git add packages/agent/src/rpc/handlers/connections.ts
git commit -m "$(cat <<'EOF'
fix(agent): type credential values properly in connections handler
EOF
)"
```

---

## Task 7: Fix rpc/handlers/models.ts Return Type

**Files:**
- Modify: `packages/agent/src/rpc/utils.ts:97-107` (mapCatalogModelToModelInfo)
- Modify: `packages/agent/src/rpc/handlers/models.ts:106`
- Test: Run existing tests

**Step 7.1: Add return type to mapCatalogModelToModelInfo**

In `packages/agent/src/rpc/utils.ts`, update the function:

```typescript
export type ModelInfo = {
  modelId: string;
  name: string;
  providerId: string;
  contextWindow?: number;
  maxOutput?: number;
  supportsThinking: boolean;
  supportsImages: boolean;
  disabled?: boolean;
  disabledState?: 'enabled' | 'disabled';
};

export function mapCatalogModelToModelInfo(model: CatalogModel, providerId: string): ModelInfo {
  return {
    modelId: model.id,
    name: model.name,
    providerId,
    contextWindow: model.context_window,
    maxOutput: model.default_max_tokens,
    supportsThinking: !!model.can_reason || !!model.has_reasoning_effort,
    supportsImages: !!model.supports_attachments,
  };
}
```

**Step 7.2: Update models.ts to use typed return**

In `packages/agent/src/rpc/handlers/models.ts`, replace lines 105-112:

```typescript
// Before:
//     const models = provider.models.map((m) => {
//       const info = mapCatalogModelToModelInfo(m, providerId) as any;
//       const isDisabled = ...
//       info.disabled = isDisabled;
//       info.disabledState = isDisabled ? 'disabled' : 'enabled';
//       return info;
//     });

// After:
    const models = provider.models.map((m) => {
      const info = mapCatalogModelToModelInfo(m, providerId);
      const isDisabled =
        (enabledSet && !enabledSet.has(m.id)) || (disabledSet.size > 0 && disabledSet.has(m.id));
      return {
        ...info,
        disabled: isDisabled,
        disabledState: isDisabled ? 'disabled' as const : 'enabled' as const,
      };
    });
```

**Step 7.3: Run tests to verify**

Run: `npm test -- --run packages/agent/src/rpc/`
Expected: PASS

**Step 7.4: Commit**

```bash
git add packages/agent/src/rpc/utils.ts packages/agent/src/rpc/handlers/models.ts
git commit -m "$(cat <<'EOF'
fix(agent): add return type to mapCatalogModelToModelInfo

Removes need for `as any` cast in models handler by properly typing
the return value and using spread instead of mutation.
EOF
)"
```

---

## Task 8: Fix compact-dropped-messages.ts Type Assertions

**Files:**
- Modify: `packages/agent/src/compaction/compact-dropped-messages.ts:140, 148, 162, 210`
- Test: Run existing tests

**Step 8.1: Fix event.data type assertions in providerMessagesFromLaceEvents**

In `packages/agent/src/compaction/compact-dropped-messages.ts`, update the function at line 121:

```typescript
// Add a type for LaceEvent data shapes
type AgentMessageData = { content?: string } | string;
type ToolCallData = { id?: string; name?: string; arguments?: Record<string, unknown> };
type ToolResultData = { id?: string; content?: unknown[]; status?: string };

function providerMessagesFromLaceEvents(events: LaceEvent[]): ProviderMessage[] {
  const messages: ProviderMessage[] = [];

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;

    if (event.type === 'SYSTEM_PROMPT' || event.type === 'USER_SYSTEM_PROMPT') {
      const content = typeof event.data === 'string' ? event.data : '';
      if (content.trim()) messages.push({ role: 'system', content });
      continue;
    }

    if (event.type === 'USER_MESSAGE') {
      const content = typeof event.data === 'string' ? event.data : '';
      if (content.trim()) messages.push({ role: 'user', content });
      continue;
    }

    if (event.type === 'AGENT_MESSAGE') {
      const data = event.data as AgentMessageData;
      const content =
        typeof data === 'string'
          ? data
          : typeof data?.content === 'string'
            ? data.content
            : '';
      messages.push({ role: 'assistant', content });
      continue;
    }

    if (event.type === 'TOOL_CALL') {
      const toolCall = event.data as ToolCallData;
      if (!toolCall || typeof toolCall !== 'object') continue;

      if (messages.length === 0 || messages[messages.length - 1]!.role !== 'assistant') {
        messages.push({ role: 'assistant', content: '', toolCalls: [toolCall] });
      } else {
        const last = messages[messages.length - 1]!;
        last.toolCalls = [...(last.toolCalls || []), toolCall];
      }

      continue;
    }

    if (event.type === 'TOOL_RESULT') {
      const toolResult = event.data as ToolResultData;
      if (!toolResult || typeof toolResult !== 'object') continue;

      const last = messages[messages.length - 1];
      const canAppendToUser =
        last && last.role === 'user' && last.toolResults && last.toolResults.length > 0;
      if (canAppendToUser) {
        last.toolResults!.push(toolResult);
      } else {
        messages.push({ role: 'user', content: '', toolResults: [toolResult] });
      }

      continue;
    }
  }

  return messages;
}
```

**Step 8.2: Fix compactionEvent.data access at line 210**

```typescript
// Before:
//   const meta = (result.compactionEvent.data as any)?.metadata;

// After (add type guard):
  type CompactionEventMeta = { metadata?: { summary?: string } };
  const eventData = result.compactionEvent.data as CompactionEventMeta | undefined;
  const meta = eventData?.metadata;
  const summary = typeof meta?.summary === 'string' ? meta.summary : undefined;
```

**Step 8.3: Run tests to verify**

Run: `npm test -- --run packages/agent/src/compaction/`
Expected: PASS

**Step 8.4: Commit**

```bash
git add packages/agent/src/compaction/compact-dropped-messages.ts
git commit -m "$(cat <<'EOF'
fix(agent): replace any casts with typed intermediates in compaction
EOF
)"
```

---

## Task 9: Fix message-builder.ts Event Data Access

**Files:**
- Modify: `packages/agent/src/message-building/message-builder.ts:112-168`
- Test: Run existing tests

**Step 9.1: Add typed event data access helpers**

In `packages/agent/src/message-building/message-builder.ts`, add after the imports:

```typescript
// Typed event data shapes for parsing
type ContextInjectedData = { content?: unknown };
type ContextCompactedData = { summary?: string; preserved?: unknown[] };
type MessageData = { content?: string | unknown[] };
type ToolUseData = {
  toolCallId?: string;
  name?: string;
  input?: unknown;
  result?: ToolResult;
};
```

**Step 9.2: Update event parsing to use typed shapes**

Replace the event parsing in `buildProviderMessagesFromDurableEvents` (lines 96-191):

```typescript
  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; data?: Record<string, unknown> };
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      const data = typeof parsed.data === 'object' && parsed.data ? parsed.data : {};

      if (type === 'prompt') {
        const content = extractContentBlocks(data.content);
        const hasContent = typeof content === 'string' ? content.trim() : content.length > 0;
        if (hasContent) messages.push({ role: 'user', content });
        continue;
      }

      if (type === 'context_injected') {
        const eventData = data as ContextInjectedData;
        const contentArr = Array.isArray(eventData.content) ? eventData.content : [];
        const content = extractTextFromContentBlocks(contentArr);
        if (content.trim()) messages.push({ role: 'system', content });
        continue;
      }

      if (type === 'context_compacted') {
        const eventData = data as ContextCompactedData;
        const summary = typeof eventData.summary === 'string' ? eventData.summary : '';
        const preserved = Array.isArray(eventData.preserved) ? eventData.preserved : [];

        messages.length = 0;
        if (summary.trim()) messages.push({ role: 'system', content: summary });

        for (const msg of preserved) {
          if (!msg || typeof msg !== 'object') continue;
          const msgObj = msg as Record<string, unknown>;
          const role = msgObj.role;
          const content = msgObj.content;
          if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
          if (typeof content !== 'string') continue;

          const toolCalls = Array.isArray(msgObj.toolCalls) ? msgObj.toolCalls : undefined;
          const toolResults = Array.isArray(msgObj.toolResults) ? msgObj.toolResults : undefined;

          messages.push({
            role: role as 'user' | 'assistant' | 'system',
            content,
            ...(toolCalls ? { toolCalls } : {}),
            ...(toolResults ? { toolResults } : {}),
          });
        }

        continue;
      }

      if (type === 'message') {
        const eventData = data as MessageData;
        const content =
          typeof eventData.content === 'string'
            ? eventData.content
            : extractTextFromContentBlocks(
                Array.isArray(eventData.content) ? eventData.content : []
              );
        messages.push({ role: 'assistant', content: content ?? '' });
        continue;
      }

      if (type === 'tool_use') {
        const eventData = data as ToolUseData;
        const toolCallId = toNonEmptyString(eventData.toolCallId);
        const name = toNonEmptyString(eventData.name);
        const input = eventData.input;
        const result = eventData.result;
        if (!toolCallId || !name) continue;

        const toolCall: CoreToolCall = {
          id: toolCallId,
          name,
          arguments:
            typeof input === 'object' && input ? (input as Record<string, unknown>) : {},
        };

        if (messages.length === 0 || messages[messages.length - 1]!.role !== 'assistant') {
          messages.push({ role: 'assistant', content: '', toolCalls: [toolCall] });
        } else {
          const last = messages[messages.length - 1]!;
          last.toolCalls = [...(last.toolCalls || []), toolCall];
        }

        if (result) {
          const coreResult = coreToolResultFromProtocol(result, toolCallId);
          const last = messages[messages.length - 1];
          const canAppendToUser =
            last && last.role === 'user' && last.toolResults && last.toolResults.length > 0;
          if (canAppendToUser) {
            last.toolResults!.push(coreResult);
          } else {
            messages.push({ role: 'user', content: '', toolResults: [coreResult] });
          }
        }

        continue;
      }
    } catch {
      // Ignore malformed lines.
    }
  }
```

**Step 9.3: Run tests to verify**

Run: `npm test -- --run packages/agent/src/message-building/`
Expected: PASS

**Step 9.4: Commit**

```bash
git add packages/agent/src/message-building/message-builder.ts
git commit -m "$(cat <<'EOF'
fix(agent): use typed event data shapes in message-builder

Replaces `as any` casts with properly typed intermediate variables
for parsing durable event data.
EOF
)"
```

---

## Task 10: Verify All Production Code is Clean

**Step 10.1: Check for remaining `as any` in production code**

Run: `grep -r "as any" packages/agent/src/ --include="*.ts" | grep -v ".test.ts" | grep -v "__tests__"`

Expected: Should only show:
- `rpc/utils.ts:150` (meta in protocolToolResultFromCore - acceptable, comes from external)

**Step 10.2: Check for inline imports**

Run: `grep -r "import(" packages/agent/src/ --include="*.ts" | grep -v ".test.ts" | grep -v "__tests__" | grep -v "// inline import OK"`

Expected: No results

**Step 10.3: Run full test suite**

Run: `npm test -- --run`
Expected: All tests PASS

**Step 10.4: Run build**

Run: `npm run build`
Expected: Build succeeds with no type errors

**Step 10.5: Final commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(agent): verify type cleanup complete

All `as any` casts removed from production code (except protocol
boundary in rpc/utils.ts). All inline imports eliminated.
EOF
)"
```

---

## Success Metrics

After completing all tasks, verify:

1. `grep -r "as any" packages/agent/src/ --include="*.ts" | grep -v ".test.ts" | grep -v "__tests__" | wc -l` returns 1 or 0
2. `grep -r ": any" packages/agent/src/ --include="*.ts" | grep -v ".test.ts" | grep -v "__tests__" | wc -l` returns 0
3. `grep -r "import(" packages/agent/src/ --include="*.ts" | grep -v ".test.ts" | wc -l` returns 0
4. `npm run build` succeeds
5. `npm test -- --run` passes all tests

---

## Notes

- Tasks 1-2 create foundational types that unblock later fixes
- Tasks 3-9 are independent and can be parallelized with subagents
- Task 10 is a verification step to ensure completeness
- Test file cleanup (Priority 5 from original plan) is deferred - test files are allowed to have `as any` for mocking
