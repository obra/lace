# Removed Tests Audit Report

**Date:** 2026-01-04 **Auditor:** Bot (Claude Code) **Scope:** Audit of test
files deleted during agent-process refactoring

---

## Executive Summary

**109 test files were deleted. 25 test files were added.**

The refactoring shifted from unit-heavy testing in `packages/core` to E2E-heavy
testing in `packages/agent`. Most deletions are expected (Tasks feature removed,
old-world architecture replaced), but there are **significant coverage gaps**
for retry logic and token management.

---

## Test File Statistics

| Package               | Deleted | Added  | Net Change |
| --------------------- | ------- | ------ | ---------- |
| packages/core         | 77      | 1      | -76        |
| packages/web          | 32      | 0      | -32        |
| packages/agent        | 0       | 12     | +12        |
| packages/supervisor   | 0       | 2      | +2         |
| packages/ent-protocol | 0       | 4      | +4         |
| packages/cli          | 0       | 6      | +6         |
| **Total**             | **109** | **25** | **-84**    |

---

## Categorization of Deleted Tests

### 1. Expected Deletions: Tasks Feature Removed (15 files)

These tests were for the Tasks feature that was intentionally removed:

**Core package:**

- `tasks/agent-spawning-personas.test.ts`
- `tasks/agent-spawning-update.test.ts`
- `tasks/agent-spawning.test.ts`
- `tasks/task-assignment-message.test.ts`
- `tasks/task-assignment-model-resolution.integration.test.ts`

**Web package:**

- `app/routes/__tests__/api.projects.$projectId.sessions.$sessionId.tasks.$taskId.notes.test.ts`
- `app/routes/__tests__/api.projects.$projectId.sessions.$sessionId.tasks.$taskId.test.ts`
- `app/routes/__tests__/api.projects.$projectId.sessions.$sessionId.tasks.test.ts`
- `components/timeline/tool/task-integration.test.ts`
- `components/timeline/tool/task.test.ts`
- `hooks/__tests__/useTaskHandlers.test.ts`
- `lib/client/task-api.e2e.test.ts`
- `lib/client/task-api.test.ts`
- `lib/server/session-service-task-events.test.ts`
- `lib/task-metadata-realtime-integration.test.ts`

**Status:** Expected deletion. Functionality removed.

---

### 2. Expected Deletions: Old-World Architecture (45+ files)

These tests were for components replaced by the new architecture:

#### Thread Management → `packages/agent/src/storage/`

| Deleted                                     | Replacement                                   |
| ------------------------------------------- | --------------------------------------------- |
| `threads/thread-manager.test.ts`            | `event-log.test.ts`, `session-store.test.ts`  |
| `threads/thread-manager-stateless*.test.ts` | E2E tests in `packages/agent`                 |
| `threads/approval-events.test.ts`           | `supervisor-http.permission-race.e2e.test.ts` |
| `threads/approval-queries.test.ts`          | New approval flow via ent-protocol            |
| `threads/conversation-builder.test.ts`      | Event-sourced approach                        |

#### Session System → File-based session store

| Deleted                                | Replacement                       |
| -------------------------------------- | --------------------------------- |
| `sessions/session.test.ts`             | `session-store.test.ts`           |
| `sessions/session-config*.test.ts`     | File-based config in `state.json` |
| `sessions/session-permission*.test.ts` | Supervisor E2E tests              |
| `sessions/session-workspace.test.ts`   | Still in core                     |

#### Persistence Layer → JSONL event log

| Deleted                                      | Status                          |
| -------------------------------------------- | ------------------------------- |
| `persistence/database*.test.ts`              | Replaced by `event-log.test.ts` |
| `persistence/sql-profiler.test.ts`           | N/A - no SQLite                 |
| `persistence/get-pending-approvals*.test.ts` | Covered by supervisor tests     |

#### Web Session Service → Supervisor

| Deleted                                         | Status                |
| ----------------------------------------------- | --------------------- |
| `lib/server/session-service*.test.ts` (8 files) | Architecture replaced |
| `lib/server/thread-manager*.test.ts` (2 files)  | Architecture replaced |
| `lib/server/agent-*.test.ts` (3 files)          | Architecture replaced |

**Status:** Expected deletion. New architecture provides coverage.

---

### 3. Concerning Deletions: Core Agent Behavior (35 files)

These tests covered important agent behaviors:

#### Abort Handling ⚠️ HIGH PRIORITY GAP

| Deleted                                  | New Coverage                  |
| ---------------------------------------- | ----------------------------- |
| `agents/agent-abort.test.ts`             | Partial - E2E only            |
| `agents/agent-abort-reliability.test.ts` | **NONE**                      |
| `agents/agent-tool-abort.test.ts`        | Partial - cancellation tested |

**Gap:** No reliability tests for abort under concurrent/network failure
scenarios.

#### Tool Approval/Permissions ✅ COVERED

| Deleted                                        | New Coverage                                  |
| ---------------------------------------------- | --------------------------------------------- |
| `agents/agent-tool-permissions.test.ts`        | `agent-process.e2e.test.ts`                   |
| `agents/agent-approval-orchestration.test.ts`  | `supervisor-http.permission-race.e2e.test.ts` |
| `agents/tool-approval-race-conditions.test.ts` | `supervisor-http.permission-race.e2e.test.ts` |
| `tools/tool-executor-policy.test.ts`           | Partial                                       |

**Status:** Well covered by E2E tests.

#### Compaction ⚠️ MEDIUM PRIORITY GAP

| Deleted                                         | New Coverage                                     |
| ----------------------------------------------- | ------------------------------------------------ |
| `agents/agent-auto-compact.test.ts`             | **NONE**                                         |
| `agents/agent-compaction-events.test.ts`        | Partial                                          |
| `threads/compaction-integration.test.ts`        | `agent-process.e2e.test.ts` (truncate/summarize) |
| `threads/compaction-visibility.test.ts`         | **NONE**                                         |
| `threads/compaction/enhanced-summarize.test.ts` | Core still has strategy tests                    |

**Gap:** No auto-compact trigger tests. No stress tests.

#### Retry Logic ⚠️ HIGH PRIORITY GAP

| Deleted                      | New Coverage |
| ---------------------------- | ------------ |
| `agents/agent-retry.test.ts` | **NONE**     |
| `retry-integration.test.ts`  | **NONE**     |

**Gap:** Retry logic is completely untested in new suite.

#### Token Management ⚠️ HIGH PRIORITY GAP

| Deleted                                     | New Coverage |
| ------------------------------------------- | ------------ |
| `agents/agent-token.test.ts`                | **NONE**     |
| `token-management/context-analyzer.test.ts` | **NONE**     |

**Gap:** No token budget enforcement tests.

#### Turn/Queue Processing ⚠️ MEDIUM PRIORITY

| Deleted                                    | New Coverage           |
| ------------------------------------------ | ---------------------- |
| `agents/agent-queue-*.test.ts` (6 files)   | Different architecture |
| `agents/agent-turn-tracking.test.ts`       | E2E only               |
| `agents/turn-tracking-integration.test.ts` | E2E only               |

**Status:** New architecture uses different message flow. E2E tests provide some
coverage.

---

### 4. Concerning Deletions: Integration Tests (6 files)

| Deleted                                         | Priority | Status                                           |
| ----------------------------------------------- | -------- | ------------------------------------------------ |
| `agents/agent.test.ts`                          | HIGH     | Partially covered by `agent-process.e2e.test.ts` |
| `app/full-flow.test.ts`                         | HIGH     | **NOT REPLACED**                                 |
| `app/api/compaction-sse.test.ts`                | MEDIUM   | **NOT REPLACED**                                 |
| `hooks/useSSEStream.e2e.test.ts`                | MEDIUM   | **NOT REPLACED**                                 |
| `lib/event-stream-manager-agent-errors.test.ts` | MEDIUM   | **NOT REPLACED**                                 |
| `mcp/real-server.integration.test.ts`           | LOW      | MCP tests still in core                          |

**Gap:** Web package has no full-flow integration test for new architecture.

---

## New Test Coverage Analysis

### What's Well Covered

| Area                       | Test Files                                                                 | Coverage Quality |
| -------------------------- | -------------------------------------------------------------------------- | ---------------- |
| Event durability           | `event-log.test.ts`, `durable-events.test.ts`                              | Excellent        |
| Session storage            | `session-store.test.ts`                                                    | Good             |
| Permission lifecycle       | `agent-process.e2e.test.ts` (4+ scenarios)                                 | Excellent        |
| Permission race conditions | `supervisor-http.permission-race.e2e.test.ts`                              | Excellent        |
| Permission persistence     | `agent-process.e2e.test.ts` (restart test)                                 | Excellent        |
| Subagent/delegation        | `agent-process.delegate.e2e.test.ts`, `agent-process.subagent.e2e.test.ts` | Excellent        |
| Job management             | `agent-process.jobs.e2e.test.ts`                                           | Good             |
| Provider configuration     | `providers-connections.test.ts`, `agent-process.providers.e2e.test.ts`     | Good             |
| Session modes              | `session-set-mode.e2e.test.ts`                                             | Good             |
| Checkpoints/rewind         | `agent-process.e2e.test.ts`                                                | Good             |
| Protocol transport         | `stdio.test.ts`, `peer.test.ts`                                            | Good             |
| CLI integration            | `e2e.lace-agent.test.ts`, `e2e.configure.test.ts`                          | Good             |

### What's Missing

| Area              | Priority   | Recommendation                                       |
| ----------------- | ---------- | ---------------------------------------------------- |
| Retry logic       | **HIGH**   | Add `agent-process.retry.e2e.test.ts`                |
| Token management  | **HIGH**   | Add token budget enforcement tests                   |
| Abort reliability | **MEDIUM** | Add abort under failure scenarios                    |
| Auto-compaction   | **MEDIUM** | Add trigger threshold tests                          |
| Web full-flow     | **MEDIUM** | Add web integration test for supervisor architecture |
| SSE streaming     | **LOW**    | Add event stream E2E                                 |

---

## Coverage Gap Summary

| Behavior             | Old Tests | New Tests           | Gap Severity |
| -------------------- | --------- | ------------------- | ------------ |
| Event durability     | 5 files   | 3 files             | ✅ None      |
| Permission system    | 8 files   | 3 files             | ✅ Low       |
| Subagent/delegation  | 2 files   | 3 files             | ✅ None      |
| Compaction           | 5 files   | 1 file (E2E)        | ⚠️ Medium    |
| Abort handling       | 3 files   | 0.5 files (partial) | ⚠️ Medium    |
| Turn tracking        | 4 files   | E2E only            | ⚠️ Medium    |
| **Retry logic**      | 2 files   | 0 files             | 🔴 **HIGH**  |
| **Token management** | 2 files   | 0 files             | 🔴 **HIGH**  |
| Web full-flow        | 1 file    | 0 files             | ⚠️ Medium    |

---

## Recommendations

### Before Production (HIGH Priority)

1. **Add retry logic tests**
   - Create `packages/agent/src/__tests__/agent-process.retry.e2e.test.ts`
   - Test retry on provider errors, network failures, rate limits

2. **Add token management tests**
   - Test token budget enforcement (`maxBudgetUsd`)
   - Test token counting accuracy
   - Test budget exhaustion behavior

### Soon After (MEDIUM Priority)

3. **Add abort reliability tests**
   - Test abort during tool execution
   - Test abort with pending approvals
   - Test abort under network failure

4. **Add auto-compaction tests**
   - Test compaction triggers at threshold
   - Test compaction with large conversations

5. **Add web integration test**
   - Full flow: web → supervisor → agent → tool → response

### Nice to Have (LOW Priority)

6. Add SSE streaming tests for web
7. Add compaction stress tests
8. Add permission policy unit tests

---

## Architecture Observations

### Testing Philosophy Shift

**Old approach:** Unit-heavy testing in `packages/core`

- Many small, isolated tests
- Fast execution
- Good for regression detection

**New approach:** E2E-heavy testing in `packages/agent`

- Fewer, comprehensive integration tests
- Slower execution
- Good for system-level confidence

### Trade-offs

**Pros of new approach:**

- Tests real system behavior end-to-end
- Less test maintenance as internals change
- Higher confidence in integration points

**Cons of new approach:**

- Slower test execution
- Harder to isolate failures
- Less granular regression detection
- Some edge cases may be missed

### Recommendation

Consider adding a middle layer of unit tests for critical business logic:

- Retry policy logic
- Token budget calculations
- Compaction strategy selection
- Permission policy evaluation

These would catch regressions faster than E2E tests while being more stable than
the old architecture-coupled tests.

---

## Appendix: Complete List of Deleted Test Files

<details>
<summary>Core package (77 files)</summary>

```
agents/agent-abort-reliability.test.ts
agents/agent-abort.test.ts
agents/agent-approval-orchestration.test.ts
agents/agent-auto-compact.test.ts
agents/agent-commands.test.ts
agents/agent-compaction-events.test.ts
agents/agent-config.test.ts
agents/agent-getqueue-contents.test.ts
agents/agent-persona.test.ts
agents/agent-queue-e2e.test.ts
agents/agent-queue-methods.test.ts
agents/agent-queue-processing.test.ts
agents/agent-queue-types.test.ts
agents/agent-retry.test.ts
agents/agent-sendmessage-queue.test.ts
agents/agent-session-context.test.ts
agents/agent-system-prompt-refresh.test.ts
agents/agent-thread-events.test.ts
agents/agent-threadmanager-encapsulation.test.ts
agents/agent-token.test.ts
agents/agent-tool-abort.test.ts
agents/agent-tool-permissions.test.ts
agents/agent-turn-tracking.test.ts
agents/agent.test.ts
agents/batch-completion-behavior.test.ts
agents/hasFileBeenRead-working-directory.test.ts
agents/tool-approval-race-conditions.test.ts
agents/turn-tracking-integration.test.ts
agent-thread-integration.test.ts
conversation-state.test.ts
delegation-integration.test.ts
helpers/factory-registry-integration.test.ts
helpers/persona-integration.test.ts
helpers/session-helper.test.ts
integration/persona-system.test.ts
mcp/integration.test.ts
mcp/real-server.integration.test.ts
persistence/database-migration-v14.test.ts
persistence/database-profiling-integration.test.ts
persistence/database.test.ts
persistence/event-visibility.test.ts
persistence/get-pending-approvals-session.test.ts
persistence/get-pending-approvals-thread-isolation.test.ts
persistence/sql-profiler.test.ts
projects/project-config.test.ts
retry-integration.test.ts
sessions/session-config-integration.test.ts
sessions/session-config.test.ts
sessions/session-permission-auto-resolve.test.ts
sessions/session-permission-override.test.ts
sessions/session-spawn-agent-provider-instances.test.ts
sessions/session-workspace.test.ts
sessions/session.test.ts
tasks/agent-spawning-personas.test.ts
tasks/agent-spawning-update.test.ts
tasks/agent-spawning.test.ts
tasks/task-assignment-message.test.ts
tasks/task-assignment-model-resolution.integration.test.ts
threads/approval-events.test.ts
threads/approval-queries.test.ts
threads/compaction-integration.test.ts
threads/compaction-visibility.test.ts
threads/compaction/enhanced-summarize.test.ts
threads/conversation-builder.test.ts
threads/new-agent-spec.test.ts
threads/thread-manager-stateless-behavior.test.ts
threads/thread-manager-stateless.test.ts
threads/thread-manager.test.ts
token-management/context-analyzer.test.ts
tools/tool-executor-policy.test.ts
tools/validation-flow.test.ts
```

</details>

<details>
<summary>Web package (32 files)</summary>

```
app/api/compaction-sse.test.ts
app/full-flow.test.ts
app/routes/__tests__/api.projects.$projectId.sessions.$sessionId.tasks.$taskId.notes.test.ts
app/routes/__tests__/api.projects.$projectId.sessions.$sessionId.tasks.$taskId.test.ts
app/routes/__tests__/api.projects.$projectId.sessions.$sessionId.tasks.test.ts
components/timeline/tool/task-integration.test.ts
components/timeline/tool/task.test.ts
hooks/__tests__/useTaskHandlers.test.ts
hooks/useSSEStream.e2e.test.ts
lib/client/task-api.e2e.test.ts
lib/client/task-api.test.ts
lib/event-stream-manager-agent-errors.test.ts
lib/server/agent-start-issue.test.ts
lib/server/agent-summary-helper.test.ts
lib/server/agent-utils.test.ts
lib/server/session-service-abort-errors.test.ts
lib/server/session-service-singleton.test.ts
lib/server/session-service-spawn.test.ts
lib/server/session-service-task-events.test.ts
lib/server/session-service.compaction.test.ts
lib/server/session-service.test.ts
lib/server/session-spawn-agent.test.ts
lib/server/thread-manager-caching.test.ts
lib/server/thread-manager-delegate.test.ts
lib/task-metadata-realtime-integration.test.ts
```

</details>

<details>
<summary>New test files added (25 files)</summary>

```
packages/agent/src/__tests__/agent-process.delegate.e2e.test.ts
packages/agent/src/__tests__/agent-process.e2e.test.ts
packages/agent/src/__tests__/agent-process.event-seq.e2e.test.ts
packages/agent/src/__tests__/agent-process.jobs.e2e.test.ts
packages/agent/src/__tests__/agent-process.providers.e2e.test.ts
packages/agent/src/__tests__/agent-process.subagent.e2e.test.ts
packages/agent/src/__tests__/durable-events.test.ts
packages/agent/src/__tests__/providers-connections.test.ts
packages/agent/src/__tests__/server-smoke.test.ts
packages/agent/src/__tests__/session-set-mode.e2e.test.ts
packages/agent/src/storage/__tests__/event-log.test.ts
packages/agent/src/storage/__tests__/session-store.test.ts
packages/cli/src/__tests__/args.test.ts
packages/cli/src/__tests__/e2e.configure-multi-connections.test.ts
packages/cli/src/__tests__/e2e.configure.test.ts
packages/cli/src/__tests__/e2e.lace-agent.test.ts
packages/cli/src/__tests__/e2e.openai.test.ts
packages/cli/src/__tests__/e2e.test.ts
packages/core/src/tools/toolcontext-no-agent.test.ts
packages/ent-protocol/src/__tests__/ids.test.ts
packages/ent-protocol/src/rpc/__tests__/peer.test.ts
packages/ent-protocol/src/schemas/__tests__/protocol-shapes.test.ts
packages/ent-protocol/src/transport/__tests__/stdio.test.ts
packages/supervisor/src/__tests__/supervisor-agent-process.e2e.test.ts
packages/supervisor/src/__tests__/supervisor-http.permission-race.e2e.test.ts
```

</details>
