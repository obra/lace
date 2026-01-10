# Dissolve @lace/core into @lace/agent

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Eliminate `packages/core` by moving all execution-related code into
`packages/agent`, making the agent a fully standalone unit that speaks Ent
protocol.

**Architecture:** The agent becomes self-contained with tools, providers, MCP,
workspace, and all execution logic. The supervisor and web communicate with
agents exclusively via Ent protocol. Types needed by web come from
`@lace/ent-protocol`. No package imports `@lace/core` because it no longer
exists.

**Tech Stack:** TypeScript, Ent protocol (JSON-RPC 2.0), Zod schemas

---

## Current State Analysis

### What's in `packages/core/src/`:

| Directory           | Purpose                                 | Destination                                  |
| ------------------- | --------------------------------------- | -------------------------------------------- |
| `tools/`            | Tool implementations, executor, schemas | → `packages/agent`                           |
| `providers/`        | Provider registry, catalog, instances   | → `packages/agent`                           |
| `mcp/`              | MCP server management                   | → `packages/agent`                           |
| `workspace/`        | Container and workspace management      | → `packages/agent`                           |
| `containers/`       | Container utilities                     | → `packages/agent`                           |
| `config/`           | Lace dir, MCP config, personas          | → `packages/agent`                           |
| `threads/`          | Types + compaction (partial)            | Types → `ent-protocol`, compaction → `agent` |
| `token-management/` | Token counting                          | → `packages/agent`                           |
| `utils/`            | Logger, token estimation                | → `packages/agent` (or inline)               |
| `helpers/`          | Infrastructure helpers                  | → `packages/agent`                           |
| `projects/`         | Project management                      | → `packages/agent`                           |
| `test-utils/`       | Test utilities                          | → each package owns its own                  |
| `agents/`           | Empty after refactor                    | Delete                                       |
| `sessions/`         | Empty after refactor                    | Delete                                       |
| `persistence/`      | Empty after refactor                    | Delete                                       |
| `tasks/`            | Empty after refactor                    | Delete                                       |

### Protocol Extensions Required

For web to work without importing agent code, these protocol methods are needed:

**Already implemented:**

- `ent/providers/list` - provider families
- `ent/connections/*` - connection CRUD
- `ent/connections/credentials/*` - credential management
- `ent/models/list` - models per connection

**Need to add:**

- `ent/tools/list` - list available tools and their schemas
- `ent/mcp/servers/list` - list MCP server configurations
- `ent/mcp/servers/upsert` - add/update MCP server
- `ent/mcp/servers/delete` - remove MCP server
- `ent/mcp/servers/test` - test MCP server connection
- `ent/mcp/tools/list` - list tools from MCP servers
- `ent/workspace/info` - get workspace info
- `ent/workspace/create` - create workspace container
- `ent/personas/list` - list available personas

### Web Package Changes

Web currently imports ~40 things from core. After dissolution:

| Current Import                               | New Source                           |
| -------------------------------------------- | ------------------------------------ |
| Type definitions (ToolCall, LaceEvent, etc.) | `@lace/ent-protocol`                 |
| `logger`                                     | Local logger or supervisor's logging |
| `ProviderRegistry`, `ToolCatalog`, etc.      | Via supervisor → protocol calls      |
| Test utilities                               | Local test utilities                 |

---

## Implementation Phases

### Phase 1: Move Code to Agent (No Protocol Changes)

Move all execution code from core → agent. Agent continues to work. Web
temporarily broken (acceptable during migration).

### Phase 2: Add Protocol Methods

Add new Ent protocol methods for tools, MCP, workspace, personas. Agent
implements handlers. Also fix missing `ent/models/refresh` handler.

### Phase 3: Update Supervisor

Supervisor exposes HTTP endpoints that proxy to new protocol methods.

### Phase 4: Fix Web

Web calls supervisor HTTP endpoints instead of importing core.

### Phase 5: Delete Core

Remove `packages/core` entirely.

### Phase 6: Restore Critical Test Coverage

Add tests for retry logic, token management, abort handling, auto-compaction,
and web full-flow that were deleted during refactoring.

---

## Phase 1: Move Code to Agent

### Task 1.1: Create Agent Directory Structure

**Files:**

- Create: `packages/agent/src/tools/` (directory)
- Create: `packages/agent/src/providers/` (directory)
- Create: `packages/agent/src/mcp/` (directory)
- Create: `packages/agent/src/workspace/` (directory)
- Create: `packages/agent/src/utils/` (directory)

**Step 1: Create directories**

```bash
mkdir -p packages/agent/src/tools
mkdir -p packages/agent/src/providers
mkdir -p packages/agent/src/mcp
mkdir -p packages/agent/src/workspace
mkdir -p packages/agent/src/utils
```

**Step 2: Commit**

```bash
git add packages/agent/src/
git commit -m "chore(agent): create directory structure for core dissolution"
```

---

### Task 1.2: Move Tools Package

**Files:**

- Move: `packages/core/src/tools/` → `packages/agent/src/tools/`
- Update: `packages/agent/src/server.ts` (change imports)

**Step 1: Copy tools directory**

```bash
cp -r packages/core/src/tools/* packages/agent/src/tools/
```

**Step 2: Update internal imports in tools/**

All imports like `from '@lace/core/...'` need to become relative imports or
`from '@lace/agent/...'`.

Files to update:

- `packages/agent/src/tools/executor.ts`
- `packages/agent/src/tools/tool.ts`
- `packages/agent/src/tools/tool-catalog.ts`
- `packages/agent/src/tools/implementations/*.ts` (all tool implementations)

**Step 3: Update server.ts imports**

Change:

```typescript
import { ToolExecutor } from '@lace/core/tools/executor';
import type { Tool as CoreTool } from '@lace/core/tools/tool';
import { ... } from '@lace/core/tools/types';
```

To:

```typescript
import { ToolExecutor } from './tools/executor';
import type { Tool } from './tools/tool';
import { ... } from './tools/types';
```

**Step 4: Run tests**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 5: Commit**

```bash
git add packages/agent/src/tools/ packages/agent/src/server.ts
git commit -m "feat(agent): move tools from core to agent"
```

---

### Task 1.3: Move Providers Package

**Files:**

- Move: `packages/core/src/providers/` → `packages/agent/src/providers/`
- Update: `packages/agent/src/server.ts`

**Step 1: Copy providers directory**

```bash
cp -r packages/core/src/providers/* packages/agent/src/providers/
```

**Step 2: Update internal imports**

Files to update:

- All files in `packages/agent/src/providers/`
- Provider implementations: `anthropic.ts`, `openai.ts`, `lmstudio.ts`,
  `ollama.ts`, `openrouter/`

**Step 3: Update server.ts imports**

Change all `@lace/core/providers/...` to `./providers/...`

**Step 4: Run tests**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 5: Commit**

```bash
git add packages/agent/src/providers/ packages/agent/src/server.ts
git commit -m "feat(agent): move providers from core to agent"
```

---

### Task 1.4: Move MCP Package

**Files:**

- Move: `packages/core/src/mcp/` → `packages/agent/src/mcp/`
- Update: `packages/agent/src/server.ts`

**Step 1: Copy MCP directory**

```bash
cp -r packages/core/src/mcp/* packages/agent/src/mcp/
```

**Step 2: Update internal imports**

**Step 3: Update server.ts imports**

Change `@lace/core/mcp/...` to `./mcp/...`

**Step 4: Run tests**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 5: Commit**

```bash
git add packages/agent/src/mcp/ packages/agent/src/server.ts
git commit -m "feat(agent): move MCP from core to agent"
```

---

### Task 1.5: Move Workspace and Containers

**Files:**

- Move: `packages/core/src/workspace/` → `packages/agent/src/workspace/`
- Move: `packages/core/src/containers/` → `packages/agent/src/containers/`

**Step 1: Copy directories**

```bash
cp -r packages/core/src/workspace/* packages/agent/src/workspace/
cp -r packages/core/src/containers/* packages/agent/src/containers/
```

**Step 2: Update internal imports**

**Step 3: Run tests**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 4: Commit**

```bash
git add packages/agent/src/workspace/ packages/agent/src/containers/
git commit -m "feat(agent): move workspace and containers from core to agent"
```

---

### Task 1.6: Move Config Package

**Files:**

- Move: `packages/core/src/config/` → `packages/agent/src/config/`
- Update: existing `packages/agent/src/config/lace-dir.ts`

**Step 1: Copy config directory**

Note: Agent already has `config/lace-dir.ts` that re-exports from core. Replace
with actual implementation.

```bash
cp -r packages/core/src/config/* packages/agent/src/config/
```

**Step 2: Update internal imports**

**Step 3: Run tests**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 4: Commit**

```bash
git add packages/agent/src/config/
git commit -m "feat(agent): move config from core to agent"
```

---

### Task 1.7: Move Utils Package

**Files:**

- Move: `packages/core/src/utils/` → `packages/agent/src/utils/`

**Step 1: Copy utils directory**

```bash
cp -r packages/core/src/utils/* packages/agent/src/utils/
```

**Step 2: Update server.ts**

Change `@lace/core/utils/...` to `./utils/...`

**Step 3: Run tests**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 4: Commit**

```bash
git add packages/agent/src/utils/
git commit -m "feat(agent): move utils from core to agent"
```

---

### Task 1.8: Move Token Management

**Files:**

- Move: `packages/core/src/token-management/` →
  `packages/agent/src/token-management/`

**Step 1: Copy directory**

```bash
cp -r packages/core/src/token-management/* packages/agent/src/token-management/
```

**Step 2: Update imports in server.ts and elsewhere**

**Step 3: Run tests**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 4: Commit**

```bash
git add packages/agent/src/token-management/
git commit -m "feat(agent): move token-management from core to agent"
```

---

### Task 1.9: Move Helpers Package

**Files:**

- Move: `packages/core/src/helpers/` → `packages/agent/src/helpers/`

**Step 1: Copy directory**

```bash
cp -r packages/core/src/helpers/* packages/agent/src/helpers/
```

**Step 2: Update internal imports**

**Step 3: Run tests**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 4: Commit**

```bash
git add packages/agent/src/helpers/
git commit -m "feat(agent): move helpers from core to agent"
```

---

### Task 1.10: Move Projects Package

**Files:**

- Move: `packages/core/src/projects/` → `packages/agent/src/projects/`

**Step 1: Copy directory**

```bash
cp -r packages/core/src/projects/* packages/agent/src/projects/
```

**Step 2: Update internal imports**

**Step 3: Run tests**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 4: Commit**

```bash
git add packages/agent/src/projects/
git commit -m "feat(agent): move projects from core to agent"
```

---

### Task 1.11: Move Remaining Compaction Code

**Files:**

- Move: `packages/core/src/threads/compaction/` →
  `packages/agent/src/compaction/strategies/`
- Update: `packages/agent/src/compaction/compact-dropped-messages.ts`

**Step 1: Copy compaction strategies**

```bash
cp packages/core/src/threads/compaction/*.ts packages/agent/src/compaction/
```

**Step 2: Update compact-dropped-messages.ts**

Remove imports from `@lace/core/threads/compaction/` and use local files.

**Step 3: Run tests**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 4: Commit**

```bash
git add packages/agent/src/compaction/
git commit -m "feat(agent): move compaction strategies from core to agent"
```

---

### Task 1.12: Move Types to ent-protocol

**Files:**

- Update: `packages/ent-protocol/src/types/` with shared types
- Types to move: `LaceEvent`, `LaceEventType`, `ToolCall`, `ToolResult`,
  `ProviderInfo`, `ModelInfo`

**Step 1: Identify types needed by web**

From web's `types/core.ts`:

- `LaceEvent`, `LaceEventType`, `ErrorType`, `ErrorPhase`, `AgentErrorData`
- `ToolCall`, `ToolResult`, `ToolAnnotations`, `ToolPolicy`, `ApprovalDecision`
- `ProviderInfo`, `ProviderResponse`, `ModelInfo`
- `ProjectInfo`
- `MCPServerConfig`, `DiscoveredTool`, `MCPConfig`
- `CompactionData`
- `PersonaInfo`
- `WorkspaceInfo`

**Step 2: Add these to ent-protocol schemas**

Create: `packages/ent-protocol/src/types/shared.ts`

**Step 3: Update ent-protocol exports**

**Step 4: Run tests**

```bash
npm run typecheck --workspace=packages/ent-protocol
npm test --workspace=packages/ent-protocol
```

**Step 5: Commit**

```bash
git add packages/ent-protocol/src/types/
git commit -m "feat(ent-protocol): add shared types for tool, provider, workspace"
```

---

### Task 1.13: Remove Core Dependency from Agent

**Files:**

- Update: `packages/agent/package.json`

**Step 1: Remove @lace/core from dependencies**

```json
{
  "dependencies": {
    "@lace/ent-protocol": "file:../ent-protocol"
    // Remove: "@lace/core": "file:../core"
  }
}
```

**Step 2: Run full build and test**

```bash
npm run build --workspace=packages/agent
npm test --workspace=packages/agent
```

**Step 3: Commit**

```bash
git add packages/agent/package.json
git commit -m "chore(agent): remove @lace/core dependency"
```

---

## Phase 2: Add Protocol Methods

### Task 2.1: Add Tool Protocol Methods

**Files:**

- Update: `packages/ent-protocol/src/schemas/methods.ts`
- Update: `packages/agent/src/server.ts`

**Add schemas:**

```typescript
// ent/tools/list
const EntToolsListParamsSchema = z.object({}).strict();
const EntToolsListResultSchema = z
  .object({
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        schema: z.record(z.string(), z.unknown()), // JSON Schema
        category: z.string().optional(),
        requiresApproval: z.boolean(),
      })
    ),
  })
  .strict();
```

**Add handler in server.ts:**

```typescript
peer.onRequest('ent/tools/list', async () => {
  const tools = toolExecutor.getAllTools();
  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.getJsonSchema(),
      category: t.category,
      requiresApproval: t.requiresApproval,
    })),
  };
});
```

**Test and commit.**

---

### Task 2.2: Add MCP Protocol Methods

**Files:**

- Update: `packages/ent-protocol/src/schemas/methods.ts`
- Update: `packages/agent/src/server.ts`

**Add schemas for:**

- `ent/mcp/servers/list`
- `ent/mcp/servers/upsert`
- `ent/mcp/servers/delete`
- `ent/mcp/servers/test`
- `ent/mcp/tools/list`

**Add handlers in server.ts.**

**Test and commit.**

---

### Task 2.3: Add Workspace Protocol Methods

**Files:**

- Update: `packages/ent-protocol/src/schemas/methods.ts`
- Update: `packages/agent/src/server.ts`

**Add schemas for:**

- `ent/workspace/info`
- `ent/workspace/create`

**Add handlers in server.ts.**

**Test and commit.**

---

### Task 2.4: Add Persona Protocol Methods

**Files:**

- Update: `packages/ent-protocol/src/schemas/methods.ts`
- Update: `packages/agent/src/server.ts`

**Add schemas for:**

- `ent/personas/list`

**Add handlers in server.ts.**

**Test and commit.**

---

### Task 2.5: Add Missing `ent/models/refresh` Handler

**Files:**

- Update: `packages/agent/src/server.ts`

**Note:** Schema already exists in
`packages/ent-protocol/src/schemas/methods.ts` (lines 964-979). Only the handler
is missing.

**Add handler in server.ts:**

```typescript
peer.onRequest('ent/models/refresh', async (params: unknown) => {
  assertInitialized(state);
  const parsed = EntModelsRefreshParamsSchema.parse(params);

  const instance = providerInstanceManager.getInstance(parsed.connectionId);
  if (!instance) {
    throw {
      code: AcpErrorCodes.ConnectionNotFound,
      message: 'ConnectionNotFound',
    };
  }

  const provider = providerRegistry.getProvider(instance.catalogProviderId);
  if (!provider) {
    throw { code: AcpErrorCodes.InvalidParams, message: 'Provider not found' };
  }

  // Refresh the model catalog
  const models = await provider.listModels(instance);

  return {
    connectionId: parsed.connectionId,
    models: models.map((m) => ({
      modelId: m.id,
      name: m.name,
      description: m.description,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
    })),
  };
});
```

**Test:**

```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

**Commit:**

```bash
git add packages/agent/src/server.ts
git commit -m "feat(agent): add ent/models/refresh handler"
```

---

## Phase 3: Update Supervisor

### Task 3.1: Add Supervisor HTTP Endpoints for New Protocol Methods

**Files:**

- Update: `packages/supervisor/src/http/server.ts`

For each new protocol method, add corresponding HTTP endpoint that proxies to
agent.

**Pattern:**

```typescript
app.get('/api/tools', async (req, res) => {
  const agentPeer = getAgentPeer(req.sessionId);
  const result = await agentPeer.request('ent/tools/list', {});
  res.json(result);
});
```

**Test and commit.**

---

## Phase 4: Fix Web

### Task 4.1: Update Web Types

**Files:**

- Update: `packages/web/types/core.ts` → rename to `types/protocol.ts`
- Update all imports to use `@lace/ent-protocol` types

**Step 1: Replace core type imports**

Change:

```typescript
import type { ToolCall } from '@lace/core/tools/types';
```

To:

```typescript
import type { ToolCall } from '@lace/ent-protocol';
```

**Test and commit.**

---

### Task 4.2: Remove Runtime Core Imports from Web

**Files:**

- Delete: `packages/web/lib/server/lace-imports.ts`
- Update: `packages/web/app/routes/api.provider.catalog.ts`
- Update: `packages/web/app/routes/api.mcp.servers.ts`
- Update: `packages/web/app/routes/api.mcp.servers.$serverId.ts`

**Replace direct core imports with supervisor HTTP calls.**

**Test and commit.**

---

### Task 4.3: Create Web-Local Logger

**Files:**

- Create: `packages/web/lib/logger.ts`
- Update: 9 files that import `@lace/core/utils/logger`

**Step 1: Create simple logger**

```typescript
// packages/web/lib/logger.ts
export const logger = {
  debug: (...args: unknown[]) => console.debug('[web]', ...args),
  info: (...args: unknown[]) => console.info('[web]', ...args),
  warn: (...args: unknown[]) => console.warn('[web]', ...args),
  error: (...args: unknown[]) => console.error('[web]', ...args),
};
```

**Step 2: Update all imports**

**Test and commit.**

---

### Task 4.4: Remove Core Dependency from Web

**Files:**

- Update: `packages/web/package.json`

**Step 1: Remove @lace/core from dependencies**

**Step 2: Run full build and test**

```bash
npm run build --workspace=packages/web
npm test --workspace=packages/web
```

**Step 3: Commit**

```bash
git add packages/web/package.json
git commit -m "chore(web): remove @lace/core dependency"
```

---

## Phase 5: Delete Core

### Task 5.1: Remove Core Package

**Files:**

- Delete: `packages/core/` (entire directory)
- Update: root `package.json` (remove from workspaces if needed)
- Update: `tsconfig.json` references

**Step 1: Delete core package**

```bash
rm -rf packages/core
```

**Step 2: Update root package.json**

Remove any references to `packages/core` from scripts.

**Step 3: Run full monorepo build**

```bash
npm run build
npm test
npm run typecheck
npm run lint
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove @lace/core package - agent is now standalone"
```

---

## Phase 6: Restore Critical Test Coverage

These tests were deleted during the refactoring and need to be restored in the
new architecture.

### Task 6.1: Add Retry Logic Tests (HIGH Priority)

**Files:**

- Create: `packages/agent/src/__tests__/agent-process.retry.e2e.test.ts`

**Test scenarios:**

```typescript
describe('agent retry behavior', () => {
  it('retries on provider rate limit error', async () => {
    // Setup: Mock provider to return 429 on first call, success on second
    // Action: Send prompt
    // Assert: Turn completes successfully after retry
    // Assert: Appropriate backoff delay occurred
  });

  it('retries on provider temporary error (5xx)', async () => {
    // Setup: Mock provider to return 500 on first call, success on second
    // Action: Send prompt
    // Assert: Turn completes successfully after retry
  });

  it('fails after max retries exceeded', async () => {
    // Setup: Mock provider to always return 429
    // Action: Send prompt
    // Assert: Turn fails with appropriate error
    // Assert: Correct number of retries attempted
  });

  it('does not retry on non-retryable errors (4xx)', async () => {
    // Setup: Mock provider to return 400
    // Action: Send prompt
    // Assert: Turn fails immediately without retry
  });

  it('preserves conversation state after successful retry', async () => {
    // Setup: Mock provider to fail then succeed
    // Action: Send prompt
    // Assert: Events are correctly sequenced
    // Assert: No duplicate events from retry
  });
});
```

**Run tests:**

```bash
npm test --workspace=packages/agent -- --run agent-process.retry
```

**Commit:**

```bash
git add packages/agent/src/__tests__/agent-process.retry.e2e.test.ts
git commit -m "test(agent): add retry logic e2e tests"
```

---

### Task 6.2: Add Token Management Tests (HIGH Priority)

**Files:**

- Create: `packages/agent/src/__tests__/agent-process.tokens.e2e.test.ts`

**Test scenarios:**

```typescript
describe('agent token management', () => {
  it('tracks token usage across turns', async () => {
    // Action: Send multiple prompts
    // Assert: usage.totalTokens increases correctly
    // Assert: session/update includes usage deltas
  });

  it('enforces maxBudgetUsd limit', async () => {
    // Setup: Configure low maxBudgetUsd
    // Action: Send prompts until budget exceeded
    // Assert: Agent stops with budget exhaustion error
    // Assert: No further LLM calls after budget hit
  });

  it('reports token counts in ent/agent/status', async () => {
    // Action: Send prompt, check status
    // Assert: status includes accurate token counts
  });

  it('counts tokens correctly for tool calls', async () => {
    // Action: Send prompt that triggers tool use
    // Assert: Tool call tokens counted in usage
    // Assert: Tool result tokens counted in usage
  });

  it('estimates context size for compaction decisions', async () => {
    // Action: Build up conversation to near context limit
    // Assert: Agent can report context utilization
    // Assert: Auto-compaction triggers at threshold (if implemented)
  });
});
```

**Run tests:**

```bash
npm test --workspace=packages/agent -- --run agent-process.tokens
```

**Commit:**

```bash
git add packages/agent/src/__tests__/agent-process.tokens.e2e.test.ts
git commit -m "test(agent): add token management e2e tests"
```

---

### Task 6.3: Add Abort Reliability Tests (MEDIUM Priority)

**Files:**

- Create: `packages/agent/src/__tests__/agent-process.abort.e2e.test.ts`

**Test scenarios:**

```typescript
describe('agent abort reliability', () => {
  it('aborts cleanly during LLM streaming', async () => {
    // Setup: Start a prompt that will stream for a while
    // Action: Send session/cancel mid-stream
    // Assert: Turn ends with cancelled status
    // Assert: No partial events left dangling
  });

  it('aborts cleanly during tool execution', async () => {
    // Setup: Trigger a slow tool (e.g., long-running bash)
    // Action: Send session/cancel during execution
    // Assert: Tool marked as cancelled
    // Assert: Turn ends cleanly
  });

  it('aborts cleanly while awaiting permission', async () => {
    // Setup: Trigger tool requiring permission
    // Action: Send session/cancel instead of approval
    // Assert: Permission request cancelled
    // Assert: Turn ends cleanly
  });

  it('handles abort when no turn is active', async () => {
    // Setup: Agent is idle
    // Action: Send session/cancel
    // Assert: No error, no-op
  });

  it('cleans up resources on abort', async () => {
    // Setup: Start prompt with tool that creates temp files
    // Action: Abort mid-execution
    // Assert: Temp resources cleaned up
  });

  it('allows new turn after abort', async () => {
    // Setup: Start and abort a turn
    // Action: Send new prompt
    // Assert: New turn starts cleanly
    // Assert: Event sequence continues correctly
  });
});
```

**Run tests:**

```bash
npm test --workspace=packages/agent -- --run agent-process.abort
```

**Commit:**

```bash
git add packages/agent/src/__tests__/agent-process.abort.e2e.test.ts
git commit -m "test(agent): add abort reliability e2e tests"
```

---

### Task 6.4: Add Auto-Compaction Tests (MEDIUM Priority)

**Files:**

- Create: `packages/agent/src/__tests__/agent-process.auto-compact.e2e.test.ts`

**Test scenarios:**

```typescript
describe('agent auto-compaction', () => {
  it('triggers compaction when context approaches limit', async () => {
    // Setup: Configure low context threshold
    // Action: Send many prompts to build up context
    // Assert: Compaction triggered automatically
    // Assert: Context size reduced
    // Assert: Conversation remains coherent
  });

  it('preserves essential context after compaction', async () => {
    // Setup: Establish important facts in conversation
    // Action: Trigger compaction
    // Action: Ask about previously established facts
    // Assert: Agent recalls compacted information
  });

  it('emits compaction events', async () => {
    // Action: Trigger compaction
    // Assert: session/update includes compaction notification
    // Assert: ent/session/events includes compaction event
  });

  it('handles compaction failure gracefully', async () => {
    // Setup: Mock compaction to fail
    // Action: Trigger compaction threshold
    // Assert: Agent continues without crash
    // Assert: Appropriate error reported
  });
});
```

**Run tests:**

```bash
npm test --workspace=packages/agent -- --run agent-process.auto-compact
```

**Commit:**

```bash
git add packages/agent/src/__tests__/agent-process.auto-compact.e2e.test.ts
git commit -m "test(agent): add auto-compaction e2e tests"
```

---

### Task 6.5: Add Web Full-Flow Integration Test (MEDIUM Priority)

**Files:**

- Create: `packages/web/app/__tests__/full-flow.e2e.test.ts`

**Test scenarios:**

```typescript
describe('web full flow integration', () => {
  it('completes prompt -> response flow through supervisor', async () => {
    // Setup: Start supervisor with agent
    // Action: Web sends prompt via supervisor HTTP
    // Assert: Receives streaming updates
    // Assert: Turn completes successfully
    // Assert: Response displayed correctly
  });

  it('handles tool approval flow end-to-end', async () => {
    // Setup: Start supervisor with agent
    // Action: Send prompt that requires tool approval
    // Assert: Permission request surfaces to web
    // Action: Approve via supervisor HTTP
    // Assert: Tool executes
    // Assert: Turn completes
  });

  it('handles agent errors gracefully', async () => {
    // Setup: Configure agent to fail
    // Action: Send prompt
    // Assert: Error surfaces to web correctly
    // Assert: UI state is consistent
  });

  it('reconnects and restores state after supervisor restart', async () => {
    // Setup: Establish session with history
    // Action: Restart supervisor
    // Action: Reconnect from web
    // Assert: History restored via ent/session/events
    // Assert: Pending approvals restored
  });
});
```

**Run tests:**

```bash
npm test --workspace=packages/web -- --run full-flow
```

**Commit:**

```bash
git add packages/web/app/__tests__/full-flow.e2e.test.ts
git commit -m "test(web): add full-flow e2e integration test"
```

---

## Verification Checklist

After completing all phases:

### Build & Lint

- [ ] `npm run build` succeeds for all packages
- [ ] `npm test` passes for all packages
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

### Architecture

- [ ] No package imports from `@lace/core`
- [ ] Agent can run standalone: `npx lace-agent`
- [ ] CLI can talk to agent: `npx lace --new`
- [ ] Web works through supervisor
- [ ] All protocol methods work end-to-end

### Protocol Completeness

- [ ] `ent/tools/list` works
- [ ] `ent/mcp/servers/*` methods work
- [ ] `ent/workspace/*` methods work
- [ ] `ent/personas/list` works
- [ ] `ent/models/refresh` works

### Test Coverage Restored

- [ ] Retry logic tests pass (`agent-process.retry.e2e.test.ts`)
- [ ] Token management tests pass (`agent-process.tokens.e2e.test.ts`)
- [ ] Abort reliability tests pass (`agent-process.abort.e2e.test.ts`)
- [ ] Auto-compaction tests pass (`agent-process.auto-compact.e2e.test.ts`)
- [ ] Web full-flow tests pass (`full-flow.e2e.test.ts`)

---

## Appendix: Files to Move Summary

| From (core)           | To (agent)           | Notes                                         |
| --------------------- | -------------------- | --------------------------------------------- |
| `tools/`              | `tools/`             | All tool implementations                      |
| `providers/`          | `providers/`         | Registry, catalog, instances, implementations |
| `mcp/`                | `mcp/`               | Server manager                                |
| `workspace/`          | `workspace/`         | Workspace management                          |
| `containers/`         | `containers/`        | Container utilities                           |
| `config/`             | `config/`            | Lace dir, MCP config, personas                |
| `threads/compaction/` | `compaction/`        | Strategies only, not thread types             |
| `token-management/`   | `token-management/`  | Token counting                                |
| `utils/`              | `utils/`             | Logger, token estimation                      |
| `helpers/`            | `helpers/`           | Infrastructure helpers                        |
| `projects/`           | `projects/`          | Project management                            |
| `threads/types.ts`    | `@lace/ent-protocol` | Shared types only                             |

---

## Appendix: New Protocol Methods Summary

| Method                   | Purpose                           |
| ------------------------ | --------------------------------- |
| `ent/tools/list`         | List available tools with schemas |
| `ent/mcp/servers/list`   | List MCP server configurations    |
| `ent/mcp/servers/upsert` | Add/update MCP server             |
| `ent/mcp/servers/delete` | Remove MCP server                 |
| `ent/mcp/servers/test`   | Test MCP server connection        |
| `ent/mcp/tools/list`     | List tools from MCP servers       |
| `ent/workspace/info`     | Get workspace info                |
| `ent/workspace/create`   | Create workspace container        |
| `ent/personas/list`      | List available personas           |
