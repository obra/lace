# Server.ts Decomposition Plan

**Date**: 2025-01-09 **Status**: In Progress **Execution**: Subagent-driven with
haiku agents

## Summary

Decompose `packages/agent/src/server.ts` (6153 lines) into focused, maintainable
modules. The file currently contains mixed responsibilities: RPC handlers, job
management, provider operations, session handling, and utilities.

## Analysis

### Current Structure

- **Lines 1-83**: Imports
- **Lines 84-233**: Types, constants, utility functions
- **Lines 235-422**: Job types, helpers, permission logic
- **Lines 424-772**: Provider creation, slash commands
- **Lines 774-1167**: Context computation, event building
- **Lines 1169-1228**: AgentServerState type and creation
- **Lines 1230-6152**: `registerAgentRpcMethods` - **4900+ lines**

### Problem Areas

1. `registerAgentRpcMethods` is a single function containing everything
2. Job processing logic (shell jobs, subagent jobs) is ~600 lines inline
3. Handler registration mixes with business logic
4. `handlePrompt` alone is ~400 lines
5. No separation between RPC handlers and domain logic

---

## Implementation Phases

### Phase 1: Extract Type Definitions

**New file: `packages/agent/src/server-types.ts`**

Move shared types and constants:

- `SessionUpdateParams`, `SessionUpdate`, `JobInnerUpdate` types
- `JobType`, `JobStatus`, `JobState`, `PendingJobNotification` types
- `AgentServerState` type
- Constants: `SUPPORTED_PROVIDER_TYPES`, `JOB_LOG_DIR`, `MAX_CONCURRENT_JOBS`,
  etc.

### Phase 2: Extract Utility Functions

**New file: `packages/agent/src/rpc/utils.ts`**

Move pure utilities:

- `throwInvalidParams`
- `toNonEmptyString`
- `toPositiveInt`
- `getEndpointFromConfig`
- `assertConfigHasNoCredentials`
- `parseProviderInstanceOverridesFromConnectionConfig`
- `mapCatalogModelToModelInfo`
- `toolKindFromName`
- `protocolToolInfoForCoreTool`
- `protocolToolResultFromCore`
- `coreToolResultFromProtocol`
- `shouldAskPermission`
- `isTestProviderEnabled`
- `assertInitialized`
- `arraysShallowEqual`, `recordsShallowEqual`, `mcpServerConfigEquivalent`

### Phase 3: Extract Job Management

**New file: `packages/agent/src/jobs/job-manager.ts`**

Extract job-related code:

- `ensureJobLogDir`
- `getJobOutputPath`
- `getLastLines`
- `createAgentServerState` (job initialization part)

**New file: `packages/agent/src/jobs/shell-job.ts`**

Extract shell job processing:

- `_startShellJob` logic
- `runShellJobProcess` function (~150 lines)

**New file: `packages/agent/src/jobs/subagent-job.ts`**

Extract subagent job processing:

- `startSubagentJob` logic
- `runSubagentJobProcess` function (~500 lines)
- Child job ID mapping helpers

**New file: `packages/agent/src/jobs/job-notifications.ts`**

Extract notification system:

- `queueJobNotification`
- `setupProgressTimer`
- `formatJobNotification` usage
- `PendingJobNotification` handling

### Phase 4: Extract Permission System

**New file: `packages/agent/src/rpc/permissions.ts`**

Extract permission handling:

- `requestPermissionFromClient`
- `reissuePendingPermissionRequests`

### Phase 5: Extract Event/Message Building

**New file: `packages/agent/src/events/message-builder.ts`**

Extract:

- `buildProviderMessagesFromDurableEvents` (already exported)
- `estimateProviderTokens`
- `extractTextFromContentBlocks`
- `extractContentBlocks`
- `computeContextBreakdownForActiveSession`

### Phase 6: Extract RPC Handlers into Groups

**New file: `packages/agent/src/rpc/handlers/initialize.ts`**

- `initialize` handler

**New file: `packages/agent/src/rpc/handlers/agent-status.ts`**

- `ent/agent/ping`
- `ent/agent/status`

**New file: `packages/agent/src/rpc/handlers/providers.ts`**

- `ent/providers/list`
- `ent/providers/catalog`
- `ent/providers/refresh`
- `ensureProviderCatalogLoaded`

**New file: `packages/agent/src/rpc/handlers/connections.ts`**

- `ent/connections/list`
- `ent/connections/upsert`
- `ent/connections/delete`
- `ent/connections/test`
- `ent/connections/credentials/*`

**New file: `packages/agent/src/rpc/handlers/models.ts`**

- `ent/models/list`
- `ent/models/refresh`
- `ent/models/enable`
- `ent/models/disable`
- `updateModelGating`

**New file: `packages/agent/src/rpc/handlers/tools.ts`**

- `ent/tools/list`
- `createToolExecutorForMode`

**New file: `packages/agent/src/rpc/handlers/mcp-servers.ts`**

- `ent/mcp/servers/list`
- `ent/mcp/servers/upsert`
- `ent/mcp/servers/delete`
- `ent/mcp/servers/test`
- `ent/mcp/tools/list`
- `reconcileMcpServersForActiveSession`

**New file: `packages/agent/src/rpc/handlers/jobs.ts`**

- `ent/job/list`
- `ent/job/output`
- `ent/job/kill`
- `ent/job/inject`
- `deriveJobsForActiveSession`

**New file: `packages/agent/src/rpc/handlers/session.ts`**

- `session/new`
- `session/list`
- `session/load`
- `session/fork`
- `session/set_mode`

**New file: `packages/agent/src/rpc/handlers/session-operations.ts`**

- `ent/session/configure`
- `ent/session/compact`
- `ent/session/checkpoint`
- `ent/session/rewind`
- `ent/session/inject`
- `ent/session/events`
- `ent/session/token_usage`
- `ent/session/context_breakdown`

**New file: `packages/agent/src/rpc/handlers/prompt.ts`**

- `session/prompt` handler
- `handlePrompt` function (~400 lines)
- Slash command processing delegation

**New file: `packages/agent/src/rpc/handlers/workspace.ts`**

- `ent/workspace/info`
- `ent/workspace/create`

### Phase 7: Create Handler Registry

**New file: `packages/agent/src/rpc/register-handlers.ts`**

Central registration that imports all handler modules and wires them to the
peer:

```typescript
export function registerAgentRpcMethods(
  peer: JsonRpcPeer,
  state: AgentServerState
): void {
  registerInitializeHandler(peer, state);
  registerAgentStatusHandlers(peer, state);
  registerProviderHandlers(peer, state);
  registerConnectionHandlers(peer, state);
  registerModelHandlers(peer, state);
  registerToolHandlers(peer, state);
  registerMcpHandlers(peer, state);
  registerJobHandlers(peer, state);
  registerSessionHandlers(peer, state);
  registerSessionOperationHandlers(peer, state);
  registerPromptHandler(peer, state);
  registerWorkspaceHandlers(peer, state);
}
```

### Phase 8: Refactor server.ts

**Modified: `packages/agent/src/server.ts`**

After extraction, server.ts becomes a thin shell:

```typescript
// ABOUTME: Agent server entry point - delegates to specialized modules
export { AgentServerState, createAgentServerState } from './server-types';
export { registerAgentRpcMethods } from './rpc/register-handlers';
export { buildProviderMessagesFromDurableEvents } from './events/message-builder';
```

---

## Subagent Task Assignments

Tasks suitable for haiku agents (independent, well-defined scope):

| Task                                  | Agent Model | Dependencies         |
| ------------------------------------- | ----------- | -------------------- |
| Phase 1: Extract types                | haiku       | None                 |
| Phase 2: Extract utils                | haiku       | Phase 1              |
| Phase 3a: job-manager.ts              | haiku       | Phases 1-2           |
| Phase 3b: shell-job.ts                | haiku       | Phase 3a             |
| Phase 3c: subagent-job.ts             | sonnet      | Phase 3a (complex)   |
| Phase 3d: job-notifications.ts        | haiku       | Phase 3a             |
| Phase 4: permissions.ts               | haiku       | Phases 1-2           |
| Phase 5: message-builder.ts           | haiku       | Phases 1-2           |
| Phase 6a: initialize handler          | haiku       | Phases 1-5           |
| Phase 6b: agent-status handlers       | haiku       | Phases 1-5           |
| Phase 6c: providers handlers          | haiku       | Phases 1-5           |
| Phase 6d: connections handlers        | haiku       | Phases 1-5           |
| Phase 6e: models handlers             | haiku       | Phases 1-5           |
| Phase 6f: tools handlers              | haiku       | Phases 1-5           |
| Phase 6g: mcp-servers handlers        | haiku       | Phases 1-5           |
| Phase 6h: jobs handlers               | haiku       | Phases 1-5           |
| Phase 6i: session handlers            | haiku       | Phases 1-5           |
| Phase 6j: session-operations handlers | haiku       | Phases 1-5           |
| Phase 6k: prompt handler              | sonnet      | Phases 1-5 (complex) |
| Phase 6l: workspace handlers          | haiku       | Phases 1-5           |
| Phase 7: register-handlers.ts         | haiku       | Phase 6              |
| Phase 8: Clean up server.ts           | haiku       | Phase 7              |

---

## Execution Order

Sequential phases (can't parallelize across phases):

1. **Phase 1-2** - Types and utilities (foundation)
2. **Phase 3-5** - Job, permission, message systems (can run in parallel within
   phase)
3. **Phase 6** - Handler extraction (can run many in parallel)
4. **Phase 7-8** - Final assembly

---

## Critical Files Summary

| New File                    | Approximate Lines | Key Exports            |
| --------------------------- | ----------------- | ---------------------- |
| `server-types.ts`           | ~100              | Types, constants       |
| `rpc/utils.ts`              | ~150              | Utility functions      |
| `jobs/job-manager.ts`       | ~80               | Job helpers            |
| `jobs/shell-job.ts`         | ~200              | Shell job runner       |
| `jobs/subagent-job.ts`      | ~550              | Subagent job runner    |
| `jobs/job-notifications.ts` | ~80               | Notification system    |
| `rpc/permissions.ts`        | ~150              | Permission handling    |
| `events/message-builder.ts` | ~200              | Event/message building |
| `rpc/handlers/*.ts`         | ~3500 total       | All RPC handlers       |
| `rpc/register-handlers.ts`  | ~50               | Registration           |

---

## Verification

1. **After each phase**: Run `npm test` in `packages/agent`
2. **After Phase 6**: Run E2E tests to verify RPC handling
3. **Final check**: Run full test suite and verify no regressions
4. **Manual test**: Start agent, verify initialize works, test session/prompt

---

## Risk Mitigation

- Keep `buildProviderMessagesFromDurableEvents` export signature unchanged
- Handler functions will need access to state - pass as parameter or use closure
- Some handlers have interdependencies (e.g., finalizeJob, emitSessionUpdate) -
  extract these as shared utilities first
- The `runExclusive` mutex pattern needs to be preserved for session safety

---

## Dependencies Between Modules

```
server.ts
└── rpc/register-handlers.ts
    ├── rpc/handlers/*.ts (all handlers)
    │   ├── rpc/utils.ts
    │   ├── rpc/permissions.ts
    │   └── jobs/*.ts
    ├── events/message-builder.ts
    └── server-types.ts
```

---

## Code Map (Line Numbers in server.ts)

### Utility Functions (Phase 2: rpc/utils.ts)

| Line | Function                                             |
| ---- | ---------------------------------------------------- |
| 100  | `throwInvalidParams`                                 |
| 108  | `toNonEmptyString`                                   |
| 114  | `toPositiveInt`                                      |
| 120  | `getEndpointFromConfig`                              |
| 138  | `assertConfigHasNoCredentials`                       |
| 147  | `parseProviderInstanceOverridesFromConnectionConfig` |
| 184  | `mapCatalogModelToModelInfo`                         |
| 283  | `toolKindFromName`                                   |
| 295  | `protocolToolInfoForCoreTool`                        |
| 306  | `protocolToolResultFromCore`                         |
| 327  | `coreToolResultFromProtocol`                         |
| 353  | `shouldAskPermission`                                |
| 372  | `isTestProviderEnabled`                              |
| 376  | `assertInitialized`                                  |
| 902  | `arraysShallowEqual`                                 |
| 912  | `recordsShallowEqual`                                |
| 924  | `mcpServerConfigEquivalent`                          |

### Job Functions (Phase 3: jobs/\*.ts)

| Line | Function                | Target File          |
| ---- | ----------------------- | -------------------- |
| 196  | `ensureJobLogDir`       | job-manager.ts       |
| 202  | `getJobOutputPath`      | job-manager.ts       |
| 209  | `getLastLines`          | job-manager.ts       |
| 1263 | `setupProgressTimer`    | job-notifications.ts |
| 1290 | `finalizeJob`           | job-notifications.ts |
| 1217 | `queueJobNotification`  | job-notifications.ts |
| 1733 | `runShellJobProcess`    | shell-job.ts         |
| 1905 | `runSubagentJobProcess` | subagent-job.ts      |

### Permission Functions (Phase 4: rpc/permissions.ts)

| Line | Function                           |
| ---- | ---------------------------------- |
| 1353 | `requestPermissionFromClient`      |
| 1481 | `reissuePendingPermissionRequests` |

### Message Building (Phase 5: events/message-builder.ts)

| Line | Function                                            |
| ---- | --------------------------------------------------- |
| 219  | `extractTextFromContentBlocks`                      |
| 237  | `extractContentBlocks`                              |
| 735  | `computeContextBreakdownForActiveSession`           |
| 993  | `buildProviderMessagesFromDurableEvents` (exported) |
| 1109 | `estimateProviderTokens`                            |

### Internal Helpers (inside registerAgentRpcMethods)

| Line | Function                      | Note                             |
| ---- | ----------------------------- | -------------------------------- |
| 1149 | `runExclusive`                | Mutex for session safety         |
| 1183 | `emitSessionUpdate`           | Session event emission           |
| 2656 | `ensureProviderCatalogLoaded` | Provider catalog loading         |
| 2677 | `deriveJobsForActiveSession`  | Job state derivation             |
| 4652 | `handlePrompt`                | Main prompt handler (~400 lines) |

### RPC Handlers (Phase 6: rpc/handlers/\*.ts)

| Line | Handler                              | Target File                            |
| ---- | ------------------------------------ | -------------------------------------- |
| 2448 | `initialize`                         | initialize.ts                          |
| 2558 | `ent/agent/ping`                     | agent-status.ts                        |
| 2563 | `ent/agent/status`                   | agent-status.ts                        |
| 2825 | `ent/providers/list`                 | providers.ts                           |
| 2843 | `ent/providers/catalog`              | providers.ts                           |
| 2851 | `ent/providers/refresh`              | providers.ts                           |
| 2874 | `ent/connections/list`               | connections.ts                         |
| 2917 | `ent/connections/upsert`             | connections.ts                         |
| 2995 | `ent/connections/delete`             | connections.ts                         |
| 3006 | `ent/connections/test`               | connections.ts                         |
| 3033 | `ent/connections/credentials/status` | connections.ts                         |
| 3055 | `ent/connections/credentials/start`  | connections.ts                         |
| 3083 | `ent/connections/credentials/submit` | connections.ts                         |
| 3112 | `ent/connections/credentials/clear`  | connections.ts                         |
| 3131 | `ent/models/list`                    | models.ts                              |
| 3174 | `ent/models/refresh`                 | models.ts                              |
| 3259 | `ent/models/enable`                  | models.ts                              |
| 3276 | `ent/models/disable`                 | models.ts                              |
| 3293 | `ent/tools/list`                     | tools.ts                               |
| 3313 | `ent/personas/list`                  | (keep in server.ts or add personas.ts) |
| 3320 | `ent/mcp/servers/list`               | mcp-servers.ts                         |
| 3346 | `ent/mcp/servers/upsert`             | mcp-servers.ts                         |
| 3427 | `ent/mcp/servers/delete`             | mcp-servers.ts                         |
| 3465 | `ent/mcp/servers/test`               | mcp-servers.ts                         |
| 3537 | `ent/mcp/tools/list`                 | mcp-servers.ts                         |
| 3583 | `ent/job/list`                       | jobs.ts                                |
| 3606 | `ent/job/output`                     | jobs.ts                                |
| 3704 | `ent/job/kill`                       | jobs.ts                                |
| 3775 | `ent/job/inject`                     | jobs.ts                                |
| 3799 | `session/new`                        | session.ts                             |
| 3922 | `session/list`                       | session.ts                             |
| 3932 | `session/load`                       | session.ts                             |
| 4012 | `session/fork`                       | session.ts                             |
| 4075 | `ent/session/configure`              | session-operations.ts                  |
| 4240 | `ent/session/compact`                | session-operations.ts                  |
| 4397 | `ent/session/checkpoint`             | session-operations.ts                  |
| 4441 | `ent/session/rewind`                 | session-operations.ts                  |
| 4496 | `ent/session/inject`                 | session-operations.ts                  |
| 4541 | `ent/session/events`                 | session-operations.ts                  |
| 4562 | `ent/session/token_usage`            | session-operations.ts                  |
| 4575 | `ent/session/context_breakdown`      | session-operations.ts                  |
| 4588 | `$/cancel_request`                   | session.ts                             |
| 4604 | `session/set_mode`                   | session.ts                             |
| 6018 | `session/prompt`                     | prompt.ts                              |
| 6022 | `ent/workspace/info`                 | workspace.ts                           |
| 6049 | `ent/workspace/create`               | workspace.ts                           |

### Exported Functions

| Line | Function                                 |
| ---- | ---------------------------------------- |
| 993  | `buildProviderMessagesFromDurableEvents` |
| 1130 | `createAgentServerState`                 |
| 1148 | `registerAgentRpcMethods`                |

---

## Progress

- [x] Phase 1: Extract types to server-types.ts (commit e38bc5267)
- [x] Phase 2: Extract utilities to rpc/utils.ts (commit 57bd54edf)
- [x] Phase 3a: Extract job-manager.ts (commit 9569bcba4)
- [x] Phase 3b: Extract shell-job.ts (commit 2c87262c1)
- [ ] Phase 3c: Extract subagent-job.ts
- [ ] Phase 3d: Extract job-notifications.ts
- [x] Phase 4: Extract permissions.ts (commit 16b883edf)
- [x] Phase 5: Extract message-builder.ts (commit 894377464)
- [ ] Phase 6a-l: Extract RPC handlers
- [ ] Phase 7: Create register-handlers.ts
- [ ] Phase 8: Clean up server.ts
