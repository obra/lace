# Recall Phase 0 — Discovery Notes

These notes resolve the two open assumptions in `docs/plans/2026-05-23-recall.md`
before subsequent phases proceed. Both findings are derived from current source,
not from documentation.

## 1. `tool_use` event-write semantics: ONE event per call

Each tool invocation produces **exactly one durable `tool_use` event** in
`events.jsonl`, written at the terminal state with `result` populated. The
optional `result?: ToolResult` on `ToolUseEventData` (`packages/agent/src/storage/event-types.ts:23-30`)
is optional only at the type level — the runner never persists a `tool_use`
event without it.

The single write path is `writeAndAdvance` in the conversation runner
(`packages/agent/src/core/conversation/runner.ts:190-202`). This is the only
helper inside the runner that calls `appendDurableEvent`, and every `tool_use`
call site in the file passes the fully-formed result alongside the input:

- `tool_use` durable writes in `runner.ts`: lines 645–648 (deny mode),
  678–681 (plan-mode denial), 712–715 (tool not found), 749–752 (bash arg
  validation failure), 789–792 (bash background completed), 869–872
  (permission cancel), 909–912 (user denied), and 977–986 (normal terminal
  path: completed / failed / cancelled / denied with `protocolResult`).

The earlier in-flight states (`pending` at line 619, `awaiting_permission` at
816, `running` at 926) are emitted only through `this.deps.onUpdate(...)` for
live UI streaming — they are *not* written to `events.jsonl`. The non-runner
`appendDurableEvent` callers (`server.ts`, `subagent-job.ts`,
`rpc/permissions.ts`, `rpc/handlers/*`, `jobs/job-notifications.ts`,
`notifications/inject-notification.ts`) write other event types
(`permission_*`, `context_injected`, `job_*`, `turn_*`, `prompt`, `message`,
`checkpoint_created`, `files_rewound`) but never `tool_use`. The lone
non-runner mention of `type: 'tool_use'` outside tests is at
`packages/agent/src/jobs/subagent-job.ts:597`, which forwards a `tool_use`
payload inside a `job_update` SessionUpdate envelope to the parent — that
is a transport-only forward, not a durable JSONL write.

**Implication for `RecallTool`:** the indexer can treat a `tool_use` event as
self-contained — `data.toolCallId`, `data.name`, `data.kind`, `data.input`,
and `data.result` are all present in the same row. No correlation across two
rows is required, and there is no possibility of a `tool_use` event missing
its `result` on disk under normal flow. (An incomplete write can occur only
if the process crashes mid-`appendFileSync`, in which case
`deriveNextEventSeqFromEventLog` tolerates the partial line by ignoring it.)

## 2. Built-in tool registration site

The single registration site is `ToolExecutor.registerAllAvailableTools` in
`packages/agent/src/tools/executor.ts:283-311`. The instance list lives at
lines 287–303 — `new BashTool()`, `new FileReadTool()`, …,
`new ManageRemindersTool()` — with `UseSkillTool` conditionally appended at
306–308 when a `SkillRegistry` is wired in. All instances are then handed to
`this.registerTools(tools)` at line 310. The imports for these classes are at
lines 9–24 of the same file.

`packages/agent/src/tools/implementations/index.ts` is a re-export barrel only;
it does not iterate or instantiate. Beyond the constructor list, there is a
parallel name allow-list constant `LACE_BUILTIN_TOOL_NAMES` at
`packages/agent/src/tools/executor.ts:49-66` that documents the same set for
persona-tools filtering. Phase 6 of the recall plan needs to:

1. Add an `import { RecallTool } from './implementations/recall';` near the
   other tool imports (executor.ts:9-24).
2. Add `new RecallTool(...)` to the array at executor.ts:287-303 (the
   constructor signature will need a session-dir / events-root accessor — TBD
   in a later phase).
3. Add `'recall'` to `LACE_BUILTIN_TOOL_NAMES` at executor.ts:49-66 so
   persona-additive tool lists don't filter it out.
4. Optionally re-export from `implementations/index.ts` for symmetry with
   other built-ins.

No other registry site exists for built-in tools. (MCP tools register
dynamically via `registerMCPTools` / `discoverAndRegisterServerTools` at
lines 177-256, which is a different code path and not relevant here.)
