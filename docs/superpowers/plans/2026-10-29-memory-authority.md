# Memory ownership and permissions foundation

> Use superpowers:subagent-driven-development. This is the first small memory
> landing on current main, following the provider and temporary-context PRs.

**Goal:** Give both required memory writers one small, independently testable
identity, ownership and grant boundary, without enabling memory in Sen yet.

**Architecture:** One existing SQLite authority, one current host-owned
generation, host-configured role grants and private domain checks. Move these
checks out of the candidate's coupled store service. There is no second store,
scheduler, runtime lock, repository abstraction or compatibility facade.

**Spec:** Jesse wants the required memory functionality landed sanely with an
incredibly clean implementation. This is bounded extraction within the approved
single-authority/two-writer design. The candidate remains the behavioral
reference. The optional completion-policy and native-status drafts are not
dependencies.

**Tech stack:** Existing TypeScript, SQLite/better-sqlite3, Zod, Vitest and
Node24.

## Scope and constraints

- Start independently from current Lace main with provider fixes and sticky
  temporary context already present. Preserve all newer main code. Use frozen
  candidate a3ca5695a2ed3a0d71e547ba784d37c8b0cf552f only as a reference.
- One internal `memory/authority.ts` module owns database identity, generation
  claim, policy replacement and access checks. No new public RPC surface or Sen
  consumer is enabled. Raw database handles remain implementation plumbing, not
  an invitation for hosts to author note rows.
- Reuse candidate contracts: openMemoryDatabase, memoryOwnerGeneration,
  claimMemoryOwner, configureMemoryRoles, assertMemoryAccess,
  assertMemoryCollectionAccess and resolveMemoryBinding. Keep helpers private.
  Use one canonical schema for role grants and bindings in shared protocol;
  import its inferred types rather than copying a second schema into memory.
- Initialize only the existing authority columns required here. Source, note,
  extraction, projection and history tables belong to their actual components.
  Preserve instance identity checks before changing an existing database's
  pragmas, private file permissions, WAL/FULL, finite SQLite wait and immediate
  transactions. Do not copy old pre-release migrations or promise compatibility
  with an existing experimental candidate database.
- Verify existing-instance identity before changing pragmas even when the caller
  permits creation and the file already exists. The candidate only guarantees
  this in existing-only mode; add a real-state regression for both modes.
- Claiming an owner still requires the host's existing runtime lock. It rotates
  the generation so stale bindings lose authority; it does not acquire a second
  lock or certify shutdown. No generation can be inferred by a model's input.
- Use plain "memory permissions" in human-facing documentation; "role grants" is
  the schema name. Preserve unknown-role read access with no note/collection
  write permission, as in the approved candidate.
- Host policy determines named roles; root-persona children never inherit root
  write privileges. Preserve existing separate note/collection grant semantics
  and policy revocation. Do not add a new privilege model or role registry.
- No imports from sources, eligibility, store, extraction, backfill, providers,
  runner, Sen or runtime locks. No recall-budget framework without a caller.
  Missing-authority admission for an already-memory-bound saved session belongs
  to the later session integration and must exist before enablement. Readers in
  this module still must not create a missing database.
- The target is roughly 250-350 production lines. If the dependency inventory
  expands beyond this authority contract, stop and report the concrete cause. No
  extra layers, speculative configuration or unused generic extension points.
- No memory integration or quality/superiority claim follows from foundation
  tests. The remaining source, lifecycle, deliberate writer, independent writer,
  recall, automatic presentation and Sen adoption work remains required.
- One local heavy process at a time, single test worker, save/read all output.
  Reuse dependencies, no inference, credentials, Docker/VM or full local suite.
  Normal hooks and targeted type/lint/format checks. Two independent reviews
  before any publication/landing; root coordinates and owns GitHub actions.

### Task 1: Extract and verify the authority contract

**Files:** new `packages/agent/src/memory/authority.ts` and focused authority
unit tests; only role/binding schema/type additions in shared protocol plus
focused schema tests; `docs/architecture/memory-authority.md` and a CODE-MAP
link. No package export change unless the existing wildcard actually fails to
expose an intended import. No session config/method or other runtime
integration.

- [ ] Read exact source functions, dependency assessment and independent design
      review before editing. Preserve separate collection authorship even when
      note mutation is denied, and role resolution rather than intersecting all
      child permissions with the parent. Identify and preserve all non-obvious
      policy rules.
- [ ] Write real temporary-SQLite behavioral tests, capture RED without source:
      stable identity/reopen; wrong-instance rejection without mutation; missing
      existing-only open cannot create; owner rotation fences old bindings;
      root-only policy replacement; role/producer mismatch; root-role child
      cannot elevate; collection read/write membership; changed grants revoke
      stale rights; rejected policy transaction rolls back.
- [ ] Implement the small domain boundary and canonical schemas. Keep SQL and
      ownership explicit; no mocks for the authority behavior being tested.
- [ ] Run the focused cohort, fresh protocol build if type exports require it,
      package typechecks, scoped lint/format and diff checks serially. Inspect
      outputs and document actual limits; do not silently rerun failures.
- [ ] Update evergreen docs to the foundation actually present and its host-lock
      precondition. State the missing integration and avoid describing candidate
      note/extraction behavior as shipped.
- [ ] Commit through normal hooks, self-review scope, report exact commits and
      logs plus any real blockers. Root owns review and landing coordination.
