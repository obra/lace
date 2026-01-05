# Spec Compliance Audit Report

**Date:** 2026-01-04
**Auditor:** Bot (Claude Code)
**Scope:** Review of agent-process refactoring against specs in `docs/plans/lace-refactor-spec.md` and `docs/plans/2026-01-03/*`

---

## Executive Summary

**Overall Assessment: ~90% Compliant**

The engineer did solid work on the core architectural changes. The package structure is correct, JSONL persistence is properly implemented, Tasks are removed, and the ToolContext was properly refactored. However, there are some concerning issues, particularly around the web package violating architectural boundaries.

---

## What Was Done Well

### 1. Package Structure (100% Complete)

All four required packages exist with correct structure:

| Package | NPM Name | Binary | Status |
|---------|----------|--------|--------|
| `packages/ent-protocol` | `@lace/ent-protocol` | - | Complete |
| `packages/agent` | `@lace/agent` | `lace-agent` | Complete |
| `packages/supervisor` | `@lace/supervisor` | - | Complete |
| `packages/cli` | `@lace/cli` | `lace` | Complete |

**Implementation Details:**
- `@lace/ent-protocol`: NDJSON stdio transport, JSON-RPC 2.0 peer, Zod schemas for all protocol messages
- `@lace/agent`: Owns JSONL persistence, tool execution, provider management, job/subagent spawning
- `@lace/supervisor`: Spawns agent processes, routes messages, storage-agnostic
- `@lace/cli`: Pure Ent protocol REPL client

### 2. ToolContext Refactor (100% Complete)

**Spec Requirement (Task 4.5.1):** Remove `context.agent` dependencies; expand `ToolContext` with explicit fields.

**Verification:**
- All `context.agent` references removed from `packages/core/src/tools/`
- `ToolContext` in `packages/core/src/tools/types.ts` has all required fields:
  - `signal: AbortSignal`
  - `workingDirectory?: string`
  - `toolTempDir?: string`
  - `processEnv?: NodeJS.ProcessEnv`
  - `workspaceInfo?: { ... }`
  - `workspaceManager?: IWorkspaceManager`
  - `hasFileBeenRead?: (path: string) => boolean`
- Test coverage in `toolcontext-no-agent.test.ts` proves tools run without Agent object
- Delegate tool properly stubbed in `packages/core/src/tools/implementations/delegate.ts`

### 3. Tasks Removal (100% Complete)

**Spec Requirement (PR6):** Remove Tasks feature entirely.

**Verification:**
- TaskManager not in runtime path
- Task tools not registered in `ToolExecutor.registerAllAvailableTools()` (only 8 native tools registered)
- No task-related web routes found
- Delegate tool returns clear "not implemented" message
- `packages/core/src/tools/implementations/task-manager/` directory does not exist

### 4. JSONL Persistence (100% Complete)

**Spec Requirement:** Agent owns durable history via JSONL, not SQLite.

**Directory Structure (matches spec):**
```
<laceDir>/agent-sessions/<sessionId>/
  events.jsonl        # durable event stream
  state.json          # counters + config only
  meta.json           # session metadata
  checkpoints/        # file checkpointing snapshots
```

**Verification:**
- `events.jsonl` is append-only with proper schema (`eventSeq`, `timestamp`, `type`, `turnId`, `turnSeq`, `data`)
- `state.json` contains only counters and config, NOT permissions (verified by E2E test)
- Permission durability implemented:
  - `permission_requested` events persisted
  - `permission_decided` events persisted
  - `permission_cancelled` events persisted
- `ent/session/events` pagination by `afterEventSeq` works correctly
- Permission reissue on restart implemented via `derivePendingPermissionsFromDurableEvents()`

### 5. Protocol Implementation (97% Complete)

**Spec Requirement:** Implement Ent protocol methods.

**Verification:**
- 31/32 methods implemented
- `session/request_permission` correctly implemented as JSON-RPC REQUEST (not notification)
- All session control methods: `initialize`, `session/new`, `session/load`, `session/list`, `session/prompt`, `session/set_mode`, `session/cancel`
- All connection methods: list, upsert, delete, test, credentials/*
- All job methods: list, output, kill, inject
- All session extensions: events, configure, compact, checkpoint, rewind, inject

**Missing:** `ent/models/refresh` handler (schema exists, handler not implemented)

### 6. Supervisor Storage-Agnosticism (100% Complete)

**Spec Requirement:** Supervisor never reads agent files, never executes tools.

**Verification:**
- Zero imports from `@lace/core`
- Does NOT read agent JSONL files directly
- Does NOT execute tools on behalf of agent
- Pure message routing through Ent protocol
- Spawns agent processes correctly via `supervisor-agent-process.ts`

---

## Critical Issues

### Issue 1: Web Package Violates Architectural Boundary

**Spec Requirement:** "web must not import and execute core runtime objects directly"

**Violations Found:**

| File | Line(s) | Violation |
|------|---------|-----------|
| `api.provider.catalog.ts` | 16 | Direct `ProviderRegistry.getInstance()` execution |
| `api.mcp.servers.ts` | 29, 56, 64, 67 | Direct `MCPConfigLoader.loadGlobalConfig()` and `ToolCatalog.discoverAndCacheTools()` |
| `api.mcp.servers.$serverId.ts` | 31, 67 | Direct `MCPConfigLoader.loadGlobalConfig()` |
| `lib/server/lace-imports.ts` | All | Central re-export hub for 10+ core runtime classes |

**Impact:** Web should route ALL these operations through supervisor -> agent protocol calls, not execute them directly. This violates the process isolation principle.

**Root Cause:**
- Missing supervisor API coverage for provider catalog discovery
- Missing supervisor API for MCP configuration management
- Developers used direct core imports for convenience

### Issue 2: Agent Depends on Core's "Old World" Compaction Infrastructure

**Spec Requirement:** Agent should own execution; core should not be in runtime path.

**Violation Found:**

`packages/agent/src/compaction/compact-dropped-messages.ts` imports:
```typescript
import type { LaceEvent } from '@lace/core/threads/types';
import type { CompactionStrategy } from '@lace/core/threads/compaction/types';
import { registerDefaultStrategies } from '@lace/core/threads/compaction/registry';
```

**Impact:** Agent is pulling business logic from core's legacy `threads/` infrastructure. The spec's Task 7.4 said to "re-use/port" the compaction system, meaning it should have been copied into agent, not imported from core.

---

## Minor Issues

### 1. `ent/models/refresh` Handler Missing

**Severity:** Low
**Location:** Schema in `packages/ent-protocol/src/schemas/methods.ts`, handler missing in `packages/agent/src/server.ts`
**Fix:** Add handler implementation

### 2. Jobs Directory Not Implemented

**Severity:** Low (spec-compliant)
**Note:** Spec marks `jobs/` subdirectory as "optional" for output spooling. Not implemented, but acceptable since marked optional.

### 3. Old World Directories Still Exist

**Severity:** Low
**Directories:**
- `packages/core/src/threads/` - contains types.ts and compaction/ (still used by agent)
- `packages/core/src/sessions/` - should verify if empty
- `packages/core/src/persistence/` - should verify if empty

These should be cleaned up or clearly marked as deprecated to avoid confusion.

---

## Code Placement Analysis

**Jesse's Main Concern:** Is there code in `packages/core` that should be in `packages/agent`?

### What's Correctly in Agent

- JSONL persistence (`event-log.ts`, `session-store.ts`, `checkpoint-store.ts`)
- Permission derivation from events (`permissions-from-events.ts`)
- Ent protocol server (`server.ts`)
- Job/subagent spawning

### What Agent Correctly Reuses from Core (Acceptable)

- `ToolExecutor` + tool implementations (tools are reusable utilities)
- `ProviderRegistry`, `ProviderCatalogManager`, `ProviderInstanceManager` (provider infrastructure)
- `MCPServerManager` (MCP integration)

### What's Problematic

- Compaction strategies should have been moved/copied to agent, not imported from `@lace/core/threads/compaction/`
- Web package executing core classes directly instead of routing through supervisor

---

## Recommendations

### High Priority

1. **Fix web package architectural violations**
   - Route provider catalog operations through supervisor -> agent
   - Route MCP config management through supervisor -> agent
   - Route tool catalog operations through supervisor -> agent
   - Remove or deprecate `lib/server/lace-imports.ts`

### Medium Priority

2. **Move compaction strategies to agent**
   - Copy `@lace/core/threads/compaction/` to `@lace/agent/src/compaction/`
   - Remove agent's dependency on core's threads infrastructure
   - Agent should own its own business logic

### Low Priority

3. **Add `ent/models/refresh` handler**
   - Implement in `packages/agent/src/server.ts`

4. **Cleanup old world directories**
   - Remove or archive `packages/core/src/threads/` (after moving compaction)
   - Remove `packages/core/src/sessions/` if empty
   - Remove `packages/core/src/persistence/` if empty

---

## Summary Table

| Area | Spec Compliance | Issues |
|------|-----------------|--------|
| Package Structure | 100% | None |
| ToolContext Refactor | 100% | None |
| Tasks Removal | 100% | None |
| JSONL Persistence | 100% | None |
| Protocol Implementation | 97% | Missing `ent/models/refresh` |
| Supervisor Architecture | 100% | None |
| Web Architecture | **FAILING** | Direct core imports/execution |
| Code Placement | 90% | Compaction not moved to agent |

---

## Appendix: Files Examined

### Package Structure
- `packages/ent-protocol/package.json`
- `packages/agent/package.json`
- `packages/supervisor/package.json`
- `packages/cli/package.json`

### ToolContext
- `packages/core/src/tools/types.ts`
- `packages/core/src/tools/executor.ts`
- `packages/core/src/tools/tool.ts`
- `packages/core/src/tools/implementations/delegate.ts`
- `packages/core/src/tools/toolcontext-no-agent.test.ts`

### Tasks Removal
- `packages/core/src/tools/executor.ts` (registerAllAvailableTools)
- `packages/web/app/routes/` (searched for task routes)

### JSONL Persistence
- `packages/agent/src/storage/event-log.ts`
- `packages/agent/src/storage/session-store.ts`
- `packages/agent/src/storage/checkpoint-store.ts`
- `packages/agent/src/storage/permissions-from-events.ts`

### Protocol
- `packages/ent-protocol/src/schemas/methods.ts`
- `packages/agent/src/server.ts`

### Supervisor
- `packages/supervisor/src/supervisor.ts`
- `packages/supervisor/src/supervisor-agent-process.ts`

### Web Violations
- `packages/web/app/routes/api.provider.catalog.ts`
- `packages/web/app/routes/api.mcp.servers.ts`
- `packages/web/app/routes/api.mcp.servers.$serverId.ts`
- `packages/web/lib/server/lace-imports.ts`
