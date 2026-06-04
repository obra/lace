# File-based personas + per-persona/plugin tools & skills — design

_Revised after a 3-opus review panel (2026-06-04). Decisions folded in:
`:`-namespacing (Claude-style), plugin/persona skills always layer over an
embedder override, one combined spec._

## Summary

Wire one-shot-exec **tools and skills** into lace so an embedder, a plugin, or a
persona can actually contribute them — and, as the enabler, make **all personas
file-based** (`.md` files in directories) so per-persona resources follow one
uniform directory convention: `<persona>/tools/` and `<persona>/skills/`. Plugins
can also ship global tools and global skills.

Tools and skills are handled symmetrically. Skills already *are* `SKILL.md`
directories loaded by `SkillRegistry`, so they need no shape change — only new
*sources* (plugin-contributed and per-persona).

## Motivation

- **Exec tools are dead today.** The protocol (`lace-tool-schema` /
  `lace-tool-invoke`), `ExecToolAdapter`, and `discoverExecTools` are built and
  tested, but no boot/session path invokes discovery (zero production callers).
- **Personas are inconsistent.** User/bundled personas are `.md` files; plugin
  personas are in-memory `PersonaDef`s via `api.personas.register`. Skills are
  already file-based (`SKILL.md` dirs). Personas are the odd one out, and the
  in-memory variant has no disk anchor for adjacent per-persona resources.
- **Desired model (Jesse):** tools and skills come from the same sources — a
  global **core** dir, **plugin-global** dirs, and **per-persona** dirs — with
  plugin personas being *only* `.md`-file style; a persona dir carries
  `<persona>/tools/` and `<persona>/skills/`.

## Naming model (`:`-namespaced, Claude-style)

The keystone decision that makes file-based personas/skills work cleanly:

- A contribution **source** has a namespace. **Plugins** use their
  `meta.namespace`; **built-in/core and user** contributions are **bare**
  (un-namespaced), exactly as today (`bash`, `lace`, `coding-agent`).
- A plugin-contributed persona/skill/tool has the logical name
  **`<namespace>:<entry>`** (e.g. `reference:scout`). The `:` is a namespace
  separator, **never a path separator** — so it never nests directories and flat
  dir scans work.
- **On disk, entries are flat** within each source's dir:
  `<dir>/personas/<entry>.md`, `<dir>/skills/<entry>/SKILL.md`, and exec-tool
  binaries declare a flat descriptor `name`. The kernel derives the namespace
  from *which source* the dir/binary came from and joins with `:` — authors don't
  hand-write the namespace into file names. The prefix is the plugin's
  `meta.namespace`; the dup→fatal registry **owner** stays `meta.name` (they may
  differ — `createPluginApi` closes over `meta`, so both are available at the
  `addDir`/`registerExecDir` seam).
- **Per-persona resources** sit beside the persona file by its flat entry name:
  persona `reference:scout` (file `<dir>/personas/scout.md`) → tools in
  `<dir>/personas/scout/tools/`, skills in `<dir>/personas/scout/skills/`.

> **Decided (Jesse):** this **replaces** the existing `/`-namespacing for
> plugin-contributed **tools** too (`reference/greet` → `reference:greet`) for
> consistency with personas/skills ("like Claude"). It touches the merged example
> plugins, their tests, and the dup→fatal docs. Per-persona exec tools keep their
> **bare** descriptor name (so `tools/bash` can override the global `bash` for
> that persona — see Part 3).

## Design of record (decisions)

1. **`:`-namespacing**, namespace = contributing source, flat disk entries (above).
2. **Discovery becomes synchronous** (`discoverExecToolsSync`, `spawnSync` probe)
   so it can run inside a plugin's synchronous `register(api)`. Invocation stays
   async.
3. **Personas become uniformly file-based.** Remove `registries.personas`,
   `api.personas.register`, the `PersonaDef` export, and the in-memory
   `PluginSource`. A plugin contributes a persona **directory** via
   `api.personas.addDir(dir)` (namespace = the plugin).
4. **Per-persona resources** via the `<persona>/tools/` + `<persona>/skills/`
   convention, injected only when that persona is active.
5. **Two-tier tools:** global (core + plugin-global) → `registries.tools` at boot;
   per-persona → injected into the session executor when active.
6. **Persona overrides global** for tools — but **never reserved built-ins**
   (`LACE_BUILTIN_TOOL_NAMES` ∪ `PER_SESSION_BUILTIN_NAMES` are refused on the
   per-persona path; override applies only to plugin/core exec-tool globals).
7. **Skills mirror tools**, gathered into `skillDirs` and fed to the per-session
   `SkillRegistry`. Plugin + per-persona skills **always layer** over an embedder
   `state.skillDirs` override (the override replaces only the workDir tier).
8. **One combined spec** (Jesse) — Part 0 ships with the exec/skill machinery, not
   separately.
9. **No backward compatibility** (pre-prod, we own the box; no compat shims).

## Out of scope (deferred)

- **MCP D2** (passing `ToolContext`/persona to MCP tools) — separate cycle.
- **Capability-manifest enforcement** — spec #6 (credentials).
- **A.1 providers / A.2 context-providers** registries — not merged, not touched.

## Standalone / Bun reality (applies throughout)

`resolveResourcePath` only maps `data`/`agent-personas`/`templates` and **throws**
for unknown names; and embedded files (`Bun.embeddedFiles`) are virtual — they
**cannot be `spawnSync`'d** and have no real dir to scan. Therefore: **core
exec/skill dirs and bundled per-persona `tools/`/`skills/` are filesystem/dev-only.**
Every discovery entry point **no-ops with a warning** when its resolved path is
absent or not a real FS path. Plugin dirs and *user* persona dirs are real disk
paths and work in production; they are the load-bearing sources.

---

## Part 0 — Personas become file-based (the enabler)

**Goal:** every persona is a `.md` file on a search path; remove the in-memory
plugin-persona path.

**Changes:**

- **Plugin API.** Replace the `personas` registrar with
  `api.personas.addDir(absDir)`. A plugin ships a directory of flat `<entry>.md`
  files (each with optional `<entry>/tools/` and `<entry>/skills/` subdirs); the
  plugin's `meta.namespace` namespaces them (`<ns>:<entry>`). Dirs accumulate in a
  module-level list during `loadPlugins` at boot.
- **Registry surface.** Remove `registries.personas` (`Registry<PersonaDef>`), the
  `PersonaDef` type export, and the `personas` entries in `PluginRegistries` /
  `PluginApi` / `makeRegistries` / `resetRegistriesForTest`. (Tools/compaction/
  runtimes registries remain.)
- **PersonaRegistry.** Replace `UserDiskSource`/`PluginSource`/`BundledSource`
  with file-backed dir sources: a shared `FileDirSource` for user dirs and plugin
  dirs (differing only in `isUserDefined`, namespace, and caching), plus the
  bundled source. **Remove the in-memory `PluginSource`** (nothing is in-memory
  anymore). Rendering must be **source-scoped**, which **requires a
  `TemplateEngine` change** — not just rooting an engine at a dir. Today the
  `Bun.embeddedFiles` lookup is *unconditional* and ignores `templateDirs`
  (checked before the FS dirs in **both** `loadTemplate` and `processIncludes`,
  `template-engine.ts`), so neither "engine rooted at the source dir" nor
  "read the body by absolute path" escapes it: a user/plugin persona — or its
  `@sections/…` include — that shares a flat name with a bundled one still
  resolves to the embedded **bundled** file. **Make the embedded lookup opt-in per
  engine**: only the *bundled* source uses embedded-first; user/plugin sources
  resolve `<entry>.md` and its includes against **their own FS dir**. (This also
  fixes a **pre-existing** standalone bug: today a user persona overriding a
  bundled name silently renders the bundled body/sections.) Do not route all
  personas through one shared `engine.render('<entry>.md')`: the `:` key
  disambiguates the *registry*, but the flat filename does not. (Revises v1's
  "collapse to one render path": one uniform *mechanism* is fine, but it must be
  source-scoped with the engine change; the body render survives, only the
  in-memory `PluginSource` is deleted.)
  Search/precedence order: **user dirs → plugin dirs → bundled** (unchanged). Each
  source tracks `name → diskPath` so per-persona resource dirs are derivable
  (`personaToolsDir(name)` / `personaSkillsDir(name)` return `null` for any source
  without a real FS dir, e.g. embedded bundled).
- **Precedence** is enforced by `PersonaRegistry` resolution order
  (user → plugin → bundled) picking the winning source; rendering is then
  source-scoped (above), so precedence does **not** depend on `TemplateEngine`
  first-match-wins. Plugin personas' includes resolve via the source-scoped engine
  rooted at the plugin dir — not by concatenating all plugin dirs into one global
  template path.
- **RPC surface is unaffected** — `ent/personas/list` →
  `PersonaRegistry.listAvailablePersonas()` → `PersonaInfo[]`, which Part 0
  preserves. **One visible behavior change:** `PersonaInfo.path` for plugin
  personas changes from the synthetic `plugin:<name>` to a real disk path. Call it
  out; confirm no consumer parses the old sentinel.

**Full consumer inventory to update (not just the two examples):**

- Examples: `reference-plugin.ts`, `persona-plugin.ts`, `incident-responder-plugin.ts`
  (ship `.md` dirs + `api.personas.addDir`; drop `PersonaDef` import).
- Fixtures: `__fixtures__/{good-plugin,reach-plugin,dup-persona-plugin,loader-probe}.ts`
  (use the dir mechanism / drop `registries.personas`).
- Tests: `plugins/api.test.ts`, `plugins/loader.test.ts`,
  `config/__tests__/persona-registry-plugins.test.ts`, `prompt-manager.test.ts`,
  `config/__tests__/persona-rendering-characterization.test.ts`, and
  **`whole-system.integration.test.ts`** — whose premise *inverts* (it asserts a
  plugin persona resolves with `bundledPersonasPath:'/nonexistent',
  userPersonasPaths:[]`; with no in-memory source it must point at a real fixture
  persona dir).

---

## Part 1 — Synchronous exec discovery

Add `discoverExecToolsSync(dir): ExecToolAdapter[]` — a `spawnSync` sibling of the
existing async `discoverExecTools`:

- Runs `<bin> lace-tool-schema` via `spawnSync` (input `''`, `cwd: dir`, the
  shared minimal env). **Factor `minimalEnv` out of `run-once.ts` and export it**
  so both paths share one env policy.
- Lenient: skip non-executable / non-zero / invalid-descriptor binaries — warn,
  never throw.
- **Aggregate budget:** `spawnSync` blocks the boot/register thread. Cap **total**
  sync-probe wall time per dir (and/or binary count), not just per-binary 5s, so a
  dir of hanging binaries can't stall boot for `N×5s` (the wall-time cap is
  checked *between* binaries — `spawnSync` is fully blocking, so a single binary
  can still burn its full per-binary timeout; a binary-count cap matters too).
  Document the boot-blocking tradeoff.
- **Process-group caveat:** `spawnSync`'s `timeout`/`killSignal` only kills the
  *direct* child, not the process group (unlike the async path's
  `detached`+`process.kill(-pid)`). Acceptable for trusted one-shot schema probes;
  state it explicitly — do not assume the async kill guarantee carries over.

Invocation (`executeValidated` → async `runExecToolProcess`) stays async. Replace
the async `discoverExecTools` (no production callers) and migrate its two tests
(`discover.test.ts`, `workspace-stats.e2e.test.ts`) to the sync API; keep the e2e
as the canonical real-subprocess exemplar.

---

## Part 2 — Global tier (core + plugin-global)

Global exec tools register into `registries.tools` at boot and are drawn into
every session by the existing `registerAllAvailableTools`.

- **Core.** An optional `agent-exec-tools/` dir, **filesystem-only** (see
  Standalone note): `registerCoreExecTools()` no-ops with a warning when the path
  is absent/embedded. When present, sync-discover and register each adapter under
  a distinct owner **`'core-exec'`** (clearer dup→fatal diagnostics than
  `'builtin'`). Idempotent via a registry sentinel (so it survives
  `resetRegistriesForTest` re-registration like `registerBuiltinTools`).
- **Plugin-global.** `api.tools.registerExecDir(dir)` sync-discovers `dir` and
  registers each adapter under the plugin's owner, namespaced `<ns>:<entry>`.
- **Name-seam.** `ExecToolAdapter` currently hard-sets `this.name =
  descriptor.name` with no override (`exec-tool-adapter.ts`). Add a name-override
  seam (ctor param, or rename in the discover/register step) to apply the `<ns>:`
  prefix for global plugin tools — and to keep the **bare** descriptor name for
  per-persona tools (Part 3, for override).

Boot order: `registerBuiltinTools` → `registerCoreExecTools` →
`registerBuiltinCompaction` → `registerBuiltinRuntimes` → `loadPlugins` (plugins
call `registerExecDir` / `addPersonaDir` / `addSkillDir` inside `register`).

Global name collisions follow the registry's **dup→fatal** rule.

---

## Part 3 — Per-persona tools (`<persona>/tools/`)

When a session's executor is built for active persona `P`:

- Resolve `P`'s dir via `personaToolsDir(P)` (`<personaDiskDir>/<entry>/tools/`);
  `null` → inject nothing. Sync-discover it.
- Inject each adapter into **that executor only** (not the global registry) via
  `registerTool` (a bare `Map.set` — last-write-wins, so override needs no new
  code), **after** the global draw and per-session built-ins.
- **Override guard:** refuse any per-persona tool whose name is in
  `LACE_BUILTIN_TOOL_NAMES` ∪ `PER_SESSION_BUILTIN_NAMES` (warn-and-skip). A
  per-persona tool may override a **plugin/core exec-tool** global of the same
  name, but never a platform built-in (`bash`, `delegate`, `use_skill`, …).

Per-persona exec tools use their **bare** descriptor name (enabling the override).
Cached per session (executors are session-keyed; persona is constant per session →
no cross-persona leakage).

---

## Part 4 — Wiring the active persona into the executor build

Per-persona tools must be injected **before** `createToolExecutorForMode`
(`server.ts`) materializes its provider tool list (`getAllTools()`/`toolsForProvider`
are computed *inside* it). So **widen that one function**: add an `activePersona`
(or resolved `personaToolsDir`) param to `createToolExecutorForMode` +
`CreateToolExecutorFn` (`server-types.ts`). **Do not** change the runner's separate
`createToolExecutor` type (`core/conversation/types.ts` — 5-param, no `toolScope`);
the runtime path injects via the cached wrapper in `prompt.ts`, which already
closes over `state`.

**Source of truth is per-site** (a single global `meta.persona` rule is *wrong*
for fork and `/clear`):

- **`composeAndWriteSystemPromptSet`** (`session.ts`) already takes a `persona`
  param and has **three** callers — session/new (`session.ts` ~557), **fork**
  (`session.ts` ~781, where `state.activeSession` is still the *pre-fork* session),
  and **`/clear`** (`slash-commands.ts` ~229, where `state.activeSession` isn't
  switched until *after* the build). **Thread that existing `persona` param into
  the executor build; do NOT re-derive from `state.activeSession`** — deriving from
  state injects the wrong persona's tools at fork and `/clear`.
- **Active-session builds** — `tools.ts` (`ent/tools/list`) and
  `session-operations.ts` (**two** token-estimation builds): use
  `state.activeSession.meta.persona ?? 'lace'`.
- **Runtime** — the `prompt.ts` cached wrapper: `state.activeSession.meta.persona
  ?? 'lace'` from its closure.
- **`initialize.ts`** — no active session → inject nothing.

(`meta.persona` is `undefined` for default sessions; `?? 'lace'` matches the
existing `config.personaName ?? 'lace'` convention.)

**Advertise path must match runtime path** — every site injects, or the model is
told about tools it can't call. The token-estimation builds pass no `skillRegistry`
today; adding persona tools there is for count accuracy and must not change
`use_skill` presence.

Sessions with no persona, or a persona with no `tools/` dir, inject nothing.

---

## Part 5 — Skills (symmetric to tools)

Skills are `SKILL.md` directories loaded by `SkillRegistry({ skillDirs })`
(first-wins dedup, skill-name must equal dir-name), already built **per-session**.
There are **four** `skillDirs` producers (the spec previously missed the
subagent one):

1. `rpc/handlers/session.ts` (system-prompt build)
2. `rpc/handlers/prompt.ts` (runtime)
3. `rpc/handlers/tools.ts` (`ent/tools/list` advertise)
4. **`subagent-job.ts` (`getSubagentHostSkillDirs`)** — computes `skillDirs` and
   ships them to the child via `initialize`; the child stores them as its
   `state.skillDirs`. This is the load-bearing path for per-persona skill reach in
   **delegated** work.

**New sources** (added to `skillDirs`, not a new shape):

- **Core:** optional bundled `agent-skills/` dir (FS-only; no-op when absent).
- **Plugin-global:** `api.skills.addDir(dir)` accumulates plugin skill dirs at
  boot (module-level list, mirroring plugin persona dirs).
- **Per-persona:** the active persona's `<persona>/skills/` dir
  (`personaSkillsDir(P)`), for that session only.

**Wiring — one shared resolver** `composeSkillDirs(state, activePersona)`, used at
the **three session-side** producers (session/prompt/tools — on both the parent
*and* each subagent process); the **subagent producer (#4) deliberately does
not** call it (see below). Returns (first-wins precedence, **highest priority
first**):

```
[ <activePersona's skills dir>,        // per-persona wins (mirrors tools override)
  ...<plugin skill dirs>,
  <core skills dir?>,
  ...(state.skillDirs ?? getSkillDirectories(workDir)) ]   // embedder/workDir tier
```

- **Always layer (decision):** plugin + per-persona + core skills are prepended
  regardless of whether the embedder supplied `state.skillDirs`. The embedder
  override still suppresses the **workDir+user discovery** tier
  (`getSkillDirectories` returns both project- and user-level dirs, via the `??`)
  but no longer suppresses plugin/persona/core skills.
- **Ordering fix:** persona dir is **first** (highest priority under first-wins) —
  the spec's earlier draft had it last, which inverted the intended
  persona-overrides-global guarantee.
- **Subagent path (producer #4):** `getSubagentHostSkillDirs` keeps shipping the
  **raw** `state.skillDirs ?? getSkillDirectories(workDir)` — do **not** wrap it in
  `composeSkillDirs`. The child stores that as its own `state.skillDirs` and
  re-composes (with *its* active persona + the plugin dirs it loads at boot).
  Composing at the parent would double-compose and leak parent plugin dirs as the
  child's embedder tier.

**Cross-source skill collisions:** `SkillRegistry` is silent first-wins (debug
log). The tools tier is loud (dup→fatal). For consistency, **add a `warn`** when a
later dir's skill name shadows an earlier one across sources. (Within-namespace
skills can't be `:`-namespaced because the dir name *is* the skill name; document
that skill names are bare and cross-source shadowing is order-resolved.)

Consumers are unchanged: the per-session `SkillRegistry` still feeds `use_skill`
and `SkillVariableProvider` (the prompt skill list). Note `SkillVariableProvider`
re-scans on every prompt turn, now over more dirs — acceptable (`existsSync` +
`readdirSync` per dir), but acknowledged.

---

## Error handling

- **Discovery:** bad binary → warn-and-skip, never fatal. Missing/empty dirs →
  "no tools/skills". Absent/embedded core+bundled dirs → no-op-with-warning.
- **Global tool name collision:** dup→fatal in `registries.tools`.
- **Per-persona tool vs reserved built-in:** refused (Part 3). Per-persona vs
  plugin/core global of same name: override.
- **Skill cross-source shadow:** `warn`, order-resolved (Part 5).

## Security

Discovery executes binaries — fine under the trusted-code posture (core ships with
lace; plugin dirs are trusted plugin code; bundled dirs are embedder-controlled).
**Document:** a *user* persona's `<persona>/tools/` executes user-provided
binaries from the user's own config — expected on a single-tenant box, called out
so it's not a surprise. Minimal-env + (best-effort) kill isolation applies to every
exec invocation.

## Testing strategy

- **Part 0:** persona resolution from a plugin-contributed dir; `:`-namespacing
  (`ns:entry`); precedence (user > plugin > bundled); unified file-render;
  `PersonaInfo.path` is a real disk path; the full consumer inventory updated and
  green (incl. the inverted whole-system test pointed at a real fixture dir).
- **Part 1:** `discoverExecToolsSync` unit tests (valid / non-zero /
  invalid-descriptor / non-executable / timeout / aggregate-budget).
- **Part 2:** core no-op when absent; `registerExecDir` from a plugin
  (`ns:entry`, owner); global exec tool available in a session.
- **Part 3/4:** e2e — a persona's `<persona>/tools/` tool appears in *its* session
  and not another's; override of a plugin/core global; **reserved built-in name is
  refused**; advertised list (tools/list) matches the runtime executor.
- **Part 5:** plugin skill dir discovered; per-persona `<persona>/skills/` skill
  appears for *its* session (and a **subagent** running that persona) and not
  another's; embedder override still layers plugin/persona skills; persona-skill
  wins (ordering); cross-source shadow warns.
- Exec tests run real subprocesses (no mocks), mirroring `workspace-stats` e2e.

## Docs to update (in the same change)

Document `api.personas.addDir` / `api.skills.addDir` / `api.tools.registerExecDir`,
the `<persona>/tools|skills/` convention, and the `:`-namespacing — including the
removal of `api.personas.register`/`registries.personas`/`PersonaDef` and the
`/`→`:` tool-name change — across:

- `docs/reference/plugins.md` — **stale-by-design**: documents `api.personas`,
  `PersonaDef`, `registries.personas`, the `PersonaDef` reference section, and the
  `<namespace>/<entry>` rule. Major update.
- `docs/writing-plugins.md` and `docs/external-tools.md` — today zero skills
  mentions; add skills + the new contribution APIs + `:`-namespacing.
- `docs/building-agents-on-lace.md` — update genuine *plugin* tool-name
  references; **leave MCP `<server>/<tool>` names as `/`** (MCP keeps slash and is
  out of scope — e.g. `knowledge/grep` is an MCP tool, not a plugin tool).
- `docs/agent-personas.md` — canonical persona doc (nothing stale, but it's where
  `api.personas.addDir` + the `<persona>/tools|skills/` convention belong).

## Open questions

- **Within-source duplicate** tool/skill entry names: warn-and-skip vs fatal
  (leaning warn-and-skip, matching discovery leniency).
- Built-in tools are never re-namespaced (decided — built-ins stay bare).
