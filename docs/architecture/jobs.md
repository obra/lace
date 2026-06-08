# Jobs system architecture

This document describes Lace's jobs system as implemented in this checkout. It is intentionally code-path oriented: if behavior changes, update the references below alongside the code.

## Scope and vocabulary

A **job** is one asynchronous unit of work owned by the current parent session. Lace currently has two job types (`JobType` in `packages/agent/src/server-types.ts`):

- `bash`: a shell command running in the configured tool runtime.
- `delegate`: one subagent turn spawned by the `delegate` model tool.

A **delegate session** is different from a delegate job. A delegate session is the subagent's persisted conversation history. Each call to `delegate(prompt=...)` creates a new job; `delegate(resume=<prior jobId>, prompt=...)` creates another new job that binds to the prior job's subagent session. This distinction is surfaced directly in the `delegate`, `job_notify`, and `jobs_list` tool descriptions (`packages/agent/src/tools/implementations/delegate.ts`, `job_notify.ts`, `jobs_list.ts`) and in the persona delegation instructions (`packages/agent/config/agent-personas/sections/delegation.md`).

A **parent session** is the active Lace session that owns the job manager. Jobs are scoped to this active session's session directory. Job history is persisted in that session's durable event log.

A **run** is the execution of one job process. For `delegate` jobs, a run may create or resume a child delegate session; for `bash` jobs, a run is one process invocation. Lace does not model a separate durable run id in the jobs subsystem; the durable identity is `jobId`, and delegate continuation identity is `subagentSessionId`.

Important identifiers:

- `jobId`: generated as `job_${randomUUID()}` when a job is created (`packages/agent/src/jobs/job-manager.ts`, `packages/agent/src/jobs/job-creation.ts`).
- `parentJobId`: optional job nesting link, used when subagents start nested jobs and those child job ids are forwarded/namespaced into the parent.
- `sessionId`: parent Lace session id. The active session supplies the session directory for logs and events.
- `subagentSessionId`: delegate conversation id assigned by the child `session/new` or supplied by resume/preallocation; persisted in `job_session_assigned` so later `delegate(resume=<jobId>)` can find the child session.
- `turnId`/`turnSeq`: the parent turn context captured on job creation and reused when emitting job updates.

## Main components

### Model-facing tools

The tool implementations live in `packages/agent/src/tools/implementations/`:

- `delegate.ts`: creates `delegate` jobs through `JobManager.createJob('delegate', ...)`. It supports synchronous and background modes, `resume`, provider/model overrides, persona bundles, per-invocation workspace tracking, and progress cadence override.
- `job_notify.ts`: registers lifecycle/progress subscriptions through `JobManager.subscribe()`.
- `job_output.ts`: reads status and output for an in-memory running job via `JobManager.getJob()` and `JobManager.getJobOutput()`; optionally blocks on `job.completion`.
- `jobs_list.ts`: lists durable job records through `JobManager.listJobs()` with status/type/limit filters.
- `job_kill.ts`: cancels running jobs through `JobManager.cancelJob()` and optionally disposes tracked per-invocation delegate workspaces through `WorkspaceReaper`.

These tools require a `jobManager` in `ToolContext`; each returns a structured tool failure if it is absent.

### JobManager

`packages/agent/src/jobs/job-manager.ts` is the session-scoped service that owns:

- the in-memory running job map: `Map<string, JobState>`;
- cached durable list reconstruction from the active session event log;
- job subscriptions and per-job subscription indexes;
- progress notification batching;
- job creation, internal finalization, cancellation, output reads, and streaming-mode configuration.

`AgentServerState.jobManager` replaces older scattered job state (`packages/agent/src/server-types.ts`). Job execution itself is delegated to dependencies injected into `JobManagerDeps`: `runShellProcess`, `runSubagentProcess`, `persistEvent`, `emitUpdate`, optional `setupProgressTimer`, and optional `fetchEmbedderSpawnEnv`.

### Execution helpers

- `packages/agent/src/jobs/shell-job.ts` starts shell processes via a `RuntimeExecutionBinding`, captures stdout/stderr, enforces permissions, writes the per-job log, emits `job_update` stream events, and finalizes status from the process exit.
- `packages/agent/src/jobs/subagent-job.ts` spawns a host-side `lace-agent` process, speaks JSON-RPC over stdio, initializes/configures the child session, forwards child updates/jobs/permissions, writes the delegate log, appends subagent diagnostics, and tears down the child process/transport.
- `packages/agent/src/jobs/job-notifications.ts` composes job lifecycle/progress notifications, injects them into the session via the unified notification path, sets progress timers, and finalizes jobs in the server notification path.
- `packages/agent/src/jobs/job-output.ts` contains lower-level byte/tail readers. The current `job_output` model tool uses `JobManager.getJobOutput()` rather than the offset reader.
- `packages/agent/src/jobs/job-derivation.ts` derives job history from durable events for non-JobManager callers.
- `packages/agent/src/jobs/job-file-utils.ts` provides per-job output path and tail helpers.

There is also an older standalone creation/control layer (`packages/agent/src/jobs/job-creation.ts`, `job-control.ts`) with the same core concepts. Current model tool creation goes through `JobManager.createJob()`; the standalone modules are still part of the jobs codebase and tests.

## Job state model

`JobState` is defined in `packages/agent/src/server-types.ts`. Key fields:

- identity: `jobId`, optional `parentJobId`;
- classification: `type: 'bash' | 'delegate'`;
- lifecycle: `status: 'running' | 'completed' | 'failed' | 'cancelled'`, `startedAt`, optional `exitCode`, `finished`, `completion`, `resolveCompletion`;
- output/control: `outputPath`, optional `proc`, optional `permissionAbortController`;
- delegate-specific runtime: `subagentContent`, `childPeer`, `childTransportClose`, `subagentSessionId`, `subagentSessionPreallocated`, `connectionId`, `modelId`, `runtimeBinding`, `executionEnv`, `persona`;
- progress: `progressIntervalMs`, `lastProgressAt`, `lastProgressBytes`, `progressTimer`;
- per-invocation container/workspace: `scratchDirHostPath`, `containerSharing`, `containerSpecName`.

Constants in `server-types.ts`:

- `MAX_CONCURRENT_JOBS = 10`;
- `MAX_JOB_OUTPUT_BYTES = 10 * 1024 * 1024`;
- `DEFAULT_PROGRESS_INTERVAL_MS = 300000` (5 minutes);
- job logs live under `JOB_LOG_DIR = 'jobs'`.

## Creation path

### Common creation

`JobManager.createJob(type, options)` performs the main current creation flow (`packages/agent/src/jobs/job-manager.ts`):

1. Rejects mutually exclusive `newSubagentSessionId` and `resumeSessionId`.
2. Requires an active session; otherwise throws `JobCreationError('No active session', -32001, 'session')`.
3. Enforces `MAX_CONCURRENT_JOBS` by counting in-memory jobs with `status === 'running'`; overflow throws `JobCreationError(..., -32003, 'session')`.
4. Generates `jobId`, `startedAt`, and `outputPath`.
5. Creates a `JobState` and adds it to the in-memory map.
6. Persists a `job_started` durable event containing `jobId`, `parentJobId`, `jobType`, `description`, `command`, optional runtime/workspace/container metadata.
7. Emits a live `session/update` with `type: 'job_started'`.
8. Arms a progress timer only if `progressIntervalMs` was explicitly supplied.
9. Dispatches to `runShellProcess(job)` or `runSubagentProcess(job)`.
10. Returns `{ jobId, job }` immediately; process execution continues asynchronously.

The standalone `createShellJob()`/`createSubagentJob()` in `packages/agent/src/jobs/job-creation.ts` implement the same scaffold/finalize pattern for library/RPC use.

### `delegate` tool creation

`DelegateTool.executeValidated()` (`packages/agent/src/tools/implementations/delegate.ts`) resolves delegate-specific inputs before calling `JobManager.createJob('delegate', ...)`:

- `resume=<prior jobId>` is resolved by scanning `jobManager.listJobs()` for the prior job's `subagentSessionId`. If none exists, the tool fails and includes available jobs and jobs with session ids.
- Fresh per-invocation persona delegates preallocate a child session id (`sess_${randomUUID()}`) so container names and workspace paths can be computed before the child `session/new` call.
- Persona bundles are parsed through the persona registry. Container personas resolve an environment and build a projected runtime binding.
- Per-invocation container delegates reserve and track a child workspace under the results tree using `WorkspaceReaper`; a fresh delegate fails if the parent has reached `LACE_WORKSPACE_MAX_PER_PARENT` (default 128 retained workspaces).
- Per-invocation resume refuses to run if the prior workspace was released or is missing/empty, instead of resurrecting an empty `/work`.
- Per-call `modelId` wins over persona defaults; otherwise persona model defaults can set the subagent model. `connectionId` and unset model/connection fields can be inherited later by the subagent run path.

In background mode (`background=true`), `delegate` returns immediately with JSON text like `{ "jobId": "...", "status": "started" }`. For per-invocation container delegates it also returns `subagentSessionId`, `workspace`, and a `workspaceNote` that frames the workspace as untrusted and possibly incomplete.

In sync mode (`background=false`, the default), `delegate` waits for `job.completion` unless the parent tool call is aborted. It then returns the job output prefixed with `delegate jobId=<id>`. If the sync delegate has a per-invocation workspace, the preamble includes the workspace framing and a reclaim hint.

## Execution path

### Shell jobs

`createRunShellJobProcess()` in `packages/agent/src/jobs/shell-job.ts` returns the runner used by the server. It:

1. Reads the active session and effective approval mode.
2. Cancels immediately if approval mode is `deny`.
3. If permission is required for `bash`, emits a `job_update` with `tool_use` status `awaiting_permission`, requests permission from the client, then either proceeds, records denial, or cancels on request failure.
4. Builds a runtime from the job's `runtimeBinding`, or a default bounded host binding for the active session workdir.
5. Starts `/bin/bash -c <command>`. On POSIX it runs detached and adapts the runtime process so cancellation can signal the whole process group.
6. Appends stdout and stderr to the per-job output log until `MAX_JOB_OUTPUT_BYTES` is reached.
7. Emits `job_update` `text_delta` events for stdout/stderr unless job streaming mode is `none`.
8. On process completion, sets `completed` for exit code `0`, `failed` otherwise, unless the job was already cancelled; then finalizes with the exit code.
9. On start/runtime errors, appends a `[BASH ERROR]` block, marks failed, and finalizes with exit code `1`.

`jobStreaming`/`JobManager.streamingMode` supports `'full' | 'coalesced' | 'none'`; the inspected shell runner only suppresses stream updates when the mode is `none`.

### Delegate/subagent jobs

`runSubagentJobProcess()` in `packages/agent/src/jobs/subagent-job.ts` is the delegate runner. It:

1. Validates an active parent session and `subagentContent`; missing prerequisites fail the job and append `[SUBAGENT ERROR]` to the job log.
2. Builds any runtime binding augmented with `executionEnv`, then deletes `job.executionEnv` so secrets/env are not retained on `JobState` longer than needed.
3. Creates an ephemeral host `$TMPDIR` under `<results-base>/.tmp` for the child host process. Normal/finally cleanup removes it; SIGKILL leaks are bounded to that tree.
4. Spawns a host-side `lace-agent` process and creates an NDJSON JSON-RPC peer over stdio.
5. Captures child stderr; abnormal child exits persist a diagnostic block and close the peer so pending RPC requests reject instead of hanging.
6. Registers child `session/update` handlers for:
   - child `job_started`, `job_finished`, and `job_update`, mapped into parent-visible/namespaced jobs;
   - direct delegate `text_delta`, appended to the parent job log and emitted as a parent `job_update`;
   - child `tool_use`, namespaced as `<parentJobId>:<childToolCallId>`, mirrored into the job log, and forwarded as `job_update`;
   - child `context_injected`, forwarded as a job update;
   - `pending_reminders_on_exit`, converted in the parent process into a `subagent-exited` notification event.
7. Registers child `session/request_permission` forwarding. Child job ids and tool call ids are mapped/namespaced before asking the parent client. If the parent job has finished or been cancelled, permission returns deny.
8. Initializes the child process with inherited capabilities, job streaming mode, persona/environment search paths, skill dirs, MCP base dir, and effective config inherited from the parent.
9. Either resumes a child session (`session/resume`) or creates one (`session/new`). Three cases are explicit in code:
   - resume: `subagentSessionId` exists and is not preallocated;
   - preallocated fresh: `subagentSessionId` exists with `subagentSessionPreallocated === true`, and the child must echo it back;
   - legacy fresh: no id, child mints one.
10. Persists `job_session_assigned` with `jobId` and `subagentSessionId` for future resume.
11. Applies inherited/effective provider config, calls `ent/session/configure` for `connectionId`, and `session/set_config_option` for `modelId`.
12. Sends `session/prompt` with `subagentContent` and maps the returned stop reason to a job status. Stop details/refusals/provider failures are appended as `[SUBAGENT STOP: ...]` diagnostic output.
13. On errors, marks failed unless already cancelled and appends a `[SUBAGENT ERROR]` block including JSON-RPC code/data and buffered stderr when available.
14. In `finally`, SIGTERMs the child, waits up to 3 seconds for graceful exit/reminder emission, SIGKILLs if still alive, closes the peer and transport, finalizes the job, and removes the host tmpdir. Per-invocation `/work` teardown is deliberately left to the shim/workspace reaper, not this runner.

Nested child jobs are represented in the parent by mapping child job ids to `${parentJobId}_${childJobId}`. Forwarded records are added to the parent `JobManager` in memory and persisted as parent-session `job_started`/`job_finished` events, with `parentJobId` mapped to the parent job or mapped child parent.

## Output model

Each job has an output file at `getJobOutputPath(activeSession.dir, jobId)` under the session job log directory. Runners append to this file under the session mutex (`runExclusive`) and cap writes at `MAX_JOB_OUTPUT_BYTES`.

`JobManager.getJobOutput(jobId)` reads the full output file for the active session and returns an empty string if there is no active session or the file is missing.

The `job_output` model tool (`packages/agent/src/tools/implementations/job_output.ts`) currently requires the job to exist in the in-memory running job map. If `jobManager.getJob(jobId)` returns missing, the tool fails with `Job <id> not found`; it does not currently fall back to durable `jobs_list()` records. With `block=true` and a running job, it waits for `job.completion` or timeout. The requested timeout is clamped upward to `JOB_OUTPUT_MIN_BLOCKING_TIMEOUT_MS = 120000`; this is deliberate anti-polling behavior. The returned JSON includes `jobId`, `status`, `output` (trimmed or `(no output)`), and optional `exitCode`.

`packages/agent/src/jobs/job-output.ts` provides lower-level readers with byte offsets, `maxSize`, tail reads, and truncation metadata. Notable behavior: when `afterOffset` and `tailBytes` are both set, the effective start is the later of `afterOffset` and `totalBytes - tailBytes`; `afterOffset` alone is not considered truncation.

## Notification and subscription model

`job_notify` registers subscriptions; notifications are composed and injected by `packages/agent/src/jobs/job-notifications.ts` and routed through `JobManager.fanoutToInject()`.

### Notification kinds

`JobNotificationType` is:

- `completed` → `<notification kind="job-completed" job-id="...">`
- `failed` → `<notification kind="job-failed" job-id="...">`
- `cancelled` → `<notification kind="job-cancelled" job-id="...">`
- `progress` → `<notification kind="job-progress" job-id="...">`

`createQueueJobNotification()` computes output bytes, duration, and a tail preview from the job log. Delegate notifications include the last 8 lines; bash completed notifications include 1 line; other bash notifications include 3 lines. The notification is written via `injectNotification()`. If the agent is idle, the `idleWake` hook schedules an internal turn so the injected event is picked up promptly.

### Subscription semantics

`JobManager.subscribe()` accepts `jobId`, `on`, and optional `filter`:

- Calls are idempotent for the exact same `jobId`, `on` set, and `filter`; the existing subscription is returned.
- Invalid filter regexes are rejected at subscribe time and surfaced by `job_notify` as a tool failure.
- Subscriptions can be registered for unknown/not-yet-added job ids. If a progress subscriber exists when the job is later added, `JobManager.addJob()` arms progress.
- If a job has one or more subscriptions, only matching subscriptions deliver notifications. A `failed`-only subscription does not deliver on completion.
- If a job has no subscriptions, `fanoutToInject()` invokes the inject callback once as an always-on fallback. This preserves terminal wakeups for unsubscribed jobs.
- Filters apply only to `progress`, against the raw tail preview using a multiline regex. Terminal states always ignore filters.
- Progress delivery is batched per subscription for 200ms. Multiple progress fanouts inside the window replace the buffered injection; latest preview wins.
- Terminal fanout flushes pending progress batches for that job before terminal delivery, preventing stale progress notifications after job death.
- `unsubscribe()` cancels a pending progress batch without delivering it; job cleanup flushes batches before clearing subscriptions.

### Progress timers

Progress is opt-in in two ways:

1. Operator-created cadence: a job created with explicit `progressIntervalMs` arms a timer immediately and it survives progress subscriber churn.
2. Subscriber demand: a `job_notify` subscription whose `on` includes `progress` arms the timer if the job is running. If the last progress subscriber unsubscribes and the job did not have explicit `progressIntervalMs`, the timer stops.

The timer interval is `job.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS`. Each tick computes current output file bytes, delta since the last tick, and queues a `progress` notification. The timer self-clears if the job is no longer running.

## Persistence, listing, and rehydration

The durable job history is the parent session's event log, read by `readAllSessionEventLines(sessionDir)`. The relevant events are:

- `job_started`: creates/updates a record with `jobId`, `jobType`, optional `parentJobId`, `description`, `command`, and timestamp as `startTime`.
- `job_session_assigned`: adds `subagentSessionId` to an existing job record.
- `job_finished`: sets `status` to the durable `outcome` (`completed`, `failed`, `cancelled`) and records optional `exitCode`.

`JobManager.listJobs()` reconstructs `JobRecord[]` from these events and caches by `(sessionId, lineCount)`. The cache uses `fileSize` to store line count and `fileMtime` as `0`; event line counts are monotonic, so appends bust the cache. It overlays in-memory status afterward: any durable record still marked `running` but missing from the running job map is reported as `failed`.

`packages/agent/src/jobs/job-derivation.ts` implements a similar derived-job reader and additionally parses persisted `runtimeBinding` when present.

Important limitation: this is history rehydration for listing/resume metadata, not process rehydration. Running processes are kept only in memory. After a restart/session reopen, a job that never wrote `job_finished` is listed as `failed` because it is no longer in the running map.

`jobs_list` formats only `jobId`, `type`, `status`, `description`, and `startTime`, even though `JobManager.listJobs()` may carry `command`, `exitCode`, and `subagentSessionId`. The `delegate` tool uses the richer `listJobs()` result internally to resolve resumes.

## Finalization and result semantics

There are two finalization paths in the codebase:

- `createFinalizeJob()` in `packages/agent/src/jobs/job-notifications.ts` is the server notification path. It marks unfinished jobs terminal, persists `job_finished`, emits live `job_finished`, clears progress timers, queues the terminal notification, and resolves `job.completion`.
- `JobManager.finalizeJob()` in `packages/agent/src/jobs/job-manager.ts` is an internal manager path. It persists/emits `job_finished`, resolves completion, stops progress, removes the job from the running map, and clears subscriptions.

Status conventions:

- Shell exit code `0` → `completed`; non-zero → `failed` (`shell-job.ts`).
- Subagent status is derived from the child prompt stop reason (`subagent-job.ts` via helper functions); diagnostic stop details are appended to output.
- If finalization sees a job still `running`, the notification finalizer converts it to `failed` before persisting. This avoids leaving a terminal event with a running outcome.
- Cancellation sets `status = 'cancelled'`; terminal notification kind is chosen from final status.
- `exitCode` is recorded when supplied by the runner. Delegate jobs may not have a meaningful process exit code for model-level failures; their diagnostic details are in the job output.

One edge to be aware of: `JobManager.finalizeJob()` removes the job from the in-memory map, but `job_output` requires the job to be in that map before reading. Callers relying on `job_output` after a manager-finalized job may see `Job <id> not found`; notification previews and direct log files remain durable, and `jobs_list` can still show the durable record.

## Cancellation, kill, and cleanup

### Plain cancellation

The model-facing `job_kill` tool (`packages/agent/src/tools/implementations/job_kill.ts`) only accepts an in-memory job. With `destroy_container=false`, it requires `job.status === 'running'`; otherwise it fails with the current status. For a running job it calls `jobManager.cancelJob(jobId)` and returns `Job <id> cancelled`.

`JobManager.cancelJob()` sets `status = 'cancelled'` and calls `JobManager.finalizeJob()`. That manager path records the terminal state and removes the job from the in-memory map; it does **not** itself signal `job.proc`. The process-signalling helper is `killJob()` in `packages/agent/src/jobs/job-control.ts`: mark cancelled, abort pending permission, send SIGTERM to the process or POSIX process group, wait up to `waitMs` (default 500ms), and optionally SIGKILL if `forceKill=true`.

The RPC job-control path (`packages/agent/src/rpc/handlers/jobs.ts`) uses `killJob(job, { waitMs: 500, forceKill: true })` for `ent/job/kill` when a running process exists, and session switching/close uses `killAllRunningJobs(..., { waitMs: 500, forceKill: true })` in `packages/agent/src/rpc/handlers/session.ts` before finalizing and clearing jobs. Server wiring should be checked when changing cancellation behavior because the model-facing `job_kill` tool currently uses the manager cancellation path, while RPC/session cleanup use the process-level kill path.

Shell runner permission requests store `permissionAbortController`; process-level kill aborts them. Subagent permission forwarding returns deny if the parent job has finished or been cancelled.

### Per-invocation container/workspace teardown

`job_kill(jobId, destroy_container=true)` is also the reclaim path for per-invocation delegate workspaces:

1. If the job is running, cancel it first.
2. Look up `job.subagentSessionId` in `WorkspaceReaper`.
3. Only dispose if the tracked entry's `parentId` equals the active parent session id.
4. Serialize disposal with `workspaceReaper.runExclusive(childId, ...)` to avoid racing a concurrent resume.
5. `workspaceReaper.dispose()` routes through the container manager/shim release path, destroying the per-invocation container and removing `/work`.

If there is no tracked workspace (host subagent, persistent container, already released/gone), the tool reports that there was no container to destroy. Destroying a per-invocation workspace intentionally makes that delegate session non-resumable; a later `delegate(resume=<jobId>)` refuses with `Cannot resume job ...: this delegation was released; start a fresh delegate.`

Subagent runner cleanup is narrower: it tears down the child host process, JSON-RPC peer/transport, and ephemeral host tmpdir. It does not remove `/work`; the shim/workspace reaper owns that lifecycle.

## Blocking vs non-blocking usage

The intended model-facing pattern is non-blocking:

1. Start work with `delegate(..., background=true)` or a background shell job.
2. Call `job_notify(jobId)` for terminal states, optionally progress.
3. Return to the user or do other work.
4. When Lace injects a job notification, inspect the preview or call `job_output(jobId, block=false)` if the job is still in memory and full output is needed.
5. For delegate continuation, call `delegate(resume=<prior jobId>, prompt=...)`; that creates a new job under the same subagent session.

Blocking exists but is intentionally discouraged for long work:

- `delegate(background=false)` waits on the subagent job and halts the parent turn.
- `job_output(block=true)` waits for completion but clamps the wait to at least 120 seconds to discourage short polling loops.

## Known edge cases and accuracy notes

- `jobs_list` schema accepts `pending` in its status filter, but `JobStatus` currently has no `pending`; created jobs enter `running` immediately.
- Durable list order is insertion/event order from the reconstructed map, not explicitly sorted newest-first.
- Malformed event log lines are ignored during listing/derivation.
- A `job_finished` event without a prior `job_started` creates a fallback durable record with type `bash`, status from outcome or `failed`, and timestamp as start time.
- `job_notify` can subscribe to an unknown job id. This is intentional and enables pre-registration, but if no such job ever appears the subscription remains until cleared by unsubscribe/job cleanup/session clear.
- Terminal notifications ignore `filter`; a filter attached to a terminal-only subscription is accepted but no-op.
- Progress-only subscriptions can miss job success/failure/cancellation if no terminal subscription is also registered. The tool description calls this out as "silence is not success."
- Progress notifications use output-file byte deltas and tail previews; a tick can fire with `deltaBytes = 0`.
- Output writes are capped by string slice length against a byte constant. For non-ASCII text this is not a perfect byte-level truncation boundary, although file size checks use bytes from `statSync`.
- `job_output` has a `byteOffset` argument but the current tool implementation does not use it; byte/tail support exists in `jobs/job-output.ts`.
- `job_output` only reads jobs present in the in-memory map. Durable completed jobs may appear in `jobs_list` while `job_output` says not found.
- `JobManager.listJobs()` marks durable `running` jobs as `failed` when they are absent from memory. This is how Lace represents orphaned jobs after restart/reopen; it does not attempt to reconnect to processes.
- Subagent abnormal child exit handling closes the JSON-RPC peer to avoid hung parent awaits and appends diagnostics to the job log.
- Subagent final cleanup gives the child up to 3 seconds after SIGTERM to emit pending-reminder notifications, then SIGKILLs and waits up to 500ms.
- Per-invocation resume refuses released/missing/empty workspaces. Persistent personas and host/native subagents do not use the same workspace teardown path.
- Embedder-provided spawn environment for containerized delegate personas is best-effort. Invalid names, non-string values, and collisions with Lace-managed env are dropped with warnings; RPC failure does not block spawn.
- Nested subagent job ids are namespaced with the parent job id. Tool call ids are likewise namespaced before forwarding to the parent.

## Code map

- Types/constants: `packages/agent/src/server-types.ts`
- Manager: `packages/agent/src/jobs/job-manager.ts`
- Current runners: `packages/agent/src/jobs/shell-job.ts`, `packages/agent/src/jobs/subagent-job.ts`
- Notifications/finalization/progress: `packages/agent/src/jobs/job-notifications.ts`
- Output readers: `packages/agent/src/jobs/job-output.ts`, `packages/agent/src/jobs/job-file-utils.ts`
- Durable derivation: `packages/agent/src/jobs/job-derivation.ts`
- Standalone creation/control helpers: `packages/agent/src/jobs/job-creation.ts`, `packages/agent/src/jobs/job-control.ts`
- Model tools: `packages/agent/src/tools/implementations/delegate.ts`, `job_notify.ts`, `job_output.ts`, `jobs_list.ts`, `job_kill.ts`
- Relevant tests: `packages/agent/src/jobs/__tests__/`, `packages/agent/src/tools/implementations/__tests__/`, `packages/agent/src/tools/__tests__/`
