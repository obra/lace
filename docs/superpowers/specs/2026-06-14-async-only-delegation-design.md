# Async-Only Delegation — Design

**Status:** Design (approved direction; pending /par review)
**Date:** 2026-06-14
**Repos touched:** `lace` (mechanism), `sen-core-v2` (agent guidance)

## Goal

Remove blocking subagent waits from lace so a parent agent can never go deaf to
its human while a subagent runs. Delegation becomes async-only: every
`delegate` returns immediately, and the parent learns of completion through a
durable, always-delivered notification.

## The problem

A Sen coworker stopped answering its human for minutes at a time while a
delegated browser job ran. The human had to prod twice before she replied,
*"Sorry — was waiting for the subagent."*

Root cause, confirmed in code:

- `job_output`'s `block` parameter **defaults to `true`**, and a blocking wait
  is floored at 120 s (`job_output.ts:19,74`). A casual "just check" call
  therefore holds the parent's turn open for up to two minutes.
- `delegate`'s `background` parameter **defaults to `false`** (sync), which
  blocks the parent for the subagent's entire duration (`delegate.ts:31,393`).
- Inbound Slack drains only **on future turns** (`sen-core main.ts:582`), and a
  held-open turn starts no future turn. So while the parent blocks on a
  subagent, the human's messages queue until the job finishes.

Blocking waits and the human's voice compete for the same turn, and the
subagent wins. That is the defect.

## The decision

Delete the blocking path rather than make it interruptible. One pattern, no
footgun. The async path already exists, is already documented as canonical, and
— critically — already delivers completion reliably without the parent
blocking (see Reliability basis). Making the blocking path human-preemptible
would add abort plumbing to the highest-blast-radius code to preserve a path we
are choosing not to keep.

**Sync mode is removed entirely**, not merely discouraged. A "short sync for
trivial subagents" was considered and rejected: it is the exact bet that
becomes a deaf window when a job runs slower than expected, and the saved
round-trip is negligible for an interactive coworker.

## What changes

### lace — `delegate` tool (`tools/implementations/delegate.ts`)

- Remove the `background` parameter from the schema (`:31`). Delegation is
  always async.
- Remove the sync-mode branch (`:393-428`): the `Promise.race` on
  `job.completion`, the `delegate jobId=` preamble, and the synchronous output
  return.
- The async return becomes the only return: `{ jobId, status: "started" }`
  immediately (the existing background path, `:388-390`).
- Rewrite the tool description: drop the "Sync mode" paragraph (`:93`) and the
  `background` parameter doc (`:98`); present the async flow as *the* flow;
  remove the now-impossible `job_output(block=true)` anti-pattern note;
  correct the `resume` note that mentions "sync or background" (`:99`).
- Keep `prompt`, `description`, `resume`, `progressIntervalMs`, `connectionId`,
  `modelId`, `persona` unchanged.

### lace — `job_output` tool (`tools/implementations/job_output.ts`)

- Remove `block` and `timeoutMs` from the schema (`:19-20`).
- Remove the blocking wait (`:70-79`) and the
  `JOB_OUTPUT_MIN_BLOCKING_TIMEOUT_MS` constant (`:15`). The tool is
  snapshot-only: return current status + output, never wait.
- Rewrite the description for snapshot-only semantics; keep the "use
  `job_notify`, not blocking waits" framing (now enforced by the absence of a
  blocking option).
- Keep `jobId` and `byteOffset`.

### lace — `job_notify` tool

- Keep as is. It remains the way to opt into progress notifications and
  selective terminal coverage. It is **not required** for basic completion
  delivery — the always-on fallback covers that (see Reliability basis).
- Audit its description for any "blocking wait" reference and align it.

### sen-core — delegation guidance (the load-bearing rewrite)

Today both guidance surfaces teach sync-only delegation and are drifted from
lace's real schema. Rewrite both:

- `agent-runtime/user/core_identity/instructions/delegating-to-subagents.md`
- `agent-runtime/system/sen-core/skills/innate/delegating-to-subagents/SKILL.md`

The new mental model they must teach:

1. `delegate(prompt=..., persona?=...)` returns immediately with a `jobId`.
   It does not pause your turn.
2. Return to your human. Answer them. Do other work. You stay responsive while
   the subagent runs.
3. When the job reaches a terminal state, a
   `<notification kind="job-completed|job-failed|job-cancelled">` block arrives
   on your next turn — automatically, even if you did not call `job_notify`.
4. Read the result with `job_output(jobId)` (a snapshot) and decide what's
   next: act on it, `delegate(resume=jobId, ...)` to continue the
   conversation, or move on.

Also encode the one sharp edge: **never** subscribe with `job_notify(on=['failed'])`
alone — a successful job then sends nothing ("silence is not success"). Either
rely on the always-on fallback or subscribe to all terminal kinds.

Fix the schema drift: the guidance must use lace's real parameters
(`prompt`, optional `persona`), not the removed `delegate(subagent, task,
expected_response)` form.

### What we deliberately do NOT change

- The `ent/job/output` RPC handler's blocking path (`rpc/handlers/jobs.ts:59-70`)
  and the `EntJobOutputRequestSchema` `block`/`timeout` fields stay. No
  production caller reaches them (CLI and sen-core never call them); they are
  exercised only by protocol tests. Leaving them keeps the protocol surface and
  those tests stable, with zero production effect. Removing them is out of
  scope.

## Reliability basis (why notify-only is safe)

The blocking wait's only unique behavior is periodic self-release. It protects
against nothing the async path fails to handle:

- **Every terminal path emits a notification.** `finalizeJob` runs on normal
  completion, on abnormal child exit (a non-zero/signal exit closes the child
  peer, rejecting the parent's RPC → catch/finally → finalize,
  `subagent-job.ts:265-291`), and on setup error (`:318`). Crash, OOM, and
  SIGKILL all produce a `job-failed` notification.
- **Delivery does not depend on the model subscribing.** `fanoutToInject` calls
  `inject()` once as an always-on fallback when no subscription exists
  (`job-manager.ts:503-507`). A finished delegate wakes the parent even if it
  never called `job_notify`.
- **Notifications are durable.** Each is an `appendDurableEvent`
  (`context_injected`, `priority:'immediate'`) written to `events.jsonl`
  (`inject-notification.ts:61-68`). It survives a busy parent and a process
  restart; the runner recomputes position from the event log.
- **Idle wake is immediate.** When the parent is idle, the inject triggers an
  internal turn so it picks the event up at once (`inject-notification.ts:75-77`).
- **Restart reconciles.** `applyRunningStatus` marks any event-log `running`
  job absent from the live map as `failed` (`job-manager.ts:268-274`), so a
  restart cannot strand a job as eternally "running."
- **A hung subagent that never exits** is reaped by the shim's per_invocation
  idle-TTL (`subagent-job.ts:319-320`), which exits the child and fires the
  notification. Blocking would have re-polled "running" until the same reap.

## Behavioral contract

- A parent that delegates and returns is woken by a terminal notification — no
  explicit wait, no polling.
- A parent always processes an inbound human message promptly, because no turn
  is ever held open waiting on a subagent.
- `job_output(jobId)` is a pure snapshot; it never blocks.

## Risks and mitigations

- **An extra turn round-trip per delegate.** Async-only spends a turn to
  dispatch and another to consume the result, where sync returned inline.
  Accepted: negligible for an interactive coworker; the responsiveness win
  dominates. Batch pipelines, if ever needed, belong in a workflow abstraction,
  not a blocking primitive.
- **The model's mental model shifts.** Mitigated by the sen-core guidance
  rewrite, which is required regardless because the current guidance is wrong
  (drifted schema, sync-only).
- **"Silence is not success."** Mitigated by guidance: rely on the fallback or
  subscribe to all terminal kinds; never `failed`-only.
- **Core-loop blast radius.** Mitigated by TDD, adversarial (/par) review of
  both spec and implementation, and a post-deploy live test of the exact
  responsiveness scenario.

## Testing strategy

- **Schema/shape (lace):** `delegate` rejects `background`; `job_output`
  rejects `block`/`timeoutMs`. `delegate` always returns
  `{ jobId, status:"started" }`.
- **Convert existing blocking/sync tests:** `delegate.test.ts` sync cases
  (`:92,:480,:515,:605`) → async assertions; `job-tools.test.ts` block case
  and `job_output-clamp.test.ts` (whole file) → removed/rewritten for
  snapshot-only.
- **Delivery:** a terminal state with no subscription still injects a wake
  (fallback); abnormal child exit injects `job-failed`.
- **Responsiveness (the regression that started this):** while a delegate job
  runs, an inbound message is processed before the job completes.
- **Untouched:** `ent-protocol.spec.ts` and the e2e RPC block tests stay green
  (the RPC blocking path is retained).

## Rollout

Branch work in `lace` (`async-only-delegation`) and `sen-core-v2`. Build + test
green in both. Deploy to the live coworker via `coworker upgrade`, then
live-verify: dispatch a long subagent, message the coworker mid-run, and
confirm an immediate reply.

## Out of scope

- Removing the `ent/job/output` RPC blocking path or its protocol schema.
- Any change to how the parent handles its own long-running sync tools (e.g. a
  long `bash`) — that is not a subagent wait.
- A workflow/pipeline abstraction for batched dependent subagents.
