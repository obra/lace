# Provider request correctness implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Preserve
> the separate memory project and its evidence.

**Goal:** Extract the verified Gemini SDK configuration and Gemini/Chat
tool-result ordering repairs onto current Lace main, independently of memory.

**Architecture:** Keep the existing provider adapters and converters. Correct
where Gemini's SDK expects configuration and where mixed user/tool messages are
emitted; add real-SDK offline regressions. No new runtime abstraction.

**Tech Stack:** TypeScript, existing installed provider SDKs, Vitest, Node 24.

**Spec:** Jesse's October 29 instruction to split provider fixes before building
standalone temporary request context. The concrete contract follows.

## Contract and constraints

- Base is refreshed `origin/main` at `2948e3894af560e4c6fa9cbfa6200397fd1cb018`.
- Gemini sends system instructions and declarations via
  `GenerateContentParameters.config`, preserving schema/output limits.
- Required tool results precede same-turn user text/images in Gemini and OpenAI
  Chat. Anthropic and Responses retain their already-correct ordering.
- Both streaming and nonstreaming entry points retain required messages, tool
  IDs, success/error data and existing image behavior.
- No memory types, RequestSnapshot, extraction, ranking, memory docs, historical
  evaluation captures or unrelated runtime fixes enter this branch.
- No dependency additions/rebuilds, live inference, credential reads,
  Docker/Apple operations, generic retry redesign or automatic full-suite
  command. The repository full command invokes container integrations; use
  inspected offline tests only and record that limitation.
- Existing Node24 and owned dependency links are provided. One heavy process at
  a time; inspect uptime, save/read logs, use one worker and the network guard
  supplied by the parent.
- Normal pre-commit hooks must run. Do not push, merge or spawn subagents.

## Review focus

- Mixed tool results and ordinary user content must keep result
  correlation/order, including multiple results and existing images/error data.
- Actual SDK serialization must retain Gemini instructions/tools, not merely a
  mocked SDK object.
- Both public entry points must exercise the same corrected behavior.
- Tests must derive structured expectations independently; no large
  rendered-string/regex assertions.
- The extraction must compile on main without importing memory-project changes.

### Task 1: Extract and verify the provider repairs

**Files:** Modify `packages/agent/src/providers/gemini-provider.ts`,
`packages/agent/src/providers/format-converters.ts`; add/adapt real-SDK tests
under `packages/agent/src/providers/__tests__/`; update only affected Gemini
provider expectations/goldens and `docs/architecture/prompt-cache-stability.md`.

**Interfaces:** Preserve all existing public signatures and adapter behavior
outside the three confirmed repairs. Reference commits in the historical
diagnostic checkout are `118028302`, `7952f1ff5`, and `d86b72877`; port the
narrow changes, never cherry-pick memory-dependent tests/docs wholesale.

- [ ] Read the source and reference diffs; run an inspected focused baseline
      with saved output.
- [ ] Add real-SDK tests using synthetic fetch responses and synthetic keys:
      missing Gemini system/tools on both methods; mixed required content plus
      multiple tool results in Gemini/Chat; existing Anthropic/Responses
      characterization if sharing the narrow fixture. Use real messages
      directly: main has no RequestSnapshot.
- [ ] Run the new cases before source edits and save the expected
      configuration/order failures.
- [ ] Apply only the verified SDK configuration/type correction and converter
      group ordering corrections.
- [ ] Update affected mocked SDK expectations and Gemini goldens; inspect their
      structured diff. Update the evergreen doc without experimental-memory
      language or universal cache promises.
- [ ] Run selected relevant offline provider/converter tests once serially; run
      package typechecks and scoped lint/format. Owned protocol/agent TypeScript
      outputs may be built if required for local package resolution; inspect
      scripts first and do not use npm test.
- [ ] Self-review the diff and commit only explicit owned files with intent and
      evidence in the message. Save a concise report with RED/GREEN evidence,
      exact commands/results, commit and limitations. Root supplies two
      independent Sol reviewers and owns integration decisions.
