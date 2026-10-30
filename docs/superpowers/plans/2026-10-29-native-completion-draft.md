# Native completion-status draft extraction

> Use superpowers:subagent-driven-development. Jesse requested separate draft
> PRs for optional completion work while the memory landing proceeds.

**Goal:** Preserve the approved native session-settlement observation as an
independent, reviewable draft against current main. This is not a memory runtime
prerequisite and does not change the meaning of successful work.

**Architecture:** Expose a synchronous session-bound observation in the existing
agent-status result. The existing prompt, job finalization and deferred-inject
owners retain reservations across their asynchronous gaps. A completion update
only wakes observers to request fresh status. Keep one owner for each operation.

**Spec:** The previously approved native completion status, followed by Jesse's
instruction to park this optional proposal in a draft. No merging or host
rollout is authorized by this extraction.

**Tech stack:** Existing TypeScript, Vitest, Ent and Node 24.

## Constraints and review focus

- Base is main `8d2d96c1b3d906ca6d4bd203c461ab47e3437839`, independently of the
  completion-policy draft. Preserve main's existing stop policy and provider /
  sticky temporary-context changes.
- Reference implementation: commits `99ad746fec162a48f5d774fe176f25131e61392b`
  and `9f0f019997f76cb12b12cb36f365717f3cc9041e`, with final source in frozen
  candidate `a3ca5695a2ed3a0d71e547ba784d37c8b0cf552f`.
- Extract selected changes; never copy entire old shared files. No memory
  imports, evaluator consumers, private artifacts, provider diagnostics,
  completion-policy changes or Sen pin change.
- Status identifies the active session, latest terminal turn, observed update
  watermark and whether native work remains. Unfinished jobs, prompt finalizers,
  queued notification delivery and deferred followups must not appear settled.
  Job status is not the sole finalizer owner; reservations cover the handoff.
- Consume watermarks only from the producing session's actual runner progress.
  Scheduling fallbacks are not evidence that the runner read an inject. Bind
  deferred drains and wakes to their originating session.
- `settled` means native activity has quiesced. It does not certify delivery,
  successful work, delegate collection or answer quality. These remain caller
  contracts. Ownership is process-local; do not claim durable certification of
  work from an earlier process after restart.
- No new polling loop, timer, timeout, scheduler, compatibility facade, general
  completion classifier or host enforcement framework. Do not make the optional
  draft mergeable by adding adjacent features.
- Use real existing session/log/status helpers for deterministic tests. Hold the
  relevant awaited stage to reproduce finalization and continuation gaps; no
  probabilistic races, repeated suites or arbitrary sleeps.
- Update evergreen notifications docs and protocol contracts to the actual
  branch. Record any retained limitation and reachable issue as a draft blocker.
- Reuse the prepared dependencies. No installations, credentials, inference,
  Docker/VM work or full local integration suite. One heavy process at a time,
  single worker, inspect uptime, preserve all output. Normal commit hooks run.
- Root owns two independent reviews, final public scope/privacy check, push and
  DRAFT PR creation. Preserve all frozen checkouts and evidence.

### Task 1: Extract, verify and document native settlement status

**Files:** New `packages/agent/src/completion.ts`; selected hunks in
`packages/agent/src/{server.ts,jobs/job-notifications.ts}`, RPC handlers
`{agent-status,prompt}.ts`, `packages/ent-protocol/src/schemas/methods.ts`,
focused native-completion and existing prompt/job/status/protocol tests, and
`docs/architecture/notifications.md`.

- [ ] Read exact main owners and reference commits. Identify the memory-specific
      hooks absent on main and omit them rather than importing their subsystem.
- [ ] Run the related offline baseline once. Add the smallest meaningful status,
      finalization and deferred-drain behavioral regressions; capture RED before
      source edits. Preserve main's stop-policy regression unchanged.
- [ ] Implement the existing session-bound reservation/status contract with the
      current owners. Avoid additional infrastructure and incidental refactors.
- [ ] Run focused offline checks, protocol build only if imports require fresh
      output, package typechecks and scoped lint/format/diff checks serially.
      Read every output, record limits and any failures; no silent rerun claims.
- [ ] Update evergreen docs; commit through normal hooks and self-review public
      scope. Report exact commits, commands/logs, known risks and tests not run.

## Disposition

This remains an optional draft even if its local checks pass. Consumers must
separately establish collection, user delivery and useful work. No evaluator
campaign, production enablement or merge is part of this task.
