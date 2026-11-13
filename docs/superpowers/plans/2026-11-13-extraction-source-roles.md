# Extraction source roles implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for this single bounded change. Root owns the design; Sol implements and two independent reviewers check it.

**Goal:** Tell the extractor which supplied originals are new work and which were included to reconcile existing accounts, so old support does not become another new account merely because it appears again.

**Architecture:** Serialize the existing primary source handles alongside the existing sources and candidates. Explain the purpose in the extraction system prompt. Retain every existing support, revision, authority and acceptance check; introduce no new rejection rule, storage, deduplication mechanism or queue.

**Tech stack:** Existing TypeScript memory runtime, SQLite authority and one-shot extraction provider.

**Spec and authorization:** Jesse approved completing the remaining recommendations after the two independently qualified repairs. This is the separate observed extraction-input omission recorded in the private release assessment, not an extension of account presentation. Root selected input clarification over a primary-citation acceptance gate or a new deduplication subsystem: those would change which otherwise supported corrections may be accepted and are unnecessary here.

## Constraints

- Keep Sonnet 5.5, existing batching, limits and source validation unchanged.
- Older supporting originals remain eligible evidence for correcting an offered account.
- Do not infer source role from age or current/superseded status.
- Do not promise deduplication when the relevant existing account was not offered.
- Preserve all previous private runs. No fleet changes; deployment remains Reeve-only after qualification.

## One implementation task

Files: `packages/agent/src/memory/extraction.ts`, its direct tests, `packages/agent/src/memory/runtime.ts`, `packages/agent/src/memory/__tests__/runtime.test.ts`, and the stale extraction description in `docs/architecture/automatic-memory.md`.

- [ ] Extend a real-store reconciliation test with two committed document paths, both still current. Observe the structured extraction request: only the newly pending source is primary; the old original remains supplied with the existing candidate's support. Preserve the existing supported revision assertion. Run it once and retain its meaningful failure.
- [ ] Add required `primarySourceIds: readonly string[]` to `extract`, next to its sources argument; serialize it in the user payload. At the sole runtime call pass `primaries.map(sourceHandle)`. Adapt direct test callers without changing their source semantics.
- [ ] Explain that primary sources identify new originals to learn from, while other originals are supplied to check and reconcile offered accounts. Reappearing unchanged support is not new history and alone is not a reason to create another account or rewrite an unchanged one. Keep supported corrections possible; do not add a hard primary-citation gate or a text-matching prompt test.
- [ ] Run the focused extraction/runtime tests and typecheck serially, retaining logs. Update the evergreen extraction description, review the small diff and commit with normal hooks. Two independent source reviews precede native qualification.

## Native qualification

Use the existing native extraction helper and a small fresh fictional fixture. One Sonnet wake seeds an account. Clone that closed accepted state for one old/candidate follow-up each, with identical model settings and source bytes. The follow-up is a different committed document containing a real correction to one part of the account and a genuinely new durable fact. Older support contains a distinct unchanged fact; both paths remain current.

Verify the observed offer and request roles before interpreting model output. Preserve raw proposals and accepted revisions. The candidate must incorporate the explicit correction into the existing account, learn the new durable fact, preserve the unchanged fact, and avoid recreating or revising that unchanged fact without changed understanding. If baseline already behaves correctly, report the comparison as inconclusive on improvement; do not rerun to obtain a contrast. Review both outcomes independently. No answer-model change or new answer campaign is part of this repair.
