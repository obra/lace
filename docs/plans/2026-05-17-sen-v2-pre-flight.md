# Lace work — sen-core v2 pre-flight (clean rebuild)

**Date:** 2026-05-17
**Status:** Plan
**Driver:** `sen-core-v2/docs/specs/2026-05-17-sen-v2.md` — sen v2 is a clean rebuild that runs lace-agent as a child process via Ent. Sen-core needs seven small lace additions before it can build against lace.
**Related guide:** `lace/docs/building-agents-on-lace.md` (in this repo when committed)

## Branch

Work happens on a fresh branch `sen-v2-preflight` off `dev` (currently `ad01889d9`, == `origin/dev`).

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace
git checkout -b sen-v2-preflight dev
```

A prior attempt at this work (in a different lace checkout) accumulated 6 commits on a branch called `agent-session`. **Ignore it entirely.** Three of those commits codified an in-process library API anti-pattern; the other three are re-authored fresh here. There is no rebase, no cherry-pick, no carry-forward.

## Goal

Land 7 commits on `dev`:

| # | Subject | Why |
|---|---|---|
| 1 | fix(agent): createToolExecutorForMode awaits MCP discovery | MCP tools were racy at executor build time; await ensureMCPToolsReady |
| 2 | fix(agent): cache tool executor per session via toolExecutorCache | Avoid rebuilding the executor on every turn (perf + correctness) |
| 3 | feat(agent): AgentToolScope through createToolExecutorForMode + cache | Per-session tool allowlist; needed by persona-config tools field (task 4) |
| 4 | feat(agent): PersonaRegistry parses optional frontmatter | Persona files carry model/tools/mcpServers/workspace/maxTurns config |
| 5 | feat(agent): PersonaRegistry accepts ordered user search paths | Embedder controls where personas live; not hardcoded to LACE_DIR |
| 6 | feat(agent): delegate gains persona? field | Subagent dispatch by registered persona name |
| 7 | feat(agent): Ent session/create + initialize accept persona config | RPC surface for the new persona-bundle model |

Total: ~7 commits, ~600-900 LoC + tests. Roughly half a day of focused work plus reviews.

## Hard rules for the implementer

These exist because the v1 sen-core attempt produced 12 BLOCKER regressions. They apply identically to lace work.

1. **No "documented limitations."** If a task can't complete as specified, STOP, write `docs/plans/STATUS-sen-v2-preflight.md`, exit. Do not stub-with-comment. The phrases "follow-up task" and "documented limitation" are forbidden in shipped code.
2. **No in-process library API.** Do not add `createAgentSession`, `AgentSession`, `state-orchestration.ts`, or any exported helper that lets a consumer bypass the Ent/RPC layer. The library-API path is the anti-pattern. See `docs/building-agents-on-lace.md`.
3. **Strict TDD per substep.** Failing test first, minimal implementation, verify pass.
4. **No `git add -A`.** Always explicit files.
5. **Per-task commits.** After each commit: `cd packages/agent && npm run typecheck` clean AND `npm test` all pass.
6. **No multi-line comment blocks.** One short line max, only where WHY is non-obvious.
7. **Files start with `// ABOUTME:` lines.**
8. **Strict TS. No `any`.** Prefer `unknown` + zod or type guards.
9. **Don't touch any other branch's working tree.** This work happens in `sen-v2-preflight` only.

## Reviewer prompts (use verbatim)

### Spec reviewer

> Verify task N as implemented at commit `<SHA>`. The contract is this plan's task description plus the audit-driven hard rules.
>
> Check:
> - Does the implementation actually do what the task says, end-to-end? Don't accept "the structure is there."
> - For each named code-level deliverable (new function/type/file), read the code and confirm it works as described.
> - Are there ANY new in-process library API surfaces (e.g., classes that expose orchestration internals to consumers)? Fail if yes.
> - Are there throws that say "not implemented" / "follow-up" / "documented limitation"? Fail if yes.
> - Do existing lace tests still pass? Did this task break any of them?
>
> Output: ✅ Approved with each requirement listed, or ❌ Issues (file:line, what's wrong).

### Code quality reviewer

> Read the diff at commit `<SHA>`.
>
> Check:
> - `// ABOUTME:` headers on new files
> - No `any` types
> - Comments only where WHY is non-obvious; one short line max
> - No mocks where real disk / state would work
> - No disabled or skipped tests
> - Tests assert on behavior, not on implementation detail
>
> Output: ✅ Approved, or ❌ Issues (file:line).

## Tasks

### Task 1: `createToolExecutorForMode` awaits MCP discovery

**Goal:** The current `createToolExecutorForMode` is synchronous. After it registers MCP tools, callers see an executor whose MCP tool list may not be fully populated yet (`ensureMCPToolsReady` exists but isn't awaited inline). Convert to async, await the discovery, fix all 4-6 RPC handler callsites.

**Files (rough map; verify):**
- Modify: `packages/agent/src/server.ts` (`createToolExecutorForMode` signature + body)
- Modify: `packages/agent/src/server-types.ts` (`CreateToolExecutorFn` returns `Promise<...>`)
- Modify: All callers of `createToolExecutorForMode` in `packages/agent/src/rpc/handlers/*.ts`
- Modify: `packages/agent/src/core/conversation/runner.ts` (RunnerDependencies.createToolExecutor returns Promise)
- Test: existing executor tests + a new one verifying ensureMCPToolsReady is awaited

**Steps**

- [ ] **1.1: Failing test.** Construct an executor in a way that exposes the race; verify after fix the MCP tool list is fully populated synchronously after `await createToolExecutorForMode(...)`.
- [ ] **1.2: Implement** — make the function async, add `await executor.ensureMCPToolsReady(10000)` after registerMCPTools, update all signatures.
- [ ] **1.3: Update all callsites** (4-6 RPC handlers). Each becomes `await`-prefixed.
- [ ] **1.4: typecheck + npm test clean.**
- [ ] **1.5: Commit.**

```
fix(agent): createToolExecutorForMode awaits MCP discovery

MCP tool registration was sync, leaving a window where the returned
executor's MCP tool list could be incomplete. Convert to async and
await ensureMCPToolsReady(10000) inline.

All 4 RPC handler callsites updated to await. RunnerDependencies.
createToolExecutor signature now returns Promise.
```

### Task 2: Per-session tool executor cache

**Goal:** Each turn currently rebuilds the executor from scratch. Cache it per-session, per-mode, invalidate when MCP config changes.

**Files:**
- Modify: `packages/agent/src/server.ts` (add `getOrCreateSessionToolExecutor`, `invalidateSessionToolExecutor`, route through cache)
- Modify: `packages/agent/src/server-types.ts` (`AgentServerState.toolExecutorCache: Map<string, Promise<{executor, toolsForProvider}>>`)
- Modify: `packages/agent/src/rpc/handlers/mcp-servers.ts` (`reconcileMcpServersForActiveSession` invalidates cache)
- Modify: `packages/agent/src/rpc/handlers/prompt.ts` (route executor build through the cache)
- Test: new tests for cache hit, cache miss, invalidation

**Key constraints:**
- Cache key includes `sessionId` and `executionMode` (e.g., `${sessionId}|${executionMode}`)
- Invalidator matches by `${sessionId}|` prefix (drops all modes for that session)
- Cache holds Promises so concurrent requests get the same in-flight build

**Steps**

- [ ] **2.1: Failing tests.** Build executor twice for same session+mode → cache hit. Build for different session → cache miss. Invalidate → next build is fresh.
- [ ] **2.2: Implement.**
- [ ] **2.3: Wire reconcileMcpServersForActiveSession to invalidate.**
- [ ] **2.4: typecheck + npm test clean.**
- [ ] **2.5: Commit.**

```
fix(agent): cache tool executor per session via toolExecutorCache

Each session's tool executor is now built once and cached. Cache key is
${sessionId}|${executionMode}. Invalidated when MCP servers reconcile.

Previously: executor rebuilt every turn, including re-running MCP tool
discovery. Now: rebuilt only when invalidated.
```

### Task 3: `AgentToolScope` through executor + cache

**Goal:** Add a per-build tool-name allowlist to `createToolExecutorForMode`. Cache key includes scope so different scopes don't collide.

**Files:**
- Modify: `packages/agent/src/server-types.ts` (`export type AgentToolScope = readonly string[] | undefined`)
- Modify: `packages/agent/src/server.ts` (`createToolExecutorForMode` accepts optional 5th arg; filter `allTools` before plan-mode filter; cache key extension)
- Test: new tests for scope filtering + cache keying by scope

**Filter logic:**
```ts
const scoped = toolScope === undefined ? allTools : allTools.filter((t) => toolScope.includes(t.name));
const filteredTools = executionMode === 'plan'
  ? scoped.filter((t) => { const kind = toolKindFromName(t.name); return kind === 'read' || kind === 'search'; })
  : scoped;
```

**Cache key:**
```ts
const scopeKey = toolScope === undefined ? '*' : toolScope.slice().sort().join(',');
const key = `${sessionId}|${executionMode}|${scopeKey}`;
```

Keep `|` separator throughout (don't change to `:` or other — `invalidateSessionToolExecutor`'s prefix match depends on it).

**Steps**

- [ ] **3.1: Failing tests.** `undefined` scope = all tools. Empty array = no tools. Allowlist filters by name. Same session, different scope = different cache entries.
- [ ] **3.2: Implement.**
- [ ] **3.3: typecheck + npm test clean.**
- [ ] **3.4: Commit.**

```
feat(agent): AgentToolScope through createToolExecutorForMode + cache

createToolExecutorForMode accepts an optional AgentToolScope (allowlist
by tool name). Scope is applied before the plan-mode read/search filter.

Cache key includes a sorted scope segment so different scopes on the
same session don't collide. Undefined scope (wildcard) keys as '*'.
```

### Task 4: `PersonaRegistry.parsePersona` — frontmatter + body

**Goal:** Persona files can carry optional YAML frontmatter (`model`, `tools`, `mcpServers`, `workspace`, `maxTurns`). New method returns `{ config, body }`.

**Files:**
- Modify: `packages/agent/src/config/persona-registry.ts`
- Test: `packages/agent/src/config/__tests__/persona-registry.test.ts`

**Frontmatter schema:**
```ts
import { z } from 'zod';

const personaConfigSchema = z.object({
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
    tools: z.record(z.string(), z.any()).optional(),
  })).optional(),
  workspace: z.enum(['local', 'worktree', 'container']).optional(),
  maxTurns: z.number().int().positive().optional(),
}).strict();

export type PersonaConfig = z.infer<typeof personaConfigSchema>;

export interface ParsedPersona {
  readonly config: PersonaConfig;   // {} if no frontmatter
  readonly body: string;            // raw template (TemplateEngine renders later)
}
```

**Method:**
```ts
class PersonaRegistry {
  parsePersona(name: string): ParsedPersona;
}
```

**Steps**

- [ ] **4.1: Failing tests.** No frontmatter → `config = {}`, body = entire file. Valid frontmatter → both parsed. Invalid YAML → clear error. Schema-mismatched frontmatter → clear error. Unknown persona → existing `PersonaNotFoundError`.
- [ ] **4.2: Implement.** Use `gray-matter` (check if it's a dep; add if not) or parse `---...---` manually + js-yaml.
- [ ] **4.3: typecheck + npm test clean.**
- [ ] **4.4: Commit.**

```
feat(agent): PersonaRegistry.parsePersona — frontmatter + body extraction

Persona files can now carry optional YAML frontmatter declaring model,
tools, mcpServers, workspace, and maxTurns. Backward compatible: files
without frontmatter return { config: {}, body: <entire file> }.

Used by session creation (task 7) to populate session config defaults
from the persona's bundled values.
```

### Task 5: `PersonaRegistry` accepts ordered user search paths

**Goal:** Replace the hardcoded `${getLaceDir()}/agent-personas/` with an embedder-controlled ordered list. Earlier paths override later; bundled always last.

**Files:**
- Modify: `packages/agent/src/config/persona-registry.ts`
- Test: existing persona-registry tests

**Signature change:**
```ts
constructor(opts: {
  bundledPersonasPath: string;
  userPersonasPaths: readonly string[];   // ordered: earlier overrides later
})
```

The module-level singleton at the bottom of the file either stays with a default-constructed list `[${getLaceDir()}/agent-personas/]` for non-embedder callers, or is removed in favor of explicit construction. Decision: keep the singleton as a convenience but allow embedders to construct their own.

**Steps**

- [ ] **5.1: Failing tests.** Empty `userPersonasPaths` → only bundled. Single path = old behavior. Multiple paths = first-match wins. Earlier overrides later. Bundled always last.
- [ ] **5.2: Implement.**
- [ ] **5.3: typecheck + npm test clean.**
- [ ] **5.4: Commit.**

```
feat(agent): PersonaRegistry accepts ordered user search paths

The hardcoded ${getLaceDir()}/agent-personas/ is now an embedder-
controlled list. Earlier paths override later; bundled personas search
last. Enables sen-core to use ${SEN_INSTANCE_ROOT}/agent-personas/
independent of LACE_DIR.

Module-level singleton preserved with default-construction for non-
embedder callers; embedders construct their own registry.
```

### Task 6: `delegate` gains `persona?` field

**Goal:** When `delegate({prompt: '...', persona: 'librarian'})`, lace looks up `librarian` via persona registry, reads its frontmatter, uses bundled config as subagent defaults.

**Files:**
- Modify: `packages/agent/src/tools/implementations/delegate.ts`
- Test: existing delegate tests + new test for the persona path

**Schema diff:**
```ts
const delegateSchema = z.object({
  prompt: NonEmptyString,
  description: z.string().optional(),
  background: z.boolean().default(false),
  resume: z.string().optional(),
  progressIntervalMs: z.number().int().min(5000).max(600000).optional(),
  connectionId: z.string().optional(),
  modelId: z.string().optional(),
  persona: z.string().optional(),     // ← new
}).strict();
```

**Behavior:**
- `persona` set:
  - Validate via persona registry; fail tool call with available personas list if unknown
  - `parsePersona(name)` → `{ config, body }`
  - Pass `config.model`/`config.tools`/`config.mcpServers` to the subagent job as defaults
  - Per-call `modelId`/`connectionId` still override
  - The subagent's persona body is the template for its system prompt
  - Store `persona` on the job for resume tracking
- `persona` not set: existing behavior verbatim (all ~1050 lines of existing e2e tests intact)

**Steps**

- [ ] **6.1: Failing tests** for the persona path: dispatch + frontmatter applied, explicit modelId override wins, unknown persona = clear failed result, resume preserves persona binding.
- [ ] **6.2: Existing delegate tests still pass** (the persona-unset path is unchanged).
- [ ] **6.3: Implement.**
- [ ] **6.4: typecheck + npm test clean.**
- [ ] **6.5: Commit.**

```
feat(agent): delegate gains optional persona field

When delegate is called with persona: '<name>', lace looks up via
PersonaRegistry, reads frontmatter (model, tools, mcpServers) as subagent
session defaults, and uses the body as the subagent's persona template.

Per-call connectionId/modelId still override the persona's defaults.
Resume preserves the persona binding. The persona-unset path is
unchanged; existing delegate behavior + tests intact.
```

### Task 7: Ent `session/create` accepts `persona`; `initialize` accepts persona search paths

**Goal:** Embedders configure the persona search path list at startup, and create sessions bound to a named persona.

**Files:**
- Modify: `packages/agent/src/rpc/handlers/initialize.ts`
- Modify: `packages/agent/src/rpc/handlers/session.ts` (`session/create` handler)
- Modify: `packages/ent-protocol/src/...` (schemas if codified there)
- Test: existing initialize/session/create tests + new persona-path tests

**`initialize` request adds field:**
```ts
{
  laceDir: string,
  userPersonasPaths?: string[],   // ← new; defaults to [${laceDir}/agent-personas/]
}
```

At initialize time, the server constructs `PersonaRegistry` with these paths.

**`session/create` request adds field:**
```ts
{
  workDir: string,
  config: {
    connectionId: string,
    modelId: string,
    persona?: string,            // ← new
    mcpServers?: McpServerConfig[],
  },
}
```

When `persona` set, the session-create handler:
1. Validates via persona registry
2. Parses `{ config, body }` (from task 4)
3. `config.model`/`config.tools`/`config.mcpServers` populate session config defaults
4. Body becomes the session's persona template (consumed by existing prompt-manager + template-engine)
5. Request-level config fields still override persona defaults

**Steps**

- [ ] **7.1: Failing tests.** Initialize with custom paths. Session/create with persona that has frontmatter. Session/create with persona-only (template-only) persona. Request-level overrides persona defaults.
- [ ] **7.2: Implement.**
- [ ] **7.3: Update `@lace/ent-protocol` schemas if applicable.**
- [ ] **7.4: typecheck + npm test clean.**
- [ ] **7.5: Commit.**

```
feat(agent): Ent initialize + session/create accept persona config

initialize accepts userPersonasPaths (ordered) for embedder-controlled
persona resolution. session/create accepts a persona field; when set,
the persona's frontmatter populates session config defaults (model,
tools, mcpServers) and the body is the system prompt template.

Request-level fields override persona defaults. Backward compatible:
omitting the fields preserves existing behavior.
```

## Merge plan

After all 7 commits land cleanly on `sen-v2-preflight`:

```bash
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace
# final smoke
cd packages/agent && npm run typecheck && npm test
cd /Users/jesse/Documents/GitHub/prime-radiant-inc/sen2/lace

# publish the feature branch
git push -u origin sen-v2-preflight

# merge to dev (FF — we branched off dev with no other commits since)
git checkout dev
git merge --ff-only sen-v2-preflight

# push dev (Jesse granted push permission)
git push origin dev

# optional cleanup
git branch -d sen-v2-preflight
git push origin :sen-v2-preflight
```

If FF isn't possible (origin/dev advanced concurrently): fetch, rebase `sen-v2-preflight` onto the new origin/dev tip, re-run tests, then FF merge.

## Verification after merge

- `cd packages/agent && npm test` on `dev` is green at the new tip.
- The new tip is pushed to `origin/dev`.
- A smoke from a fake embedder: spawn `lace-agent serve` with custom `userPersonasPaths`, drop a librarian persona file with frontmatter there, call `delegate({persona: 'librarian', prompt: 'echo hi'})` — should work end-to-end.

## Anti-pattern checklist (the reviewer hammers this)

For each commit:
- No `createAgentSession`, `AgentSession`, `state-orchestration.ts`, or other library-API surface
- No `// limitation:`, `// follow-up:`, or `// TODO: implement` comments masking incomplete work
- No new tests that mock orchestration where real deps would work
- No `any` types
- No regression: every existing test still passes
- Comments only where WHY is non-obvious; one short line max; no narrative

## Estimated scope

- Task 1: 1-2 hours
- Task 2: 2-3 hours
- Task 3: 1 hour
- Task 4: 1-2 hours
- Task 5: 30-60 min
- Task 6: 1-2 hours
- Task 7: 1-2 hours
- Merge + smoke: 30 min

Total: roughly 8-12 hours of focused implementer work plus reviewer subagent dispatches.

## Done when

- 7 commits on `dev` (pushed to `origin/dev`)
- `packages/agent` tests all green at the new tip
- The end-to-end embedder smoke (persona-from-frontmatter, delegate-by-persona) returns valid responses
