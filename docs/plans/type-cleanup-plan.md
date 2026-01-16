# Type Cleanup Plan

This document outlines the remaining type issues in the agent package and a
prioritized plan to fix them.

## Priority 1: Foundational Types (Unblocks Other Fixes)

### 1.1 Create Discriminated Union for Durable Event Data

**Problem:** Event data is parsed with ad-hoc `(event.data as any)` casts
throughout the codebase. Each event type has different data shapes but there's
no type system enforcement.

**Files affected:**

- `message-building/message-builder.ts` (lines 112-168)
- `compaction/compact-dropped-messages.ts` (lines 140, 148, 162, 210)
- `storage/permissions-from-events.ts` (lines 35-36)
- `jobs/subagent-job.ts` (various)

**Solution:**

```typescript
// In storage/event-types.ts (new file)
export type DurableEventData =
  | { type: 'prompt'; content: unknown[] }
  | { type: 'message'; content: Array<{ type: string; text?: string }> }
  | { type: 'tool_use'; toolCallId: string; name: string; kind: string; input: Record<string, unknown>; result?: ToolResult }
  | { type: 'turn_start' }
  | { type: 'turn_end'; stopReason: string }
  | { type: 'context_compacted'; strategy: string; preserved: unknown[]; summary?: string }
  | { type: 'context_injected'; content: unknown[]; priority: string }
  | { type: 'job_started'; jobId: string; jobType: 'bash' | 'delegate'; ... }
  | { type: 'job_finished'; jobId: string; outcome: string; exitCode?: number }
  | { type: 'job_session_assigned'; jobId: string; subagentSessionId: string }
  | { type: 'permission_requested'; toolCallId: string; ... }
  | { type: 'permission_decided'; toolCallId: string; decision: string; ... }
  | { type: 'checkpoint_created'; checkpointId: string; label?: string }
  | { type: 'files_rewound'; checkpointId: string; filesRestored: string[] }
  // ... etc

export interface DurableEvent {
  eventSeq: number;
  timestamp: string;
  type: DurableEventData['type'];
  data: DurableEventData;
  turnId?: string;
  turnSeq?: number;
}
```

**Effort:** Medium (need to audit all event types, update all consumers)

---

### 1.2 Clean Up ProviderMessage Property Access

**Problem:** `ProviderMessage` already defines `toolCalls` and `toolResults` as
optional properties, but code still uses `(message as any).toolCalls` pattern.

**Files affected:**

- `message-building/message-builder.ts` (lines 217-220)

**Solution:** Simply remove the unnecessary `as any` casts and use optional
chaining:

```typescript
// Before
if ((message as any).toolCalls) { ... }

// After
if (message.toolCalls) { ... }
```

**Effort:** Low (mechanical replacement)

---

## Priority 2: Config and Error Types

### 2.1 Strengthen SessionState.config Type

**Problem:** `SessionState.config` is optional with all optional properties,
leading to defensive `as any` casts when accessing nested properties like
`mcpServers`, `environment`.

**Files affected:**

- `rpc/handlers/session-operations.ts` (various)
- `rpc/utils.ts` (lines 67, 73-74)

**Solution:** Create a non-optional config type with defaults:

```typescript
// In storage/session-store.ts
export type SessionConfig = {
  executionMode: 'plan' | 'execute';
  approvalMode: ApprovalMode;
  connectionId?: string;
  modelId?: string;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  environment: Record<string, string>;
  mcpServers: McpServerConfig[];
};

// Helper to get config with defaults
export function getSessionConfig(state: SessionState): SessionConfig {
  return {
    executionMode: state.config?.executionMode ?? 'execute',
    approvalMode: state.config?.approvalMode ?? 'ask',
    connectionId: state.config?.connectionId,
    modelId: state.config?.modelId,
    maxBudgetUsd: state.config?.maxBudgetUsd,
    maxThinkingTokens: state.config?.maxThinkingTokens,
    environment: state.config?.environment ?? {},
    mcpServers: state.config?.mcpServers ?? [],
  };
}
```

**Effort:** Medium (need to update all config access patterns)

---

### 2.2 Create Proper Error Classes

**Problem:** Custom errors add properties like `code`, `path` using ad-hoc type
assertions.

**Files affected:**

- `storage/session-store.ts` (line 86)
- `jobs/subagent-job.ts` (lines 554-556)
- `rpc/handlers/session.ts` (line 92)

**Solution:**

```typescript
// In errors/agent-errors.ts (new file)
export class SessionStorageError extends Error {
  readonly code = 'SessionStorageUnavailable';
  constructor(
    message: string,
    public readonly path: string
  ) {
    super(message);
    this.name = 'SessionStorageError';
  }
}

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: { category?: string; path?: string }
  ) {
    super(message);
    this.name = 'RpcError';
  }
}
```

**Effort:** Low-Medium (create classes, update throw sites)

---

### 2.3 Create Permission Request/Response Types

**Problem:** Permission payloads are typed ad-hoc in multiple places.

**Files affected:**

- `rpc/permissions.ts`
- `jobs/subagent-job.ts` (lines 406-412, 463-468)
- `storage/permissions-from-events.ts`

**Solution:**

```typescript
// In rpc/permission-types.ts (new file)
export interface PermissionRequestPayload {
  sessionId: string;
  turnId: string;
  turnSeq: number;
  jobId?: string;
  toolCallId: string;
  tool: string;
  kind: string;
  resource: string;
  options: Array<{ optionId: string; label: string }>;
  input: Record<string, unknown>;
  requestedAt?: string;
}

export interface PermissionResponsePayload {
  decision: string;
  updatedInput?: Record<string, unknown>;
}

export interface PermissionUpdatePayload {
  toolCallId: string;
  name: string;
  kind?: string;
  input: Record<string, unknown>;
  status:
    | 'pending'
    | 'awaiting_permission'
    | 'running'
    | 'completed'
    | 'denied'
    | 'cancelled'
    | 'failed';
  result?: ToolResult;
  options?: Array<{ optionId: string; label: string }>;
}
```

**Effort:** Medium (define types, update all permission handling code)

---

## Priority 3: Tool System Improvements

### 3.1 Move Todo Tools to Standard Execution Path

**Problem:** `todo_read` and `todo_write` are special-cased in runner.ts because
they need `sessionDir` which isn't in ToolContext.

**Files affected:**

- `core/conversation/runner.ts` (executeToolByName method)
- `tools/implementations/todo_read.ts`
- `tools/implementations/todo_write.ts`

**Solution:** Add `sessionDir` to ToolContext and update todo tools to use it:

```typescript
// In tools/types.ts - add to ToolContext
sessionDir?: string;

// In runner.ts - pass sessionDir in context
toolContext = { ...toolContext, sessionDir: this.config.sessionDir };

// In todo tools - use context.sessionDir instead of dedicated todoContext
```

**Effort:** Low (add one property, update two tools)

---

### 3.2 Implement Background Mode in BashTool

**Problem:** `bash` with `background=true` is special-cased in runner.ts before
the permission check. BashTool.executeValidated() doesn't handle background
mode.

**Files affected:**

- `core/conversation/runner.ts` (lines 431-493)
- `tools/implementations/bash.ts`

**Solution:** Move background job creation into BashTool.executeValidated():

```typescript
// BashTool needs access to JobManager (already in context)
// and needs to create jobs instead of executing directly

protected async executeValidated(args: BashArgs, context: ToolContext): Promise<ToolResult> {
  if (args.background) {
    if (!context.jobManager) {
      return this.createError('Background mode requires jobManager in context');
    }
    const { jobId } = await context.jobManager.createJob('shell', {
      command: args.command,
      description: args.description,
      turnContext: context.turnId && context.turnSeq !== undefined
        ? { turnId: context.turnId, turnSeq: context.turnSeq }
        : undefined,
    });
    return this.createResult(JSON.stringify({ jobId, status: 'started' }));
  }
  // ... existing foreground execution
}
```

**Effort:** Medium (need to handle permission flow for background jobs)

---

## Priority 4: Individual File Fixes

### 4.1 Fix rpc/handlers/connections.ts

**Problem:** API key extraction uses `(values as any).apiKey`

**Solution:** Define expected credential value shapes per provider type.

**Effort:** Low

---

### 4.2 Fix rpc/handlers/models.ts

**Problem:** `mapCatalogModelToModelInfo(m, providerId) as any`

**Solution:** Fix return type of `mapCatalogModelToModelInfo` to match expected
interface.

**Effort:** Low

---

### 4.3 Fix rpc/utils.ts Config Access

**Problem:** Lines 67, 73-74 access config properties with `as any`

**Solution:** Define proper type for the config parameter or use type guards.

**Effort:** Low

---

### 4.4 Fix providers/openai-provider.ts Monkey Patch

**Problem:** Line 156 monkey-patches readFileSync with `any` types

**Solution:** Use proper function signature types for the patch.

**Effort:** Low (but fragile code - consider if there's a better approach)

---

## Priority 5: Test File Cleanup (Optional)

### 5.1 Create Proper Mock Types

**Problem:** Test files use inline `as any` casts for mocks.

**Files affected:**

- `mcp/tool-registry.test.ts`
- `tools/executor.test.ts`
- `tools/tool-catalog.test.ts`
- `providers/openrouter/dynamic-provider.test.ts`
- Various e2e tests

**Solution:** Create typed mock factories:

```typescript
// In test-utils/mock-factories.ts
export function createMockTool(overrides?: Partial<Tool>): Tool {
  return {
    name: 'mock-tool',
    description: 'A mock tool',
    schema: z.object({}),
    execute: vi.fn(),
    ...overrides,
  };
}
```

**Effort:** Medium (many test files to update)

---

## Implementation Order

1. **Week 1:** Priority 1 (Event types, ProviderMessage cleanup)
2. **Week 2:** Priority 2 (Config types, Error classes, Permission types)
3. **Week 3:** Priority 3 (Todo tools, Bash background)
4. **Week 4:** Priority 4 (Individual file fixes)
5. **Optional:** Priority 5 (Test cleanup)

## Success Metrics

- `grep -r "as any" src/` returns only test files
- `grep -r ": any" src/` returns only test files
- No inline `import()` in production code
- All event data access is type-safe
- Build passes with `strict: true` and no type errors
