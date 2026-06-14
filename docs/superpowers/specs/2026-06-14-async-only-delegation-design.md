# Async-Only Delegation — Design

**Status:** Design (approved direction; revised after /par adversarial review)
**Date:** 2026-06-14
**Repos touched:** `lace` (mechanism), `sen-core-v2` (agent guidance)

> Line numbers below are anchors from a point-in-time read; the implementer
> verifies the exact line against the current file before editing.

## Goal

Remove blocking subagent waits from lace so a human-facing parent agent can
never go deaf to its human while a subagent runs. Delegation becomes
async-only: every `delegate` returns immediately, and the parent learns of
completion through a durable, always-delivered notification.

## The problem

A Sen coworker stopped answering its human for minutes while a delegated browser
job ran. The human prodded twice before she replied, *"Sorry — was waiting for
the subagent."*

Root cause, confirmed in code:

- `job_output`'s `block` parameter **defaults to `true`**, and a blocking wait
  is floored at 120 s (`job_output.ts:19,74`). A casual "just check" call holds
  the parent's turn open for up to two minutes.
- `delegate`'s `background` parameter **defaults to `false`** (sync), which
  blocks the parent for the subagent's entire duration (`delegate.ts:31,393`).
- A turn processes only the Slack batch it began with. A new human message that
  arrives **while a turn is held open** is not delivered until the next turn
  starts (`sen-core main.ts` ambient loop drives turns via `sessionPrompt`; the
  `ambient-backlog-remaining` notice, `main.ts:582`, tells the agent queued
  messages "will be delivered on future turns"). A blocking subagent wait holds
  the turn open, so no next turn starts, so the human waits.

Blocking waits and the human's next message compete for the parent's turn, and
the subagent wins. That is the defect.

## The decision

Delete the blocking path rather than make it interruptible. One pattern, no
footgun. The async path already exists, is already documented as canonical, and
already delivers completion reliably without the parent blocking (see
Reliability basis). Making the blocking path human-preemptible would add abort
plumbing to the highest-blast-radius code to preserve a path we are choosing not
to keep.

**Sync mode is removed entirely.** A "short sync for trivial subagents" was
rejected: it is the exact bet that becomes a deaf window when a job runs slower
than expected.

### Accepted consequence: subagents are single-turn

A subagent runs exactly one assistant turn, then is torn down
(`subagent-job.ts` runs one `session/prompt` and SIGTERMs the child in its
`finally`). With sync removed, a subagent that itself calls `delegate` gets back
`{ jobId, status:"started" }` but has **no future turn** in which to receive the
child's completion notification. So **nested inline delegation is not
supported** under async-only.

This is an accepted, deliberate constraint (it was already fragile — it worked
only by a subagent blocking inside its single turn). Work that needs nested
dependent steps is restructured: the human-facing root agent orchestrates the
levels, or the worker does the dependent step inline rather than via `delegate`.
The guidance rewrite states this constraint plainly.

## What changes

### lace — `delegate` tool (`tools/implementations/delegate.ts`)

- Remove the `background` parameter from the schema (`:31`). The schema is
  `.strict()` (`:38`), so after removal any call passing `background` (true or
  false) is rejected by zod — every test and fixture that passes `background`
  must be updated (see Testing).
- Remove the sync-mode branch (`:393-428`): the `Promise.race` on
  `job.completion`, the `delegate jobId=` preamble, and the synchronous output
  return.
- The async path becomes the only path. Its return is the **existing
  background-path return object** (`:375-390`): `{ jobId, status:"started" }`,
  plus `subagentSessionId` / `workspace` / `workspaceNote` for per_invocation
  container personas. (The async return is a superset, not a bare two-field
  object — assertions must target the started-shape, not exact keys.) The
  per_invocation workspace framing and reaping hints already live on this path
  and are preserved.
- Rewrite the tool description: drop the "Sync mode" paragraph (`:93`) and the
  `background` parameter doc (`:98`); present the async flow as *the* flow;
  remove the now-impossible `job_output(block=true)` anti-pattern note; correct
  the `resume` note that mentions "sync or background" (`:99`).
- Keep `prompt`, `description`, `resume`, `progressIntervalMs`, `connectionId`,
  `modelId`, `persona`.

### lace — `job_output` tool (`tools/implementations/job_output.ts`)

- Remove `block` and `timeoutMs` from the schema (`:19-20`).
- Remove the blocking wait (`:73-79`) and the
  `JOB_OUTPUT_MIN_BLOCKING_TIMEOUT_MS` constant (`:15`). The tool is
  snapshot-only: return current status + output, never wait.
- Rewrite the description for snapshot-only semantics; keep the "use
  `job_notify`, not blocking waits" framing (now enforced by absence).
- Keep `jobId` and `byteOffset`.

### lace — `job_notify` tool

- Keep the tool. It remains how a parent opts into progress notifications and
  selective terminal coverage. It is **not required** for basic completion
  delivery — the always-on fallback covers that (Reliability basis).
- Fix its description: `job_notify.ts:34` references `delegate(..., background=true)`,
  a now-removed parameter. Reword to the async flow.

### lace — leave `bash` alone

`bash.ts` has its own legitimate `background` parameter (a separate primitive).
It is unrelated to delegation and must NOT be touched.

### sen-core — delegation guidance (the load-bearing rewrite)

Both primary guidance surfaces teach sync-only delegation and a drifted schema
(`delegate(subagent, task, expected_response)` rather than lace's real
`prompt` / `persona`). The same drift appears in shipped persona prompts.
Rewrite all of:

- `agent-runtime/user/core_identity/instructions/delegating-to-subagents.md`
- `agent-runtime/system/sen-core/skills/innate/delegating-to-subagents/SKILL.md`
- `agent-runtime/user/agent-personas/ephemeral-box-worker.md` (`~:66`)
- `agent-runtime/user/agent-personas/persistent-box-worker.md` (`~:89`)
- `agent-runtime/user/agent-personas/librarian.md` (`~:58`)
- `agent-runtime/user/agent-personas/therapist.md` (`~:58`)
- `docs/architecture/personas.md` (`~:65`, `delegate(subagent=…)`)

The new mental model they must teach:

1. `delegate(prompt=..., persona?=...)` returns immediately with a `jobId`. It
   does not pause your turn.
2. Return to your human. Answer them, do other work. You stay responsive while
   the subagent runs.
3. When the job reaches a terminal state, a
   `<notification kind="job-completed|job-failed|job-cancelled">` block arrives
   on a later turn — automatically, even if you did not call `job_notify`.
4. Read the result with `job_output(jobId)` (a snapshot) and decide: act,
   `delegate(resume=jobId, ...)` to continue, or move on.

Encode two constraints:
- **"Silence is not success":** never subscribe with `job_notify(on=['failed'])`
  alone — a successful job then sends nothing. Rely on the fallback or subscribe
  to all terminal kinds.
- **Subagents are single-turn:** a subagent cannot delegate-and-wait; nested
  dependent work is the root agent's to orchestrate.

### What we deliberately do NOT change

- The `ent/job/output` RPC handler's blocking path (`rpc/handlers/jobs.ts:59-70`)
  and the `EntJobOutputRequestSchema` `block`/`timeout` fields stay. No
  production caller reaches them (CLI and sen-core never pass `block`); they are
  exercised only by protocol/e2e RPC tests. Leaving them keeps the protocol
  surface and those tests stable, with zero production effect.

## Reliability basis (why notify-only is safe)

The async path delivers completion reliably for the normal and abnormal-exit
cases:

- **Normal completion and abnormal exit emit a notification.** `finalizeJob`
  runs on completion, on non-zero/signal child exit (the exit handler closes the
  child peer, rejecting the parent's pending RPC → catch/`finally` →
  `finalizeJob`, `subagent-job.ts:265-291` triggering the finalize at `:1083`),
  and on setup error (`:318`). Crash, OOM, and SIGKILL produce `job-failed`.
- **Delivery does not depend on the model subscribing.** `fanoutToInject` runs
  the inject closure once as an always-on fallback when no subscription exists
  (`job-manager.ts:503-507`); that closure carries the idle-wake hooks
  (`job-notifications.ts:118-137`), and the delegate finalize is the
  notifying, in-process `createFinalizeJob` (`server.ts:~442`). So a finished
  delegate wakes even an idle, unsubscribed parent. (Verified by /par.)
- **Notifications are durable.** Each is an `appendDurableEvent`
  (`context_injected`, `priority:'immediate'`, `inject-notification.ts:61-68`),
  surviving a busy parent; the runner recomputes position from the event log.
- **Idle wake is immediate** when the parent is idle
  (`inject-notification.ts:75-77`).

### Known delivery gaps (pre-existing; bounded; some hardened here)

The /par review found edges where the blanket "every terminal path notifies" is
not literally true. None is introduced by this change, but async-only makes the
notification the *only* delivery path, so we harden the one that matters:

1. **Mid-turn completion on a non-success turn exit.** The post-turn re-scan for
   pending immediate injects runs only on the normal turn return; the abort,
   slash-command, and error exits clear the active turn without re-scanning. A
   job completing as such a turn ends could leave its notification unconsumed
   until another event triggers a turn. **Hardening (in scope):** run the
   pending-immediate-inject re-scan on all turn-exit paths.
2. **Process restart mid-job.** `applyRunningStatus` reclassifies an orphaned
   `running` job to `failed` only at read time inside `listJobs()`
   (`job-manager.ts:268-274`); it injects no notification. A parent whose
   process restarts mid-job is not proactively woken — it learns the outcome by
   calling `jobs_list`/`job_output`. This is a pre-existing gap (a blocking wait
   also died on restart). **Optional hardening:** on session restore, inject a
   `job-failed` for each orphaned `running` job. Include if cheap; otherwise
   document the `jobs_list` recovery in guidance.
3. **Clean premature child exit** (`code===0` before the child answers the
   RPC, `subagent-job.ts:265`) leaves the parent's request hung with no
   finalize. Pre-existing and rare; out of scope, noted for honesty.
4. **No active session** at finalize time (`job-notifications.ts:197`) drops the
   notification. Pre-existing; out of scope.

- **A hung subagent that never exits** is reaped by the shim's per_invocation
  idle-TTL (`subagent-job.ts:319-320`), which exits the child and fires the
  notification.

## Behavioral contract

- A human-facing parent that delegates and returns is woken by a terminal
  notification — no explicit wait, no polling.
- A human-facing parent always processes an inbound human message promptly,
  because no turn is held open waiting on a subagent.
- `job_output(jobId)` is a pure snapshot; it never blocks.
- A subagent is single-turn and cannot delegate-and-wait.

## Testing strategy

The change is schema + behavior + guidance. Because the `delegate` schema is
`.strict()` and the test-provider emits `delegate` with no `background`
(`runtime/test-provider.ts:~391`, which today selects the sync branch), the
blast radius across tests is wide. The plan must, at minimum:

**lace — unit/schema tests to update or remove:**
- `tools/implementations/__tests__/delegate.test.ts` — sync-mode cases and the
  sync-preamble assertion (e.g. `^delegate jobId=`); convert to async.
- `tools/__tests__/delegate.test.ts` — `'accepts background parameter'`,
  `'defaults background to false'`: remove/rewrite (field is gone).
- `tools/implementations/__tests__/job_output-clamp.test.ts` — entirely about
  `block`/clamp: remove.
- `tools/implementations/__tests__/job-tools.test.ts` — the `block:true` case.
- `tools/__tests__/job_output.test.ts` — `'accepts block parameter'`,
  `'defaults block to true'`, `timeoutMs` default: remove/rewrite.
- Other files passing `background` to delegate (zod will now reject):
  `tools/__tests__/executor-persona-wiring.test.ts`,
  `tools/implementations/__tests__/delegate-workspace-lifecycle.test.ts`,
  `jobs/__tests__/persistent-box-never-reaped.test.ts`,
  `core/conversation/__tests__/runner.persona-registry.test.ts`,
  `__tests__/session-new.persona-config.test.ts`. (Grep `background:` under
  `packages/agent` to enumerate exhaustively before implementing.)

**lace — e2e tests that drive the delegate TOOL's sync branch** (because the
test-provider emits no `background`): `agent-process.delegate.e2e.test.ts`
(notably the `delegate jobId=` + inline-output assertion that will go red),
`.subagent.e2e.test.ts`, `.delegate-config.e2e.test.ts`, `.event-seq.e2e.test.ts`,
`.jobs.e2e.test.ts`, `.subagent-early-stop.e2e.test.ts`,
`.subagent-intent-text-stop.e2e.test.ts`, `credential-integration.e2e.test.ts`.
These need the async flow: dispatch → consume the `job-completed` notification on
a follow-up turn → assert via `job_output`. Updating the test-provider fixtures
to drive that follow-up turn is part of the work.

**lace — new tests:**
- `delegate` rejects `background`; `job_output` rejects `block`/`timeoutMs`.
- A terminal state with no subscription still injects a wake (fallback).
- The post-turn immediate-inject re-scan fires on abort/error turn exits
  (hardening #1).

**Stay green (do not touch):** `ent-protocol.spec.ts` and the e2e RPC `block`
tests (`async-workflow.e2e.test.ts`) drive the retained RPC path, not the tool.

**sen-core:** add/adjust tests asserting the rewritten guidance no longer names
`background`, `block`, `expected_response`, or `delegate(subagent=...)`.

## Rollout

Branch work in `lace` (`async-only-delegation`) and `sen-core-v2`. Build + full
test suite green in both (the e2e suite is part of the gate, not optional).
Deploy to the live coworker via `coworker upgrade`, then live-verify: dispatch a
long subagent, message the coworker mid-run, and confirm an immediate reply.

## Out of scope

- Removing the `ent/job/output` RPC blocking path or its protocol schema.
- The parent's own long-running sync tools (e.g. a long `bash`) — not a subagent
  wait.
- A workflow/pipeline abstraction for batched dependent subagents.
- Nested inline delegation (accepted as unsupported).
