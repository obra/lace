# Completion-policy draft extraction

> Use superpowers:subagent-driven-development. Jesse requested a draft PR to
> preserve this optional work while memory integration proceeds separately.

**Goal:** Present the existing bounded reminder/completion proposal as a small,
standalone, explicitly blocked draft against current main.

**Architecture:** Retain the existing runner and job outcome owner. Extract only
the final reminder predicate, handled-arrival bookkeeping, and reminder-only
wording policy. Do not add a second completion system or a memory dependency.

**Spec:** Jesse's direction to turn the discussed optional changes into draft
PRs and move on. This authorizes preserving the proposed behavior for review; it
does not authorize merging it or resolving Sen's outcome contract by fiat.

**Tech stack:** Existing TypeScript, Vitest, Ent, Node 24.

## Constraints and review focus

- Base is Lace main `8d2d96c1b3d906ca6d4bd203c461ab47e3437839`.
- Reference behavior is frozen candidate
  `a3ca5695a2ed3a0d71e547ba784d37c8b0cf552f`. Relevant changes are the runner
  portion of `4e6d3067f`, handled-arrival `a47ce6341`, and final reminder policy
  `1c954112a`. Intermediate predicate refinements are part of the final proposed
  behavior; do not add new ones.
- Preserve main's newer runtime/provider/context features. Never copy the entire
  old runner or cherry-pick mixed memory commits wholesale.
- No memory, evaluator, private source, research-result, dependency or native
  settlement code belongs in this draft. No new configuration, compatibility
  layer, retry framework or semantic completion classifier.
- Preserve budgets, tool failures, cancellation and explicit incomplete status.
  The draft removes prose-derived incomplete; document its actual consequence:
  an unperformed promise can become a completed delegate job.
- The existing therapist end-to-end regression rejects that consequence. Keep
  that negative contract intact; do not skip or weaken it to make CI green.
  Record its conflict with the proposed unit contract as a merge blocker.
- An arbitrary tool result is progress after an arrival, not proof of a reply.
  Native end_turn is neither proof of user delivery nor successful work.
- Meaningful tests cover completed reports, unfulfilled promises, legitimate
  deferral, the final round, handled and later arrivals, and pause preservation.
  Use existing scripted providers and real test helpers; no new test framework.
- Update affected evergreen descriptions to match branch behavior and explicitly
  state that the proposal has unresolved Sen compatibility. No private examples.
- Reuse the already prepared dependencies. No installations, inference,
  credentials, Docker/VM actions or full local integration suite. Check uptime;
  one heavy process at a time, one test worker, save and read output. Root
  grants the implementer the only local heavy slot. Normal hooks must run.
- Root owns two independent scoped reviews, public privacy check, push and draft
  PR creation. No merge or auto-merge. Preserve frozen checkouts and all
  evidence.

### Task 1: Extract and verify the proposed policy

**Files:** `packages/agent/src/core/conversation/runner.ts`, its intent/context
injection/ordinary runner tests,
`packages/agent/src/jobs/subagent-job-helpers.ts` only where its comment becomes
inaccurate, and `docs/architecture/session-state-projection.md`. Adapt other
existing affected test expectations only when they describe the proposal, with a
reason in the report; the therapist negative integration assertion stays
unchanged.

- [ ] Read exact base and candidate stop paths plus the original therapist
      regression and current Sen compatibility findings before editing.
- [ ] Select behavioral regressions and run the relevant offline baseline once.
      Retain evidence of differences between main and proposed policy.
- [ ] Apply the smallest standalone source change, keeping the current owners.
- [ ] Run focused offline tests, package typecheck, scoped lint/format and diff
      checks serially. Record failures accurately; do not widen the task to
      settle the known policy question or run containers.
- [ ] Update evergreen docs and commit with normal hooks. Self-review scope,
      privacy and absence of memory/native-settlement dependencies.
- [ ] Report exact commits, commands/logs, what was not run, the retained
      negative integration contract, and unresolved merge blockers.

## Merge blockers

The desired Sen outcome for a delegate that reads, repeatedly promises to write,
and never writes must be resolved alongside the successful delivered-work plus
human-deferral case. The source conflict is demonstrated; a fresh end-to-end
failure is not claimed until executed. This draft is deliberately not on the
memory landing dependency chain.
