# Web Package Deduplication Plan

## Summary

Reduce code duplication in `packages/web` from 62 production clones (7.23%
duplication, 795 lines) by extracting shared route helpers and consolidating
similar API patterns.

## Analysis

### Current State

- **Production files**: 101
- **Production lines**: 11,003
- **Clones found**: 62
- **Duplicated lines**: 795 (7.23%)

### Major Duplication Clusters

#### 1. Route Parameter Extraction & Validation (~200 lines)

Repeated patterns for extracting and validating route params:

```typescript
const { sessionId } = params;
if (!sessionId) {
  return json({ error: 'Session ID required' }, { status: 400 });
}
const session = await getSession(sessionId);
if (!session) {
  return json({ error: 'Session not found' }, { status: 404 });
}
```

**Affected files:**

- `api.sessions.$sessionId.ts` and all child routes
- `api.projects.$projectId.ts` and all child routes
- `api.agents.$agentId.ts` and all child routes
- `api.threads.$threadId.*` routes

#### 2. MCP Server Routes (~150 lines)

Near-identical implementations between global and project-scoped MCP routes:

- `api.mcp.servers.ts` ↔ `api.projects.$projectId.mcp.servers.ts`
- `api.mcp.servers.$serverId.ts` ↔
  `api.projects.$projectId.mcp.servers.$serverId.ts`

#### 3. Configuration Routes (~120 lines)

Duplicated configuration handling:

- `api.projects.$projectId.configuration.ts`
- `api.sessions.$sessionId.configuration.ts`

Similar patterns for:

- Loading configuration
- Validating updates
- Applying changes

#### 4. Approval Routes (~100 lines)

Similar approval handling:

- `api.threads.$threadId.approvals.pending.ts`
- `api.sessions.$sessionId.approvals.pending.ts`
- `api.threads.$threadId.approvals.$toolCallId.ts`
- `api.sessions.$sessionId.approvals.$toolCallId.ts`

#### 5. Provider Instance Routes (~100 lines)

Repeated validation and lookup patterns:

- `api.provider.instances.ts`
- `api.provider.instances.$instanceId.ts`
- `api.provider.instances.$instanceId.config.ts`

#### 6. Internal Route Duplication (~125 lines)

Files with internal duplication (same patterns repeated within a single file):

- `api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control.ts`
- `api.projects.$projectId.environment.ts`
- `api.filesystem.list.ts`
- `api.filesystem.mkdir.ts`

---

## Implementation Plan

### Phase 1: Route Helper Utilities

**New file: `lib/server/route-helpers.ts`**

Extract common route patterns:

```typescript
// Parameter extraction with validation
export async function requireSessionId(params: Params): Promise<string>;
export async function requireProjectId(params: Params): Promise<string>;
export async function requireAgentId(params: Params): Promise<string>;

// Entity lookup with 404 handling
export async function requireSession(sessionId: string): Promise<Session>;
export async function requireProject(projectId: string): Promise<Project>;
export async function requireAgent(agentId: string): Promise<AgentConnection>;

// Combined param + lookup
export async function getSessionFromParams(
  params: Params
): Promise<{ sessionId: string; session: Session }>;
export async function getProjectFromParams(
  params: Params
): Promise<{ projectId: string; project: Project }>;

// Error response helpers
export function badRequest(message: string): Response;
export function notFound(entity: string): Response;
export function serverError(error: unknown): Response;
```

**Estimated impact**: ~200 lines reduced across 20+ route files

### Phase 2: MCP Server Route Consolidation

**New file: `lib/server/mcp-route-handlers.ts`**

Extract shared MCP server logic:

```typescript
export interface McpRouteContext {
  projectId?: string; // undefined for global routes
}

export async function listMcpServers(
  ctx: McpRouteContext
): Promise<McpServerInfo[]>;
export async function getMcpServer(
  ctx: McpRouteContext,
  serverId: string
): Promise<McpServerInfo>;
export async function upsertMcpServer(
  ctx: McpRouteContext,
  config: McpServerConfig
): Promise<McpServerInfo>;
export async function deleteMcpServer(
  ctx: McpRouteContext,
  serverId: string
): Promise<void>;
export async function testMcpServer(
  ctx: McpRouteContext,
  serverId: string
): Promise<TestResult>;
```

**Files to refactor:**

- `api.mcp.servers.ts` → thin wrapper calling handlers with
  `{ projectId: undefined }`
- `api.mcp.servers.$serverId.ts` → thin wrapper
- `api.projects.$projectId.mcp.servers.ts` → thin wrapper with projectId
- `api.projects.$projectId.mcp.servers.$serverId.ts` → thin wrapper

**Estimated impact**: ~150 lines reduced

### Phase 3: Configuration Route Consolidation

**New file: `lib/server/config-route-handlers.ts`**

Extract configuration handling:

```typescript
export type ConfigScope = 'project' | 'session';

export interface ConfigContext {
  scope: ConfigScope;
  projectId?: string;
  sessionId?: string;
}

export async function getConfiguration(
  ctx: ConfigContext
): Promise<Configuration>;
export async function updateConfiguration(
  ctx: ConfigContext,
  updates: ConfigUpdates
): Promise<Configuration>;
export async function validateConfigUpdates(
  updates: unknown
): Promise<ConfigUpdates>;
```

**Files to refactor:**

- `api.projects.$projectId.configuration.ts`
- `api.sessions.$sessionId.configuration.ts`

**Estimated impact**: ~120 lines reduced

### Phase 4: Approval Route Consolidation

**New file: `lib/server/approval-route-handlers.ts`**

Extract approval handling:

```typescript
export type ApprovalScope = 'thread' | 'session';

export interface ApprovalContext {
  scope: ApprovalScope;
  threadId?: string;
  sessionId?: string;
}

export async function getPendingApprovals(
  ctx: ApprovalContext
): Promise<PendingApproval[]>;
export async function submitApproval(
  ctx: ApprovalContext,
  toolCallId: string,
  decision: ApprovalDecision
): Promise<void>;
```

**Files to refactor:**

- `api.threads.$threadId.approvals.pending.ts`
- `api.sessions.$sessionId.approvals.pending.ts`
- `api.threads.$threadId.approvals.$toolCallId.ts`
- `api.sessions.$sessionId.approvals.$toolCallId.ts`

**Estimated impact**: ~100 lines reduced

### Phase 5: Provider Instance Helpers

**New file: `lib/server/provider-route-handlers.ts`**

Extract provider instance patterns:

```typescript
export async function validateProviderConfig(
  config: unknown
): Promise<ProviderConfig>;
export async function getProviderInstance(
  instanceId: string
): Promise<ProviderInstance>;
export async function testProviderConnection(
  instance: ProviderInstance
): Promise<TestResult>;
```

**Files to refactor:**

- `api.provider.instances.ts`
- `api.provider.instances.$instanceId.ts`
- `api.provider.instances.$instanceId.config.ts`

**Estimated impact**: ~100 lines reduced

### Phase 6: Internal Route Cleanup

Refactor files with internal duplication:

1. **`api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control.ts`**
   - Extract repeated control action patterns into helper function

2. **`api.projects.$projectId.environment.ts`**
   - Consolidate GET/PUT/DELETE patterns

3. **`api.filesystem.list.ts` / `api.filesystem.mkdir.ts`**
   - Extract common directory traversal and error handling

**Estimated impact**: ~125 lines reduced

---

## Execution Order

1. **Phase 1 first** - Route helpers are foundational, enable all other phases
2. **Phase 2-5 in parallel** - Independent consolidations
3. **Phase 6 last** - Internal cleanup after main patterns established

Each phase should:

1. Create new helper file with tests
2. Refactor one route file as proof of concept
3. Run tests to verify
4. Refactor remaining files
5. Commit

---

## File Impact Summary

| New File                                | Purpose                                          | Lines |
| --------------------------------------- | ------------------------------------------------ | ----- |
| `lib/server/route-helpers.ts`           | Param extraction, entity lookup, error responses | ~80   |
| `lib/server/mcp-route-handlers.ts`      | Shared MCP server logic                          | ~100  |
| `lib/server/config-route-handlers.ts`   | Configuration handling                           | ~60   |
| `lib/server/approval-route-handlers.ts` | Approval handling                                | ~50   |
| `lib/server/provider-route-handlers.ts` | Provider instance logic                          | ~60   |

**Total new code**: ~350 lines **Estimated lines removed**: ~795 lines **Net
reduction**: ~445 lines

---

## Expected Results

| Metric           | Before      | After (Target) |
| ---------------- | ----------- | -------------- |
| Clones           | 62          | <20            |
| Duplicated lines | 795 (7.23%) | <300 (2.7%)    |

---

## Verification

1. **After each phase**: Run `npm test` in `packages/web`
2. **After Phase 1**: Verify route helpers work with existing routes
3. **Final check**: Re-run jscpd to measure improvement
4. **Manual test**: Verify API endpoints still function correctly

---

## Risk Mitigation

- Route helpers must handle all edge cases (missing params, null entities)
- Error response format must remain consistent with existing API
- TypeScript types must be preserved for route loaders/actions
- Changes should be incremental - one route at a time

---

## Priority Order

Based on duplication severity and impact:

1. **Phase 1: Route helpers** - Highest impact, enables other phases
2. **Phase 2: MCP routes** - Large duplication, clear pattern
3. **Phase 4: Approval routes** - Medium duplication, isolated scope
4. **Phase 3: Config routes** - Medium duplication
5. **Phase 5: Provider routes** - Medium duplication
6. **Phase 6: Internal cleanup** - Lower priority, file-specific
