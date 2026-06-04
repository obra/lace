# File-based personas + per-persona/plugin tools & skills — design

## Summary

Wire one-shot-exec **tools and skills** into lace so an embedder, a plugin, or a
persona can actually contribute them — and, as the enabler, make **all personas
file-based** (`.md` files in directories) so per-persona resources follow one
uniform directory convention: `<persona>/tools/` and `<persona>/skills/`. Plugins
can also ship global tools and global skills.

Tools and skills are handled symmetrically. Skills already *are* `SKILL.md`
directories loaded by `SkillRegistry`, so they need no shape change — only new
*sources* (plugin-contributed and per-persona).

Today `discoverExecTools(dir)` exists but nothing calls it (exec tools are
unreachable), and plugin personas are in-memory `PersonaDef` objects with no disk
location — which is exactly why per-persona exec tools had no natural home. This
design fixes both, together, because the per-persona exec-tool convention depends
on personas living on disk.

## Motivation

- **Exec tools are dead today.** The protocol (`lace-tool-schema` /
  `lace-tool-invoke`), the `ExecToolAdapter`, and `discoverExecTools` are built
  and tested, but no boot or session path invokes discovery.
- **Personas are inconsistent.** User and bundled personas are `.md` files; plugin
  personas are in-memory `PersonaDef`s registered via `api.personas.register`.
  Skills, by contrast, are already file-based (`SKILL.md` directories). Personas
  are the odd one out, and the in-memory variant has no disk anchor for adjacent
  per-persona tools.
- **Desired model (Jesse):** tools **and skills** come from the same set of
  sources — a global **core** dir, **plugin-global** dirs, and **per-persona**
  dirs — with plugin personas being *only* `.md`-file style. A persona directory
  carries both a `<persona>/tools/` and a `<persona>/skills/` dir; plugins can ship
  global tools and global skills.

## Design of record (decisions)

1. **Discovery becomes synchronous** (`discoverExecToolsSync`, `spawnSync` probe),
   so it can run inside a plugin's synchronous `register(api)`. Tool *invocation*
   stays async.
2. **Personas become uniformly file-based.** The in-memory persona registry and
   `api.personas.register(name, def)` are removed; a plugin contributes a persona
   **directory** (search path) instead. All personas (user, plugin, bundled) are
   `.md` files.
3. **Per-persona exec tools use a directory convention:** persona `<name>.md` has
   its exec tools in a sibling `<name>/tools/` directory (e.g. `explorer.md` +
   `explorer/tools/<tool>`). Uniform across all persona sources.
4. **Two-tier delivery:** global exec tools (core + plugin-global) register into
   `registries.tools` at boot (available everywhere); per-persona exec tools are
   injected into a session's executor only when that persona is active.
5. **Persona overrides global:** a per-persona exec tool whose name matches a
   global tool shadows the global one for that persona's sessions.
6. **Skills mirror tools.** Plugins ship global skills (`api.skills.addDir`);
   personas carry per-persona skills in `<persona>/skills/` beside
   `<persona>/tools/`. Skills are already `SKILL.md` dirs consumed by a per-session
   `SkillRegistry` — only the *sources* are new.
7. **No backward compatibility.** This changes the just-merged plugin system
   (removes the in-memory persona registry). Acceptable under the pre-prod,
   we-own-the-box posture; no compat shims.

## Out of scope (explicitly deferred)

- **MCP D2** (passing `ToolContext`/persona to MCP tools) — independent; a
  separate cycle.
- **Capability-manifest enforcement** — that is spec #6 (credentials).
- **A.1 providers / A.2 context-providers** registries — specced, not merged, not
  touched here.

---

## Part 0 — Personas become file-based (the enabler)

**Goal:** every persona is a `.md` file found on a search path. Remove the
in-memory plugin-persona path.

**Changes:**

- **Plugin API.** Replace the `personas` *registrar* (`register(name, def)`) with
  a persona-**directory** contribution, e.g. `api.personas.addDir(absDir)`. A
  plugin ships a directory of `<name>.md` files (each with optional
  `<name>/tools/` and `<name>/skills/` subdirs) and registers that directory at
  `register(api)` time.
- **Registry surface.** Remove `registries.personas` (`Registry<PersonaDef>`),
  the `PersonaDef` export, and the `personas` entries in `PluginRegistries` /
  `PluginApi` / `makeRegistries` / `resetRegistriesForTest`. The four-registry
  set becomes three (`tools`, `compaction`, `runtimes`) plus the persona-dir
  contribution mechanism. Plugin persona dirs accumulate in a module-level list
  (populated during `loadPlugins` at boot), read by `PersonaRegistry`.
- **PersonaRegistry.** Drop the in-memory `PluginSource`. Persona search order
  becomes: user dirs → **plugin dirs** → bundled dir (preserving today's
  user > plugin > bundled precedence). All sources are file-based, so the
  `renderString`-vs-`render` bifurcation introduced in the B.1 refactor
  **collapses to a single file-render path** — a net deletion. Plugin dirs must
  also be added to `getTemplateDirsWithOverlay()` so `engine.render('<name>.md')`
  resolves plugin personas.
- **Examples + tests.** Update `reference-plugin.ts` and `persona-plugin.ts` (and
  the whole-system / persona-plugin tests) to ship a persona `.md` dir and call
  `api.personas.addDir(...)` instead of registering an in-memory persona.

**Data flow:** boot → `loadPlugins` → each plugin's `register(api)` calls
`api.personas.addDir(dir)` → dirs appended to the plugin-persona-dir list →
`PersonaRegistry` (and the prompt template dirs) include them in the search path →
personas resolve from files uniformly.

**Why this is safe / simpler:** it makes personas consistent with skills, removes
a whole rendering branch, and gives per-persona exec tools a disk anchor. The only
loss is the in-memory convenience of `api.personas.register`, which nothing
outside the examples relied on.

---

## Part 1 — Synchronous exec discovery

Add `discoverExecToolsSync(dir): ExecToolAdapter[]` — a `spawnSync` sibling of
`discoverExecTools`:

- Runs `<bin> lace-tool-schema` with `spawnSync` (input `''`, `cwd: dir`,
  `timeout: 5000`, the existing minimal env), parses the descriptor, constructs an
  `ExecToolAdapter`.
- Same lenient behavior: skip non-executable files and binaries that exit non-zero
  or print an invalid descriptor — **warn, never throw**.

The existing async `discoverExecTools` is unused (never wired); replace it with the
sync version (one discovery path) and migrate its tests. **Invocation
(`executeValidated` → `runExecToolProcess`) stays async** — only discovery goes
sync (it must run inside synchronous `register(api)` / boot).

---

## Part 2 — Global tier (core + plugin-global)

Global exec tools register into `registries.tools` at boot and are therefore drawn
into every session by the existing `registerAllAvailableTools`.

- **Core.** A bundled `agent-exec-tools/` directory (resolved like bundled
  personas via `resolveResourcePath`). A `registerCoreExecTools()` boot step
  (sibling to `registerBuiltinTools`, idempotent) sync-discovers it and registers
  each adapter under owner `'builtin'`. The directory may start empty — this lands
  the mechanism; tools are added later.
- **Plugin-global.** A registrar convenience `api.tools.registerExecDir(dir)` that
  sync-discovers `dir` and registers each adapter under the plugin's owner. (A
  convenience so a plugin doesn't import the discovery helper itself.)

Boot order: `registerBuiltinTools` → `registerCoreExecTools` →
`registerBuiltinCompaction` → `registerBuiltinRuntimes` → `loadPlugins` (plugins
call `registerExecDir` / `addPersonaDir` inside `register`).

Collisions among global exec tools follow the registry's existing **dup→fatal**
rule (namespaced names). 

---

## Part 3 — Per-persona tier (the `<persona>/tools/` convention)

When a session's executor is built for active persona `P`:

- Find `P`'s containing search dir (the dir whose `P.md` matched) and
  sync-discover `<thatDir>/P/tools/`. `PersonaRegistry` exposes this, e.g.
  `personaToolsDir(name): string | null`.
- Inject each discovered adapter into **that executor only** (not the global
  registry), via `registerTool`. Cached per session (executors are already cached
  per session).
- **Override:** if an injected per-persona tool's name matches a tool already on
  the executor (a global tool), it **replaces** it for this persona's session
  (persona-overrides-global). `registerTool` allows the overwrite on the
  per-persona injection path.

This is uniform for disk and plugin personas because, after Part 0, both are
`.md` files in search dirs with optional `<persona>/tools/` siblings.

---

## Part 4 — Wiring the active persona into the executor build

`registerAllAvailableTools` currently doesn't know the active persona. Thread the
active persona name (from `SessionMeta` / `RunnerConfig.persona`) through
`createToolExecutorForMode` → `registerAllAvailableTools`, then after the global
tools + per-session built-ins (`delegate`, `use_skill`), perform the Part 3
per-persona injection. Sessions with no persona, or a persona with no `tools/`
dir, inject nothing. (Skills are threaded symmetrically — see Part 5.)

---

## Part 5 — Skills (symmetric to tools)

Skills are already `SKILL.md` directories loaded by `SkillRegistry`
(`{ skillDirs: string[] }`, first-wins), which is **already built per-session** at
three handler sites (`session.ts`, `prompt.ts`, `tools.ts`) from
`state.skillDirs ?? getSkillDirectories(workDir)`. So skills need new *sources*,
not a new shape — gathered into the `skillDirs` list:

- **Core.** An optional bundled `agent-skills/` dir (mechanism; may start empty).
- **Plugin-global.** `api.skills.addDir(dir)` accumulates plugin skill dirs at boot
  (a module-level list, mirroring plugin persona dirs).
- **Per-persona.** The active persona's `<persona>/skills/` dir (beside its
  `<persona>/tools/`), added to `skillDirs` for that session only.

**Wiring.** Replace the three ad-hoc `skillDirs` computations with one shared
resolver, e.g. `composeSkillDirs(state, activePersona)`, returning
`[...embedder/workDir dirs, ...plugin skill dirs, ...(active persona's skills dir)]`
(plus the optional core dir). Each site builds `new SkillRegistry({ skillDirs })`
from it.

Per-persona skills reach the model the same way they do today — through the
per-session `SkillRegistry`, which feeds both the `use_skill` tool and the
`SkillVariableProvider` (the system-prompt skill list). No new consumption path.

Collisions: `SkillRegistry` already skips a duplicate skill name (first dir wins,
logs at debug); dir ordering controls whether per-persona skills take precedence
(settle ordering in the plan).

---

## Error handling

- **Discovery:** a bad binary (non-exec, non-zero schema exit, invalid descriptor,
  timeout) is skipped with a `logger.warn`, never fatal — one bad tool can't break
  boot or a session.
- **Global name collision:** dup→fatal in `registries.tools` (same as builtins /
  plugins).
- **Per-persona name collision with a global tool:** override (Part 3). Collision
  between two tools *within* one persona's `tools/` dir: dup → warn-and-skip the
  second (consistent with discovery leniency) — or fatal; resolve during planning.
- **Missing/empty dirs:** treated as "no tools" (empty result), never an error.

## Security

Discovery executes binaries, which is fine under the trusted-code posture: the
core dir ships with lace, plugin dirs are trusted plugin code, and bundled persona
dirs are embedder-controlled. **Document one note:** a *user* persona's
`<persona>/tools/` dir executes user-provided binaries from the user's own
config — expected on a single-tenant box, but called out so it's not a surprise.
The existing minimal-env + process-group-kill isolation applies to every exec
invocation.

## Testing strategy

- **Part 0:** persona resolution from a plugin-contributed dir; precedence
  (user > plugin > bundled); rendering a plugin persona through the unified
  file-render path; examples/tests updated and green.
- **Part 1:** `discoverExecToolsSync` unit tests with fixture binaries (valid,
  non-zero, invalid-descriptor, non-executable, timeout).
- **Part 2:** core-dir registration into `registries.tools`; `registerExecDir`
  from a plugin; global exec tool available in a session.
- **Part 3/4:** e2e — a persona with a `<persona>/tools/` dir gets its tool in
  *its* session and **not** in another persona's session; override (a per-persona
  tool shadows a same-named global tool for that persona only).
- **Part 5 (skills):** a plugin-contributed skill dir is discovered; a persona's
  `<persona>/skills/` skill appears for *its* session (via `use_skill` /
  `SkillVariableProvider`) and not another persona's; `composeSkillDirs` ordering.
- All exec tests run real subprocesses (no mocks), mirroring the existing
  `workspace-stats` exec e2e.

## Open questions

- Exact name of the persona-dir contribution method (`api.personas.addDir` vs
  `api.addPersonaDir`) — cosmetic; settle in the plan.
- Within-persona duplicate tool names: warn-and-skip vs fatal — settle in the
  plan (leaning warn-and-skip, matching discovery leniency).
