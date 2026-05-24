# Agent Collaboration Notes

Notes for AI agents (Claude, future tooling) working on this codebase. These are habits and patterns that recur across sessions — recording them here so each fresh session doesn't have to re-learn them.

## Working style

### Anti-overbuild radar

Don't add defensive code, type complexity for hypothetical edge cases, or prose that wasn't requested. Specific patterns called out and reverted on this codebase:

- A whole RPC endpoint (`ent/session/system_prompt`) added across 4 packages to work around a "security" filter on `ent/session/events`. The system prompt never contains secrets — the filter was theater; both got reverted.
- A `_systemPrompt: string | null` type change to distinguish "never set" from "explicitly empty" when no caller passes empty.
- Defensive empty-input guards in `countTokensExplicit` that only protected a calibration path which was itself dead code.
- An architecture documentation file generated from reviewer suggestions when Jesse didn't ask for prose; deleted.
- A legacy session migration in the message-builder. Per pre-release policy, just discard old sessions instead.

When a fix grows beyond a one- or two-line change, stop and consider whether the larger change is solving a real problem (with concrete evidence) or a hypothetical one. After a review round, do an explicit "what did I overbuild" audit even if not asked. Prefer deleting broken/dormant APIs over maintaining them.

### Adversarial reviews are part of the workflow

For substantial work (architectural changes, multi-phase plans), expect **two parallel adversarial reviewers** with gamification: "whoever finds the largest number of legitimate significant issues gets 5 points." Bias the reviewers toward Opus-class capability and explicit 20+ minute investigation floors.

The PRI-1799 cache-control work went through **three** such rounds. Each round found ~10-15 issues; most were real, some were design choices to skip per policy.

The pattern:
- Reviewer A and Reviewer B in parallel via the Agent tool, identical prompts
- Each returns numbered findings with Severity / Location / Description / Why-real / Suggested-fix
- The controller deduplicates, awards points to whichever found more legitimate issues, and produces a consolidated list
- Then write a fix plan via `superpowers:writing-plans` and execute via `superpowers:subagent-driven-development`

Expect iteration: the plan itself may need revision mid-round (e.g., "merge adjacent role:user" was rejected as overbuild initially, then reinstated as `appendOrMergeUser` when concrete evidence accumulated).

### No back-compat in pre-release v1

CLAUDE.md is strict: "We NEVER leave backward-compatibility or legacy code in place." Examples from PRI-1799 of this in action:

- A two-pass legacy migration in `buildProviderMessagesFromDurableEvents` was implemented per reviewer suggestion, then **deleted** as overbuild — legacy sessions can just be discarded.
- `Session.create()` library API that was broken under the new invariant was **deleted** rather than fixed, along with `Agent.createSession/loadSession/listSessions` wrappers.
- The runner THROWS on a missing `system_prompt_set` event instead of falling back silently. External reviewers may flag this as a regression; leave it alone per policy.

When tempted to write a legacy migration or back-compat shim: delete the broken code path, document the breakage, let users start fresh sessions.

## Cache-control architecture (PRI-1799)

The cache-control hardening landed on 2026-05-23 across 52 commits. Key architectural invariants now enforced:

- **System prompt is frozen per session.** A `system_prompt_set` durable event (declared in `packages/agent/src/storage/event-types.ts`) holds the rendered text. It's written once at session creation via the shared `composeAndWriteSystemPromptSet` helper in `packages/agent/src/rpc/handlers/session.ts`. Used by `session/new`, `session/fork` cwd-refresh, and `/clear`.
- **Runner throws on missing system_prompt_set.** No silent fallback. The empty-check runs BEFORE `createProvider()` so no provider leak. Lives at `packages/agent/src/core/conversation/runner.ts`.
- **`appendOrMergeUser` helper** at `packages/agent/src/message-building/append-or-merge.ts` prevents consecutive `role:'user'` messages on the wire. Used in 3 sites: runner loop reminder, `readImmediateInjectsSince` re-read, and message-builder `context_injected` emission. Returns a new array; merges into the last entry's content when last is also `role:'user'`.
- **`SUMMARIZER_SYSTEM_PROMPT`** constant at `packages/agent/src/compaction/summarize-strategy.ts` — set on the throwaway compaction provider by both `/compact` and `ent/session/compact` to silence warn-fallback. Distinct from session persona (summarizer isn't supposed to inhabit the agent persona).
- **`/compact` and `ent/session/compact` write byte-identical `context_compacted` events.** Only `preserved` carries the summary (as `result.messages[0]`). The previously-written `data.summary` field was duplicating into rebuild and was dropped.
- **`personaName` always persisted** in session config (no conditional) — fork can faithfully replay.
- **Bedrock TTL gated by regex** matching `claude-(opus|sonnet|haiku)-4-5` with delimiter anchor. The Bedrock provider does NOT send the `extended-cache-ttl-2025-04-11` beta header today (whether that's required is an open question flagged in adversarial review but not addressed).

When working on session/runtime/provider code, the system prompt is invariant — don't try to mutate it mid-session. Use the `composeAndWriteSystemPromptSet` helper for any new session-creation path. Use `appendOrMergeUser` (or in-place merge) for any new code that pushes `role:'user'` into a message array.

## Lace project basics

- **npm workspaces** with two packages: `packages/agent` (core engine, providers, RPC handlers) and `packages/web` (React Router v7 UI). Also `packages/ent-protocol` and `packages/supervisor` for the wire protocol and process supervision.
- **Event-sourced**: conversations are immutable durable events in `events.jsonl`. The message-builder reconstructs `ProviderMessage[]` for the LLM. The runner writes new events as the agent runs.
- **Multi-provider**: Anthropic (direct + Bedrock), OpenAI (Chat Completions + Responses API), Gemini, LMStudio, Ollama, OpenRouter. All implement `AIProvider` (in `packages/agent/src/providers/base-provider.ts`).
- **Linear**: tickets in `PRI-` namespace.
- **Tests via Vitest** from `packages/agent`. Run `npx vitest --run <path>` for single file. Pre-commit hooks via lint-staged.

### Common gotchas

- Subagents sometimes get confused by `cd packages/agent` — the worktree root has its own pwd state. Use absolute paths or `cd` from a known root in each Bash call.
- `git add -A` can sweep in untracked scratch files from earlier subagents. Prefer specific file paths.
- Lint-staged formatter sometimes makes additional changes that get bundled into your commit — review `git status` carefully before `git commit --amend`.
- Pre-existing test failures: `session-fork.durable-history.test.ts > defaults direct MCP override placement when forking a session` has been failing for a while; unrelated to most cache-control work.
