# Async-Only Delegation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove blocking subagent waits from lace — `delegate` async-only, `job_output` snapshot-only — and rewrite sen-core delegation guidance, so a human-facing agent never goes deaf to its human while a subagent runs.

**Architecture:** Delete the sync/blocking code paths (not make them interruptible). Completion is delivered by lace's existing durable notification + always-on fallback. Keep the `ent/job/output` RPC blocking path (no production caller). See spec: `docs/superpowers/specs/2026-06-14-async-only-delegation-design.md`.

**Tech Stack:** TypeScript, zod schemas, vitest. Repos: `lace` (`packages/agent`), `sen-core-v2` (`agent-runtime`).

**Invariant for every task:** the full suite (`npm test` in the repo) is green at each commit. `bash`'s own `background` param and the exec `run-once` tests are unrelated — do NOT touch them.

---

### Task 1: `job_output` → snapshot-only

**Files:**
- Modify: `packages/agent/src/tools/implementations/job_output.ts`
- Test: `packages/agent/src/tools/__tests__/job_output.test.ts`,
  `packages/agent/src/tools/implementations/__tests__/job-tools.test.ts`,
  `packages/agent/src/tools/implementations/__tests__/job_output-clamp.test.ts`

- [ ] **Step 1: Write the failing test** — in `tools/__tests__/job_output.test.ts`, replace the `block`/`timeoutMs` schema tests with: the schema parse of `{ jobId, block: true }` is rejected (unknown key) and `{ jobId }` succeeds; calling the tool on a running job returns immediately with `status:"running"` (no wait).

- [ ] **Step 2: Run to verify it fails** — `npm test -- job_output.test` → FAIL.

- [ ] **Step 3: Implement** — in `job_output.ts`: delete `JOB_OUTPUT_MIN_BLOCKING_TIMEOUT_MS` (`:15`); change schema (`:17-22`) to `z.object({ jobId: NonEmptyString, byteOffset: z.number().int().min(0).default(0) }).strict()` (drop `block`, `timeoutMs`); in `executeValidated` delete the blocking branch (`:73-79`) and the `block`/`timeoutMs` destructure — read `jobManager.getJob`/`getJobOutput` directly and return the snapshot. Rewrite the description: snapshot-only, "to wait for completion, subscribe with `job_notify(jobId)` and return — you'll be woken on a later turn."

- [ ] **Step 4: Fix the now-broken tests** — `job_output-clamp.test.ts` is entirely about the clamp: delete the file. In `job-tools.test.ts`, remove the `block:true` "waits for completion" case (`~:48-86`); keep the `block:false`/snapshot cases (now just `{jobId}`).

- [ ] **Step 5: Run** — `npm test` → PASS (whole suite; the RPC e2e block tests are untouched and stay green).

- [ ] **Step 6: Commit** — `feat(job_output): snapshot-only, remove blocking wait`.

---

### Task 2: `delegate` → async-only (large — includes the full delegate test sweep)

**Files:**
- Modify: `packages/agent/src/tools/implementations/delegate.ts`
- Modify (fixtures): `packages/agent/src/runtime/test-provider.ts`
- Test (unit): `tools/implementations/__tests__/delegate.test.ts`, `tools/__tests__/delegate.test.ts`, `tools/__tests__/executor-persona-wiring.test.ts`, `tools/implementations/__tests__/delegate-workspace-lifecycle.test.ts`, `jobs/__tests__/persistent-box-never-reaped.test.ts`, `core/conversation/__tests__/runner.persona-registry.test.ts`, `__tests__/session-new.persona-config.test.ts`, `core/conversation/__tests__/runner.test.ts` (delegate cases only)
- Test (e2e): `__tests__/agent-process.delegate.e2e.test.ts`, `.subagent.e2e.test.ts`, `.delegate-config.e2e.test.ts`, `.event-seq.e2e.test.ts`, `.jobs.e2e.test.ts`, `.subagent-early-stop.e2e.test.ts`, `.subagent-intent-text-stop.e2e.test.ts`, `credential-integration.e2e.test.ts`

- [ ] **Step 1: Write the failing test** — in `tools/implementations/__tests__/delegate.test.ts`, add: schema parse of `{ prompt, background: true }` is rejected (unknown key); a `delegate({prompt})` call returns immediately with a result whose JSON contains `"status":"started"` and a `jobId`, WITHOUT awaiting `job.completion` (assert the call resolves before the job's completion promise).

- [ ] **Step 2: Run to verify it fails** — `npm test -- delegate.test` → FAIL.

- [ ] **Step 3: Implement the schema + tool change** — in `delegate.ts`: remove `background: z.boolean().default(false)` from the schema (`:31`); remove `background` from the destructure (`:138`); delete the `if (background)` guard so the async path is unconditional (the existing background return at `~:375-390` becomes the sole return); delete the entire sync-mode block (`:393-428`) — the `abortPromise`, the `Promise.race`, the `delegate jobId=` preamble, and the sync output return. Keep the per_invocation workspace framing that the async return already carries. Rewrite the description (`:80-104`): present the async flow as the only flow; delete the "Sync mode" paragraph and the `background` param doc; fix the `resume` note; remove the `job_output(block=true)` anti-pattern line.

- [ ] **Step 4: Fix unit tests** — convert sync-mode cases in both `delegate.test.ts` files to assert the async started-shape; delete/replace `'accepts background parameter'` and `'defaults background to false'`. Grep `rg "background" packages/agent/src --glob "*.test.ts"` and update every DELEGATE call passing `background` (skip `bash-*`/`run-once`). For tests that relied on inline subagent output, await `job.completion` (or `jobManager.getJob(jobId).completion`) then assert via `getJobOutput`.

- [ ] **Step 5: Fix e2e tests + test-provider** — the test-provider (`runtime/test-provider.ts:~391`) emits `delegate` with no `background`; that's now async. For each e2e test asserting inline output (notably `agent-process.delegate.e2e.test.ts` `toContain("delegate jobId=")` + inline result): restructure to (a) assert the async started return, then (b) drive completion — await the job, or feed a follow-up turn whose fixture consumes the `job-completed` notification and calls `job_output(jobId)` — then assert on that output. Add the follow-up-turn fixtures to the test-provider as needed.

- [ ] **Step 6: Run** — `npm test` → PASS (entire suite, e2e included).

- [ ] **Step 7: Commit** — `feat(delegate): async-only, remove sync mode`.

---

### Task 3: `job_notify` description + always-on fallback wake test

**Files:**
- Modify: `packages/agent/src/tools/implementations/job_notify.ts`
- Test: new test near the jobs tests

- [ ] **Step 1: Write the failing test** — assert that when a job finalizes with NO subscription, `fanoutToInject` still invokes the inject closure once (the always-on fallback wakes the parent). Use the existing job-manager test harness pattern (`jobs/__tests__`).

- [ ] **Step 2: Run** — FAIL (or assert current behavior already passes; if it passes, keep it as a regression guard and note so).

- [ ] **Step 3: Implement** — `job_notify.ts:34` references `delegate(..., background=true)`: reword to the async flow ("`delegate(prompt=...)` returns immediately; subscribe here to be woken on terminal/progress"). No behavior change to the fallback (it already works — this test locks it in).

- [ ] **Step 4: Run** — `npm test -- job` → PASS.

- [ ] **Step 5: Commit** — `docs(job_notify): async wording; test: lock in no-subscription fallback wake`.

---

### Task 4: Hardening — drain pending immediate injects on all turn-exit paths

**Files:**
- Modify: the turn/prompt runner (`core/conversation/runner.ts` and/or the prompt orchestrator that owns turn exit — grep `hasPendingImmediateInjects` to find the existing success-path re-scan)
- Test: `core/conversation/__tests__/` (new case)

**Context:** Today the post-turn re-scan that catches an immediate inject written during a turn runs only on the normal turn return. Abort, slash-command, and error exits clear the active turn without re-scanning. Under async-only the job notification is the sole delivery, so a job completing as such a turn ends could be stranded.

- [ ] **Step 1: Write the failing test** — simulate a job-completion `context_injected` (priority `immediate`) landing while a turn ends via the ABORT/ERROR path; assert a follow-up internal turn is triggered to consume it. (Model the existing success-path re-scan test, e.g. `runner.context-inject.test.ts`.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — locate the existing `hasPendingImmediateInjects` → internal-turn re-scan on the success return; extract it into a helper and invoke it on the abort, slash-command, and error/`finally` turn-exit paths (guarding against re-entrancy / double turns the same way the success path does).

- [ ] **Step 4: Run** — `npm test -- runner` then full `npm test` → PASS.

- [ ] **Step 5: Commit** — `fix(runner): drain pending immediate injects on abort/error turn exits`.

---

### Task 5 (optional, include if cheap): Reconcile orphaned running jobs on session restore

**Files:**
- Modify: session restore path (grep where `applyRunningStatus` / session open runs)
- Test: jobs/session restore test

- [ ] **Step 1: Write the failing test** — a session whose event log has a `running` job with no live process, on restore, injects a `job-failed` notification for it.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — on session restore, for each event-log `running` job absent from the live map, finalize-as-failed and inject `job-failed` (reuse the notification composer). Idempotent.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `fix(jobs): wake parent for orphaned running jobs on restore`.

> If this proves more than ~1 task of work, SKIP it and instead ensure the guidance (Task 6) documents `jobs_list` recovery after a restart. Note the decision in the commit/PR.

---

### Task 6: sen-core delegation guidance rewrite

**Files (sen-core-v2):**
- `agent-runtime/user/core_identity/instructions/delegating-to-subagents.md`
- `agent-runtime/system/sen-core/skills/innate/delegating-to-subagents/SKILL.md`
- `agent-runtime/user/agent-personas/ephemeral-box-worker.md`
- `agent-runtime/user/agent-personas/persistent-box-worker.md`
- `agent-runtime/user/agent-personas/librarian.md`
- `agent-runtime/user/agent-personas/therapist.md`
- `docs/architecture/personas.md`
- Test: `tests/automated/` (new guidance assertion test)

- [ ] **Step 1: Write the failing test** — a test that greps the two primary guidance files and asserts they do NOT contain `background`, `block=true`, `expected_response`, or `delegate(subagent`, and DO contain the async vocabulary (`job_notify` / "returns immediately" / "single-turn"). (Model on `tests/automated/credential-skills.test.ts`.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — rewrite the two primary surfaces to teach the async model (dispatch → return to human → woken by `job-completed/failed/cancelled` notification → `job_output(jobId)` snapshot → act), the "silence is not success" rule, and the "subagents are single-turn, cannot delegate-and-wait" constraint, using lace's real params (`prompt`, optional `persona`). In the 4 persona prompts + `personas.md`, replace the drifted `delegate(subagent, task, expected_response)` form with the real call shape and drop the "your turn pauses" framing.

- [ ] **Step 4: Run** — `npm test` (sen-core) → PASS.

- [ ] **Step 5: Commit** — `docs(sen-core): rewrite delegation guidance for async-only, fix schema drift`.

---

## Final review

After all tasks: dispatch a final code-quality reviewer over the whole diff in both repos, then build + full test green in each (`npm run typecheck && npm test`), then proceed to deploy + live-verify per the spec's Rollout.
