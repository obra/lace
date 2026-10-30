# Temporary request context implementation plan

> Use superpowers:subagent-driven-development. Jesse approved implementation
> with Sol agents and two independent reviews; this plan records his final,
> simplified contract. Keep this feature separate from memory.

**Goal:** Let an Ent host set, inspect and clear one sticky text value that
moves to the end of every model request without becoming conversation history.

**Architecture:** One in-memory value on the active agent session, three Ent RPC
operations, one runner getter and a request option consumed by the existing
provider adapters. No new subsystem, scheduler or context registry.

**Tech Stack:** Existing TypeScript, Ent/Zod, provider SDKs, Vitest and Node 24.

**Spec:** Jesse's final direction: “no. just set, peek and clear. always
sticky”. This supersedes every proposed lifetime, one-shot and override design.

## Contract and constraints

- Start on `wip/temporary-request-context-20261029` at the independently
  reviewed provider-fix commit `1da4ff191ce6e9ff0e2fcb7f39cce40225ae79e1`,
  itself based on current main `2948e3894af560e4c6fa9cbfa6200397fd1cb018`.
- Public methods are `ent/session/temporary_context/set`, `.../peek` and
  `.../clear`. Set takes `{ text: string }` with nonempty text and replaces the
  only value. Peek returns `{ text: string | null }` without consuming it. Set
  and clear return `{}`. Validate parameters at the RPC boundary. There is no
  lifetime, expiry, one-shot override, stack or automatic restoration.
- Context is always sticky across turns and tool rounds, until set or clear. It
  belongs to the currently active session in this process. Successful new,
  load/resume activation and close clear it; it is not saved, restored, forked
  or delegated. Ordinary same-session refresh and compaction do not clear it.
- Each model request reads the current value and places it after all required
  conversation history, including tool results and images. Updates affect the
  next request, never a payload already in flight or its transport retry.
- Canonical messages, persisted events and compaction input contain no injected
  context text. The model's answers may naturally refer to it; this API does not
  erase information from those answers or promise no logging.
- On Anthropic direct and Bedrock, build explicit cache breakpoints from
  required history first, then append context as its own unmarked text block.
  Changing its size or content must not change any marked prefix bytes.
- Other providers get the same trailing context ordering. This is not a promise
  that provider-managed automatic caching is disabled. No new KV configuration.
- OpenAI Responses must not retain replaced/cleared context through response
  chaining. Use full history and `store: false` for requests with temporary
  context, including the remaining requests of a turn after context is cleared.
  Preserve ordinary chaining when no temporary context has been used. Preserve
  Anthropic's unrelated previous-message diagnostics and model-call correlation.
- Account for context in existing request sizing/fallback usage. Do not silently
  truncate or drop explicit caller text or add a new budget/compaction manager.
- No memory imports, extraction/ranking, memory consumer migration, UI/CLI
  command, backward-compatibility layer, provider retry redesign or dependency.
- Offline only: no keys, live inference, network, containers, Apple VM work or
  dependency installation/rebuild. Never use the full npm test command, which
  invokes container integrations. Inspect selected tests before running them.
- Use Node 24 and the provided network guard. Check uptime, use one heavy
  process and one test worker, save and read logs. Normal hooks must run; no
  push/merge.

## Review focus

The public API must be just one replaceable sticky value. Trace the real Ent
handlers through multi-round requests, required tool history and provider SDK
serialization. Test meaningful reachable behavior, not imagined races or large
string snapshots. Check that no-context paths retain their existing behavior,
context never leaks into persisted input, explicit prefixes remain unchanged,
and Responses cannot bring old context back after replacement or clearing.

### Task 1: Implement and verify the standalone API

**Files:** Ent method schemas; agent server state and session handlers; runner
dependencies/request construction; RequestOptions and existing Anthropic,
Bedrock, OpenAI, Gemini, Ollama and LMStudio adapters; focused tests; evergreen
`docs/architecture/temporary-request-context.md`, host/protocol docs and cache
documentation. Follow existing code style and share small materialization logic
where it actually removes duplication.

- [x] Inspect real API, activation and provider paths before editing. The host
      surface is Ent RPC, not an invented embedded Agent or Session class.
- [x] Add focused behavioral regressions and record expected failures: set /
      replace / peek / clear; persistence across turns and model/tool rounds;
      session activation/close reset; history/event isolation; required results
      before context; real SDK wire order; Anthropic cache markers before
      context; Responses replacement/clear with no retained chain; local
      provider adapters.
- [x] Implement the smallest vertical change. A getter supplies current text per
      model request. For example, an optional request field can distinguish
      ordinary requests from temporary-context mode with no current text, so
      clearing in the middle of a Responses turn stays stateless. Keep any such
      transport detail internal; no additional public control or lifecycle
      state.
- [x] Verify request sizing and fallback usage include context. Use existing
      deterministic compaction tests where relevant; no broader redesign.
- [x] Write evergreen documentation with three short RPC examples and a small
      request-layout diagram. Explain process/session lifetime, update timing,
      non-persistence and precise explicit-versus-automatic cache behavior.
- [x] Run inspected relevant offline tests serially with output saved; inspect
      failures before any rerun. Run all package typechecks, scoped lint and
      formatting. Build only owned TypeScript outputs when required for types.
- [ ] Self-review and commit explicit owned files with normal hooks and detailed
      intent/evidence. Report exact commands, RED/GREEN evidence, commit and
      limitations. Root owns two independent Sol reviews and required Sen doc
      checks. Do not create further agents or expand scope.
