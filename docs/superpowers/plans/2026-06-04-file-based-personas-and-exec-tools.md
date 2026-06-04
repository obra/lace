# File-based personas + per-persona/plugin tools & skills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all personas file-based (`.md` dirs, `:`-namespaced by source) and wire one-shot-exec **tools** and **skills** into lace from three source tiers — core, plugin-global, and per-persona (`<persona>/tools/`, `<persona>/skills/`).

**Architecture:** Personas stop being in-memory plugin objects; plugins contribute persona/skill/tool *directories*. Logical names are `<namespace>:<entry>` (namespace from the source; flat disk names). Global exec tools land in `registries.tools` at boot via **synchronous** discovery (so it runs inside `register(api)`); per-persona tools/skills are injected only when that persona is active. Skills flow through the existing per-session `SkillRegistry` via one `composeSkillDirs` resolver.

**Tech Stack:** TypeScript (ESM), Node `child_process.spawnSync`, vitest, Zod, the lace plugin system (`registries`, `loadPlugins`), `PersonaRegistry`, `SkillRegistry`, `TemplateEngine`.

**Design of record:** `docs/superpowers/specs/2026-06-04-file-based-personas-and-exec-tools-design.md` (read it; this plan implements it). Reviewed by three opus panels.

**Branch:** `exec-tools-and-file-personas` (already created off `main`).

---

## Conventions for the implementer

- Run all commands from `packages/agent` (the repo root vitest config excludes `packages/**`):
  `cd packages/agent && npx vitest run <path>`.
- Typecheck: `cd packages/agent && npx tsc --noEmit -p .`. Lint: `npx eslint <files> --fix`.
- This is a **shared repo with concurrent writers** — commit with explicit pathspecs (`git commit <files> -m …`), never `git add -A`, never push.
- No backward-compat shims (pre-prod). End commit messages with the Co-Authored-By trailer.
- Exec tests use **real subprocesses** (no mocks), mirroring `src/tools/exec/__tests__/workspace-stats.e2e.test.ts`.

## File structure (what changes)

**Phase 0 — file-based personas + naming + TemplateEngine**
- Modify `src/config/template-engine.ts` — make the embedded-files lookup opt-in per engine.
- Modify `src/config/persona-registry.ts` — `FileDirSource` for user+plugin dirs; delete in-memory `PluginSource`; source-scoped rendering; `:`-namespacing; `personaToolsDir`/`personaSkillsDir`; plugin-dir list.
- Modify `src/plugins/api.ts`, `src/plugins/index.ts` — remove `personas` registry/`PersonaDef`; add `api.personas.addDir` + `api.skills.addDir` (skills dir list used in Phase 5) + the plugin-dir module state.
- Modify `src/config/prompt-manager.ts` — source-scoped render call.
- Update examples/fixtures/tests (full inventory in tasks).

**Phase 1 — sync exec discovery**
- Modify `src/tools/exec/run-once.ts` — export `minimalEnv`; add `runExecToolSchemaSync`.
- Modify `src/tools/exec/discover.ts` — `discoverExecToolsSync`; remove async `discoverExecTools`.
- Modify `src/tools/exec/exec-tool-adapter.ts` — add `nameOverride` ctor param.
- Migrate `src/tools/exec/__tests__/discover.test.ts`, `workspace-stats.e2e.test.ts`.

**Phase 2 — global tier**
- Create `src/tools/exec/register-exec.ts` — `registerCoreExecTools`, `registerExecDirInto`.
- Modify `src/plugins/api.ts` — `api.tools.registerExecDir`.
- Modify `src/main.ts` — `registerCoreExecTools()` in `boot()`.

**Phase 3 — per-persona tools**
- Modify `src/tools/executor.ts` — `injectPersonaTools` (override-guarded).

**Phase 4 — wiring**
- Modify `src/server.ts`, `src/server-types.ts`, the handlers (`tools.ts`, `session.ts`, `session-operations.ts`, `prompt.ts`).

**Phase 5 — skills**
- Create `src/skills/compose-skill-dirs.ts` — `composeSkillDirs`.
- Modify `src/skills/registry.ts` — cross-source shadow `warn`.
- Modify the four producers + plugin skill-dir state.

**Phase 6 — docs.**

---

# Phase 0 — File-based personas + naming + TemplateEngine

> Phase 0 is the hard dependency for Phases 3 and 5. Land it green before proceeding.

### Task 0.1: `TemplateEngine` — make the embedded lookup opt-in

**Why:** `loadTemplate` checks `Bun.embeddedFiles` unconditionally before the FS dirs (`template-engine.ts:62-115`), and `processIncludes` does the same for `@path` includes. For source-scoped persona rendering, only the *bundled* source may use embedded-first; user/plugin sources must resolve against their own FS dir.

**Files:**
- Modify: `src/config/template-engine.ts`
- Test: `src/config/__tests__/template-engine-embedded-optin.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/config/__tests__/template-engine-embedded-optin.test.ts
// ABOUTME: TemplateEngine embedded-lookup is opt-in; FS-only engines never read embedded files.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemplateEngine } from '../template-engine';

describe('TemplateEngine embedded opt-in', () => {
  it('an FS-only engine renders the FS file and its includes from its own dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'te-'));
    mkdirSync(join(dir, 'sections'), { recursive: true });
    writeFileSync(join(dir, 'sections', 'foo.md'), 'SECTION-FS');
    writeFileSync(join(dir, 'p.md'), 'body @sections/foo.md {{x}}');

    const engine = new TemplateEngine([dir]); // default: embedded NOT used
    const out = engine.render('p.md', { x: 'X' });
    expect(out).toContain('SECTION-FS');
    expect(out).toContain('X');
  });

  it('exposes a flag to enable embedded-first (bundled source only)', () => {
    const engine = new TemplateEngine([], { useEmbedded: true });
    expect(engine.usesEmbedded).toBe(true);
    const fsEngine = new TemplateEngine([]);
    expect(fsEngine.usesEmbedded).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd packages/agent && npx vitest run src/config/__tests__/template-engine-embedded-optin.test.ts`
Expected: FAIL (`usesEmbedded` undefined; constructor takes no options).

- [ ] **Step 3: Implement the opt-in**

In `src/config/template-engine.ts`:
- Change the constructor to accept options and store a flag:

```ts
  private readonly templateDirs: string[];
  private readonly useEmbedded: boolean;
  private readonly processedIncludes = new Set<string>();

  constructor(templateDirs: string | string[], opts: { useEmbedded?: boolean } = {}) {
    this.templateDirs = Array.isArray(templateDirs) ? templateDirs : [templateDirs];
    this.useEmbedded = opts.useEmbedded ?? false;
  }

  get usesEmbedded(): boolean {
    return this.useEmbedded;
  }
```

- In `loadTemplate`, guard the embedded block: wrap the existing
  `if (typeof Bun !== 'undefined' && 'embeddedFiles' in Bun && Bun.embeddedFiles)`
  as `if (this.useEmbedded && typeof Bun !== 'undefined' && …)`.
- In `processIncludes`, find the equivalent embedded-files check (the include
  resolution that reads `Bun.embeddedFiles`) and gate it the same way:
  `if (this.useEmbedded && …)`. The FS include resolution (relative to the include
  base dir) is the path that must run for non-embedded engines.

> NOTE: read `processIncludes` to place the guard exactly; there is one embedded
> branch and one FS branch — gate only the embedded branch on `this.useEmbedded`.

- [ ] **Step 4: Run test, verify pass**

Run: `cd packages/agent && npx vitest run src/config/__tests__/template-engine-embedded-optin.test.ts`
Expected: PASS.

- [ ] **Step 5: Guard existing callers** — the bundled-persona render path must pass `{ useEmbedded: true }`. Find every `new TemplateEngine(` (grep) and set `useEmbedded: true` ONLY where bundled/embedded personas are rendered (the prompt-manager default engine — Task 0.7 revisits this). For now, default all existing `new TemplateEngine(dirs)` callers to `{ useEmbedded: true }` to preserve current behavior, so this task is behavior-preserving.

Run: `cd packages/agent && npx vitest run src/config/` — Expected: existing template/persona tests still PASS.

- [ ] **Step 6: Commit**

```bash
git commit src/config/template-engine.ts src/config/__tests__/template-engine-embedded-optin.test.ts \
  -m "feat(template-engine): opt-in embedded-files lookup (useEmbedded flag)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 0.2: Plugin-dir module state + `api.personas.addDir` / `api.skills.addDir`

**Why:** Plugins contribute persona/skill *directories* (not in-memory objects). The dirs accumulate in module-level lists populated during `loadPlugins`, read later by `PersonaRegistry` and `composeSkillDirs`.

**Files:**
- Create: `src/plugins/contributed-dirs.ts`
- Modify: `src/plugins/api.ts`, `src/plugins/index.ts`
- Test: `src/plugins/__tests__/contributed-dirs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/plugins/__tests__/contributed-dirs.test.ts
// ABOUTME: Plugin-contributed persona/skill dirs accumulate by namespace and reset for tests.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addPersonaDir, personaDirs, addSkillDir, skillDirs, resetContributedDirsForTest,
} from '../contributed-dirs';

describe('contributed dirs', () => {
  beforeEach(() => resetContributedDirsForTest());

  it('records persona dirs with their namespace, in order', () => {
    addPersonaDir('acme', '/a/personas');
    addPersonaDir('beta', '/b/personas');
    expect(personaDirs()).toEqual([
      { namespace: 'acme', dir: '/a/personas' },
      { namespace: 'beta', dir: '/b/personas' },
    ]);
  });

  it('records skill dirs and resets', () => {
    addSkillDir('acme', '/a/skills');
    expect(skillDirs()).toEqual([{ namespace: 'acme', dir: '/a/skills' }]);
    resetContributedDirsForTest();
    expect(skillDirs()).toEqual([]);
    expect(personaDirs()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd packages/agent && npx vitest run src/plugins/__tests__/contributed-dirs.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `contributed-dirs.ts`**

```ts
// src/plugins/contributed-dirs.ts
// ABOUTME: Module-level lists of plugin-contributed persona/skill directories,
// ABOUTME: populated during loadPlugins() and read by PersonaRegistry / composeSkillDirs.
export interface ContributedDir {
  namespace: string;
  dir: string;
}

const _personaDirs: ContributedDir[] = [];
const _skillDirs: ContributedDir[] = [];

export function addPersonaDir(namespace: string, dir: string): void {
  _personaDirs.push({ namespace, dir });
}
export function personaDirs(): ReadonlyArray<ContributedDir> {
  return _personaDirs;
}
export function addSkillDir(namespace: string, dir: string): void {
  _skillDirs.push({ namespace, dir });
}
export function skillDirs(): ReadonlyArray<ContributedDir> {
  return _skillDirs;
}
export function resetContributedDirsForTest(): void {
  _personaDirs.length = 0;
  _skillDirs.length = 0;
}
```

- [ ] **Step 4: Run test, verify pass.** `cd packages/agent && npx vitest run src/plugins/__tests__/contributed-dirs.test.ts` — Expected: PASS.

- [ ] **Step 5: Wire into `PluginApi`** (api.ts). Replace the `personas` registrar with a `personas.addDir` view and add `skills.addDir`, both injecting the plugin's `meta.namespace`:

In `src/plugins/api.ts`:
- Remove from `PluginRegistries`/`PluginApi`/`makeRegistries`/`createPluginApi`/`resetRegistriesForTest`: every `personas` line and the `PersonaDef` import/export.
- Add to the `PluginApi` interface:

```ts
  personas: { addDir(dir: string): void };
  skills: { addDir(dir: string): void };
```

- In `createPluginApi`, build them from `meta.namespace` (import from `./contributed-dirs`):

```ts
    personas: { addDir: (dir) => addPersonaDir(meta.namespace, dir) },
    skills: { addDir: (dir) => addSkillDir(meta.namespace, dir) },
```

- In `resetRegistriesForTest()`, add `resetContributedDirsForTest()`.

- [ ] **Step 6: Update `src/plugins/index.ts`** — remove the `PersonaDef` re-export; export `addPersonaDir, personaDirs, addSkillDir, skillDirs, resetContributedDirsForTest, type ContributedDir` from `./contributed-dirs`.

- [ ] **Step 7: Typecheck** — `cd packages/agent && npx tsc --noEmit -p .`. Expect errors in consumers of the removed `personas` registry / `PersonaDef` — those are fixed in Tasks 0.3–0.6 and 0.8. Do NOT fix unrelated files yet; proceed.

- [ ] **Step 8: Commit**

```bash
git commit src/plugins/contributed-dirs.ts src/plugins/__tests__/contributed-dirs.test.ts src/plugins/api.ts src/plugins/index.ts \
  -m "feat(plugins): persona/skill dir contributions; drop in-memory persona registry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 0.3: `PersonaRegistry` — `FileDirSource`, plugin dirs, `:`-namespacing, source-scoped render

**Why:** Personas become file-only. Plugin dirs (namespaced) join the search path between user and bundled. Rendering is source-scoped (the source owns an FS-only `TemplateEngine` rooted at its dir; bundled keeps `useEmbedded:true`).

**Files:**
- Modify: `src/config/persona-registry.ts`
- Test: `src/config/__tests__/persona-registry-filedir.test.ts` (create)

> Read `persona-registry.ts` fully first. You are replacing the `PersonaSource`
> implementations. Preserve: `PersonaInfo`, `ParsedPersona`, `parsePersona` parse
> logic (gray-matter + `personaConfigSchema` + `resolveMcpPaths`), the kata-#55
> user-dir TTL/`anyPathScanned` rescan guard, `PersonaNotFoundError`,
> `listAvailablePersonas`, `hasPersona`.

- [ ] **Step 1: Write the failing test**

```ts
// src/config/__tests__/persona-registry-filedir.test.ts
// ABOUTME: Plugin persona dirs resolve as <ns>:<entry>; precedence user>plugin>bundled;
// ABOUTME: render is source-scoped (a plugin persona's @sections include comes from ITS dir).
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonaRegistry } from '../persona-registry';
import { addPersonaDir, resetContributedDirsForTest } from '@lace/agent/plugins';

function pluginPersonaDir(ns: string, name: string, body: string): string {
  const root = mkdtempSync(join(tmpdir(), `pp-${ns}-`));
  writeFileSync(join(root, `${name}.md`), body);
  return root;
}

describe('PersonaRegistry file-dir sources', () => {
  beforeEach(() => resetContributedDirsForTest());

  it('resolves a plugin persona as <ns>:<entry> with a real path', () => {
    const dir = pluginPersonaDir('acme', 'scout', 'You are Scout. {{system.os}}');
    addPersonaDir('acme', dir);
    const reg = new PersonaRegistry({ bundledPersonasPath: '/nonexistent', userPersonasPaths: [] });
    expect(reg.hasPersona('acme:scout')).toBe(true);
    const parsed = reg.parsePersona('acme:scout');
    expect(parsed.body).toContain('Scout');
    const info = reg.listAvailablePersonas().find((p) => p.name === 'acme:scout');
    expect(info?.path).toBe(join(dir, 'scout.md')); // real path, not a sentinel
  });

  it('renders a plugin persona source-scoped (include from its own dir)', () => {
    const root = mkdtempSync(join(tmpdir(), 'pp-acme-'));
    mkdirSync(join(root, 'sections'), { recursive: true });
    writeFileSync(join(root, 'sections', 'role.md'), 'ROLE-FROM-PLUGIN');
    writeFileSync(join(root, 'docs.md'), 'persona @sections/role.md');
    addPersonaDir('acme', root);
    const reg = new PersonaRegistry({ bundledPersonasPath: '/nonexistent', userPersonasPaths: [] });
    expect(reg.renderPersona('acme:docs', {})).toContain('ROLE-FROM-PLUGIN');
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `cd packages/agent && npx vitest run src/config/__tests__/persona-registry-filedir.test.ts` — Expected: FAIL (`renderPersona` missing; `acme:scout` not found).

- [ ] **Step 3: Implement the source model.** Replace the source classes with:

```ts
interface PersonaSource {
  readonly kind: 'user' | 'plugin' | 'bundled';
  readonly isUserDefined: boolean;
  has(name: string): boolean;          // name is the LOGICAL name (ns:entry for plugin)
  names(): string[];
  parse(name: string): ParsedPersona;
  render(name: string, context: TemplateContext): string;
  displayPath(name: string): string;   // real disk path
  resourceDir(name: string, kind: 'tools' | 'skills'): string | null;
}
```

- `FileDirSource` (used for user and plugin dirs): constructed with
  `{ dir, namespace?: string, isUserDefined, kind }`. `namespace` undefined ⇒ bare
  names (user); set ⇒ logical name `${namespace}:${entry}` mapping to file
  `<dir>/<entry>.md`. It owns an **FS-only** `new TemplateEngine([dir])`
  (`useEmbedded:false`). `render(name)` = `engine.render('<entry>.md', context)`
  (source-scoped → its own `@sections`). `parse` reads `<dir>/<entry>.md` + the
  shared `parseFileContent` helper (extract the existing matter+schema+resolveMcpPaths
  into a module function if not already). `resourceDir(name,kind)` =
  `<dir>/<entry>/<kind>` if it exists else `null`. `displayPath` = `<dir>/<entry>.md`.
- `BundledSource`: keep the existing embedded/bundled loader, but its
  `TemplateEngine` is `new TemplateEngine([bundledPersonasPath], { useEmbedded: true })`.
  `resourceDir` returns `null` (embedded ⇒ no real FS dir) unless the bundled path
  is a real dir on disk; return the real path when it exists, else `null`.
- Delete the in-memory `PluginSource` entirely.

- [ ] **Step 4: Wire sources + plugin dirs in `PersonaRegistry`.**
  - Build `sources` in order: user `FileDirSource`s (from `userPersonasPaths`, no
    namespace) → plugin `FileDirSource`s (from `personaDirs()` in `@lace/agent/plugins`,
    each with its `namespace`) → `BundledSource`. Preserve the kata-#55 rescan guard
    for the USER dirs only (plugin dirs are static — scan once).
  - `parsePersona`/`hasPersona`/`listAvailablePersonas`: iterate sources first-match,
    same as today (precedence by order).
  - Add `renderPersona(name, context)`: first source with `has(name)` →
    `source.render(name, context)`; else throw `PersonaNotFoundError`.
  - Add `personaToolsDir(name)` = first matching source's `resourceDir(name,'tools')`;
    `personaSkillsDir(name)` likewise for `'skills'`.
  - `PersonaInfo.path` = `source.displayPath(name)` (real path; no `plugin:` sentinel).

- [ ] **Step 5: Run test, verify pass.** `cd packages/agent && npx vitest run src/config/__tests__/persona-registry-filedir.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit src/config/persona-registry.ts src/config/__tests__/persona-registry-filedir.test.ts \
  -m "feat(persona-registry): file-dir sources, :-namespacing, source-scoped render

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 0.4: `PromptManager` renders via `renderPersona`

**Files:**
- Modify: `src/config/prompt-manager.ts`
- Test: `src/config/__tests__/persona-rendering-characterization.test.ts` (rewrite — see Task 0.6)

- [ ] **Step 1:** In `prompt-manager.ts:generateSystemPrompt`, replace the current
  `getPersonaPath` + `plugin:` sniff + `render`/`renderString` branch with:

```ts
      this.personaRegistry.validatePersona(persona);
      const context = await this.variableManager.getTemplateContext();
      const prompt = this.personaRegistry.renderPersona(persona, context);
```

  Remove the now-unused `getPersonaPath` call and the `isPluginPersona` branch.
  (The PromptManager no longer owns persona rendering; the registry does, source-scoped.)

- [ ] **Step 2: Run** `cd packages/agent && npx vitest run src/config/prompt-manager.test.ts` — fix any breaks from the signature change (the persona-plugin in-memory cases are rewritten in Task 0.6).

- [ ] **Step 3: Commit** `git commit src/config/prompt-manager.ts -m "refactor(prompt-manager): render personas via PersonaRegistry.renderPersona  \n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 0.5: Convert example plugins to dir contributions

**Files:**
- Modify: `src/plugins/__examples__/reference-plugin.ts`, `persona-plugin.ts`, `incident-responder-plugin.ts`
- Create: persona `.md` dirs under `src/plugins/__examples__/<plugin>-personas/`
- Modify: the `:`-tool-name change in `reference-plugin.ts` (`reference/greet`→`reference:greet`, etc.)

- [ ] **Step 1:** For each example that registered an in-memory persona, create a
  sibling dir with `<entry>.md` and call `api.personas.addDir(<absdir>)` in
  `register`. E.g. `reference-plugin.ts`: create
  `src/plugins/__examples__/reference-personas/scout.md` containing the old
  `scoutPersona.body` (+ frontmatter for its config), and replace
  `api.personas.register('reference/scout', …)` with
  `api.personas.addDir(path.join(__dirname, 'reference-personas'))`. Drop the
  `PersonaDef` import.
- [ ] **Step 2:** Change `/`→`:` in all registered tool/strategy/runtime names in
  these examples (`reference:greet`, `reference:quiet`, `reference:mem`) and the
  packaging comment (`<namespace>:<entry>`).
- [ ] **Step 3: Typecheck** `cd packages/agent && npx tsc --noEmit -p .` — these files clean.
- [ ] **Step 4: Commit** the examples.

---

### Task 0.6: Fix all remaining consumers (fixtures + tests)

**Files (the full inventory — verify each by grep):**
- `src/plugins/__fixtures__/{good-plugin,reach-plugin,dup-persona-plugin,loader-probe}.ts`
- `src/plugins/api.test.ts`, `src/plugins/loader.test.ts`
- `src/config/__tests__/persona-registry-plugins.test.ts`
- `src/config/prompt-manager.test.ts`
- `src/config/__tests__/persona-rendering-characterization.test.ts`
- `src/plugins/__tests__/whole-system.integration.test.ts`

- [ ] **Step 1: Grep to confirm the set:** `grep -rln "registries.personas\|api.personas.register\|PersonaDef\|personas\.register" src` — every hit not already handled is in this task.
- [ ] **Step 2:** Convert each fixture/test that registered an in-memory persona to
  either (a) a fixture persona `.md` dir + `api.personas.addDir`, or (b) drop the
  persona assertion where it only tested the removed registry. For
  `whole-system.integration.test.ts`, its premise **inverts** — it currently
  asserts `parsePersona('reference/scout')` resolves with
  `bundledPersonasPath:'/nonexistent', userPersonasPaths:[]`. Repoint it at a real
  fixture persona dir via `addPersonaDir('reference', <fixtureDir>)` and assert
  `reference:scout`.
- [ ] **Step 3:** Rewrite `persona-rendering-characterization.test.ts` to assert
  source-scoped rendering through `renderPersona` (user + plugin + bundled), not the
  deleted `renderString`/`getPersonaPath` path.
- [ ] **Step 4: Run the whole config + plugins suites**
  `cd packages/agent && npx vitest run src/config/ src/plugins/` — Expected: all PASS.
- [ ] **Step 5: Full typecheck** `cd packages/agent && npx tsc --noEmit -p .` — Expected: clean.
- [ ] **Step 6: Commit** all fixtures/tests.

---

# Phase 1 — Synchronous exec discovery

### Task 1.1: Export `minimalEnv`; add a sync schema probe

**Files:**
- Modify: `src/tools/exec/run-once.ts`
- Test: `src/tools/exec/__tests__/run-once-sync.test.ts` (create)

- [ ] **Step 1: Write the failing test** (real subprocess)

```ts
// src/tools/exec/__tests__/run-once-sync.test.ts
// ABOUTME: runExecToolSchemaSync runs a real <bin> lace-tool-schema synchronously.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExecToolSchemaSync, minimalEnv } from '../run-once';

it('minimalEnv exposes a minimal allowlist', () => {
  expect(Object.keys(minimalEnv())).toEqual(expect.arrayContaining(['PATH', 'HOME']));
});

it('runs lace-tool-schema synchronously and captures stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exec-'));
  const bin = join(dir, 't.mjs');
  writeFileSync(bin, `#!/usr/bin/env node
if (process.argv[2] === 'lace-tool-schema') { process.stdout.write('{"ok":true}'); }`);
  chmodSync(bin, 0o755);
  const res = runExecToolSchemaSync(bin, dir, 5000);
  expect(res.exitCode).toBe(0);
  expect(res.stdout).toContain('"ok":true');
});
```

- [ ] **Step 2: Run it, verify it fails.** `cd packages/agent && npx vitest run src/tools/exec/__tests__/run-once-sync.test.ts` — Expected: FAIL (exports missing).

- [ ] **Step 3: Implement.** In `run-once.ts`: change `function minimalEnv` → `export function minimalEnv`. Add:

```ts
import { spawnSync } from 'node:child_process';

export interface SchemaProbeResult { stdout: string; stderr: string; exitCode: number | null; }

export function runExecToolSchemaSync(bin: string, cwd: string, timeoutMs: number): SchemaProbeResult {
  const r = spawnSync(bin, ['lace-tool-schema'], {
    cwd, env: minimalEnv(), input: '', timeout: timeoutMs, encoding: 'utf-8', killSignal: 'SIGKILL',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.status };
}
```

> Caveat (document in a comment): `spawnSync` timeout kills only the direct child,
> not the process group (unlike the async `runExecToolProcess`). Acceptable for
> trusted one-shot schema probes.

- [ ] **Step 4: Run, verify pass.** Expected: PASS.
- [ ] **Step 5: Commit** `run-once.ts` + the test.

---

### Task 1.2: `discoverExecToolsSync` (+ aggregate budget); remove async `discoverExecTools`

**Files:**
- Modify: `src/tools/exec/discover.ts`, `src/tools/exec/exec-tool-adapter.ts`
- Migrate: `src/tools/exec/__tests__/discover.test.ts`, `workspace-stats.e2e.test.ts`

- [ ] **Step 1: Add a `nameOverride` ctor param to `ExecToolAdapter`** (`exec-tool-adapter.ts`): change the constructor to accept `nameOverride?: string` and set `this.name = nameOverride ?? descriptor.name;` (keep everything else).

- [ ] **Step 2: Write the failing test** for sync discovery:

```ts
// src/tools/exec/__tests__/discover-sync.test.ts
// ABOUTME: discoverExecToolsSync scans a dir, probes each executable synchronously.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverExecToolsSync } from '../discover';

it('discovers a valid exec tool and skips a bad one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'disc-'));
  const good = join(dir, 'good.mjs');
  writeFileSync(good, `#!/usr/bin/env node
if (process.argv[2]==='lace-tool-schema') process.stdout.write('{"name":"good","description":"d","inputSchema":{"type":"object"}}');`);
  chmodSync(good, 0o755);
  const bad = join(dir, 'bad.mjs');
  writeFileSync(bad, `#!/usr/bin/env node
process.exit(3);`);
  chmodSync(bad, 0o755);

  const tools = discoverExecToolsSync(dir);
  expect(tools.map((t) => t.name)).toEqual(['good']);
});
```

- [ ] **Step 3: Run it, verify it fails.** Expected: FAIL (`discoverExecToolsSync` missing).

- [ ] **Step 4: Implement `discoverExecToolsSync`** in `discover.ts` (mirror the async one's skip-bad logic, using `runExecToolSchemaSync`, with an aggregate budget):

```ts
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@lace/agent/utils/logger';
import { parseExecToolDescriptor } from './descriptor';
import { ExecToolAdapter } from './exec-tool-adapter';
import { runExecToolSchemaSync } from './run-once';

const PER_BINARY_MS = 5000;
const TOTAL_BUDGET_MS = 30000;
const MAX_BINARIES = 64;

export function discoverExecToolsSync(dir: string, namePrefix = ''): ExecToolAdapter[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  const out: ExecToolAdapter[] = [];
  const startedAt = Date.now();
  let count = 0;
  for (const entry of entries) {
    if (count >= MAX_BINARIES) { logger.warn('exectool.discover.cap', { dir, cap: MAX_BINARIES }); break; }
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) { logger.warn('exectool.discover.budget', { dir }); break; }
    const bin = join(dir, entry);
    try {
      const st = statSync(bin);
      if (!st.isFile() || (st.mode & 0o111) === 0) continue;
      count++;
      const { stdout, exitCode } = runExecToolSchemaSync(bin, dir, PER_BINARY_MS);
      if (exitCode !== 0) { logger.warn('exectool.schema.nonzero', { bin, exitCode }); continue; }
      const desc = parseExecToolDescriptor(stdout);
      const name = namePrefix ? `${namePrefix}${desc.name}` : desc.name;
      out.push(new ExecToolAdapter(bin, desc, name));
    } catch (err) {
      logger.warn('exectool.discover.skipped', { bin, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
```

  `namePrefix` is `''` for core/per-persona (bare names) and `'<ns>:'` for plugin-global (Phase 2).

- [ ] **Step 5: Remove the async `discoverExecTools`** and migrate its two tests
  (`discover.test.ts` → use `discoverExecToolsSync` without `await`;
  `workspace-stats.e2e.test.ts` → drop the `await`, call sync). Keep the e2e as the
  real-subprocess exemplar.

- [ ] **Step 6: Run** `cd packages/agent && npx vitest run src/tools/exec/` — Expected: all PASS. Typecheck clean.
- [ ] **Step 7: Commit** the exec dir changes + migrated tests.

---

# Phase 2 — Global tier (core + plugin-global)

### Task 2.1: `registerCoreExecTools` + `registerExecDirInto` + `api.tools.registerExecDir`

**Files:**
- Create: `src/tools/exec/register-exec.ts`
- Modify: `src/plugins/api.ts`
- Test: `src/tools/exec/__tests__/register-exec.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/exec/__tests__/register-exec.test.ts
// ABOUTME: registerExecDirInto registers discovered exec tools under a namespace+owner.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerExecDirInto, registerCoreExecTools } from '../register-exec';

function toolDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'xt-'));
  const bin = join(dir, `${name}.mjs`);
  writeFileSync(bin, `#!/usr/bin/env node
if (process.argv[2]==='lace-tool-schema') process.stdout.write('{"name":"${name}","description":"d","inputSchema":{"type":"object"}}');`);
  chmodSync(bin, 0o755);
  return dir;
}

describe('register-exec', () => {
  beforeEach(() => resetRegistriesForTest());

  it('registers a plugin exec dir namespaced ns:entry under the plugin owner', () => {
    registerExecDirInto(toolDir('stats'), { namespace: 'acme', owner: 'acme' });
    expect(registries.tools.has('acme:stats')).toBe(true);
    expect(registries.tools.owner('acme:stats')).toBe('acme');
  });

  it('registerCoreExecTools no-ops when the core dir is absent', () => {
    expect(() => registerCoreExecTools('/nonexistent/agent-exec-tools')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail.** Expected: FAIL (module missing).

- [ ] **Step 3: Implement `register-exec.ts`**

```ts
// src/tools/exec/register-exec.ts
// ABOUTME: Register discovered exec tools into registries.tools (core + plugin-global tiers).
import { existsSync } from 'node:fs';
import { registries } from '@lace/agent/plugins';
import { logger } from '@lace/agent/utils/logger';
import { discoverExecToolsSync } from './discover';

export function registerExecDirInto(dir: string, opts: { namespace?: string; owner: string }): void {
  if (!existsSync(dir)) return; // FS-only; absent → no-op
  const prefix = opts.namespace ? `${opts.namespace}:` : '';
  for (const tool of discoverExecToolsSync(dir, prefix)) {
    registries.tools.register(tool.name, tool, opts.owner);
  }
}

export function registerCoreExecTools(coreDir: string): void {
  if (!existsSync(coreDir)) {
    logger.warn('exectool.core.absent', { coreDir }); // FS-only (embedded/standalone unsupported)
    return;
  }
  registerExecDirInto(coreDir, { owner: 'core-exec' });
}
```

- [ ] **Step 4: Add `api.tools.registerExecDir`** in `api.ts` — extend the tools
  registrar object so a plugin can call it, injecting `meta.namespace`/`meta.name`:

```ts
    tools: {
      register: (name, value) => registries.tools.register(name, value, meta.name),
      registerExecDir: (dir) => registerExecDirInto(dir, { namespace: meta.namespace, owner: meta.name }),
    },
```

  (Update the `PluginRegistrar`/`PluginApi` tool type to include
  `registerExecDir(dir: string): void`. Import `registerExecDirInto` from
  `@lace/agent/tools/exec/register-exec`.)

- [ ] **Step 5: Run, verify pass.** `cd packages/agent && npx vitest run src/tools/exec/__tests__/register-exec.test.ts` — Expected: PASS.
- [ ] **Step 6: Commit.**

---

### Task 2.2: Boot wiring

**Files:**
- Modify: `src/main.ts`
- Test: extend `src/plugins/__tests__/whole-system.integration.test.ts`

- [ ] **Step 1:** In `main.ts boot()`, add `registerCoreExecTools(<coreDir>)` immediately after `registerBuiltinTools()` and before `loadPlugins(...)`. Resolve the core dir as the FS path `packages/agent/config/agent-exec-tools` via the existing resource-path helper for dev, falling back to no-op when absent. (Create an empty `config/agent-exec-tools/.gitkeep` so the dir exists.)
- [ ] **Step 2:** Extend the whole-system integration test: a fixture plugin calls `api.tools.registerExecDir(<dir>)`; after `loadPlugins`, assert `registries.tools.has('<ns>:<tool>')` and a `ToolExecutor` surfaces it.
- [ ] **Step 3: Run** the integration test + `src/main` smoke if present. Commit.

---

# Phase 3 — Per-persona tools

### Task 3.1: `injectPersonaTools` with override guard

**Files:**
- Modify: `src/tools/executor.ts`
- Test: `src/tools/executor.persona-tools.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/executor.persona-tools.test.ts
// ABOUTME: injectPersonaTools adds <persona>/tools/ tools, overrides plugin globals, refuses builtins.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetRegistriesForTest } from '@lace/agent/plugins';
import { ToolExecutor } from './executor';
import { registerBuiltinTools } from './builtins';

function personaToolsDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pt-'));
  const td = join(root, 'tools'); mkdirSync(td, { recursive: true });
  const bin = join(td, `${name}.mjs`);
  writeFileSync(bin, `#!/usr/bin/env node
if (process.argv[2]==='lace-tool-schema') process.stdout.write('{"name":"${name}","description":"d","inputSchema":{"type":"object"}}');`);
  chmodSync(bin, 0o755);
  return td;
}

describe('injectPersonaTools', () => {
  beforeEach(() => { resetRegistriesForTest(); registerBuiltinTools(); });

  it('injects a per-persona tool and refuses to override a builtin', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const td = personaToolsDir('scout-helper');
    ex.injectPersonaTools(td);
    expect(ex.getTool('scout-helper')).toBeDefined();
    // a per-persona tool named 'bash' must NOT replace the builtin:
    const td2 = personaToolsDir('bash');
    ex.injectPersonaTools(td2);
    expect(ex.getTool('bash')?.constructor.name).not.toBe('ExecToolAdapter');
  });
});
```

- [ ] **Step 2: Run, verify fail.** Expected: FAIL (`injectPersonaTools` missing).

- [ ] **Step 3: Implement `injectPersonaTools`** on `ToolExecutor`:

```ts
import { discoverExecToolsSync } from '@lace/agent/tools/exec/discover';
import { LACE_BUILTIN_TOOL_NAMES } from './builtins'; // verify exact export location
// PER_SESSION_BUILTIN_NAMES already imported

  injectPersonaTools(toolsDir: string | null): void {
    if (!toolsDir) return;
    const reserved = new Set<string>([...LACE_BUILTIN_TOOL_NAMES, ...PER_SESSION_BUILTIN_NAMES]);
    for (const tool of discoverExecToolsSync(toolsDir)) {   // bare names (no prefix)
      if (reserved.has(tool.name)) {
        logger.warn('persona-tool.reserved.skipped', { name: tool.name });
        continue;
      }
      this.registerTool(tool.name, tool);  // bare Map.set → overrides a plugin/core global of same name
    }
  }
```

> `registerTool` is a bare `Map.set` (override is automatic). The guard is the only
> new logic. Confirm the exact name/location of `LACE_BUILTIN_TOOL_NAMES`.

- [ ] **Step 4: Run, verify pass.** Commit.

---

# Phase 4 — Wiring the active persona into the executor build

### Task 4.1: Thread persona into `createToolExecutorForMode`

**Files:**
- Modify: `src/server.ts`, `src/server-types.ts`
- Modify handlers: `src/rpc/handlers/tools.ts`, `session.ts`, `session-operations.ts`, `prompt.ts`
- Test: `src/server.persona-executor.test.ts` (create)

> Read each call site. **Source of truth per site:**
> - `composeAndWriteSystemPromptSet` callers (session/new `session.ts`~557, fork `session.ts`~781, `/clear` `slash-commands.ts`~229): pass the **existing `persona` param** through; do NOT read `state.activeSession`.
> - `tools.ts`, `session-operations.ts` (two builds): `state.activeSession.meta.persona ?? 'lace'`.
> - `prompt.ts` cached wrapper: `state.activeSession.meta.persona ?? 'lace'` (closure).
> - `initialize.ts`: none.

- [ ] **Step 1:** Add `activePersona?: string` (or `personaToolsDir?: string`) to
  `createToolExecutorForMode` (`server.ts`) and `CreateToolExecutorFn`
  (`server-types.ts`). Inside `createToolExecutorForMode`, after
  `executor.registerAllAvailableTools(...)` and **before** `toolsForProvider` is
  computed, call `executor.injectPersonaTools(personaRegistry.personaToolsDir(activePersona))`
  when `activePersona` is set. Do NOT change the runner's separate 5-param
  `createToolExecutor` type; the runtime path injects via the `prompt.ts` wrapper.

- [ ] **Step 2: Write a test** asserting `createToolExecutorForMode(..., { activePersona })`
  surfaces the persona's `<persona>/tools/` tool in `toolsForProvider`, and that the
  advertised list equals the executor's tools.

- [ ] **Step 3:** Update each call site to pass the persona per the source-of-truth
  table above. `composeAndWriteSystemPromptSet` gains an executor build that uses its
  `persona` param.

- [ ] **Step 4: Run** the rpc-handler tests + the new test. Typecheck. Commit.

---

# Phase 5 — Skills

### Task 5.1: `composeSkillDirs`

**Files:**
- Create: `src/skills/compose-skill-dirs.ts`
- Test: `src/skills/__tests__/compose-skill-dirs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/skills/__tests__/compose-skill-dirs.test.ts
// ABOUTME: composeSkillDirs orders persona-first, then plugin, then core, then embedder/workDir.
import { describe, it, expect, beforeEach } from 'vitest';
import { resetContributedDirsForTest, addSkillDir } from '@lace/agent/plugins';
import { composeSkillDirs } from '../compose-skill-dirs';

describe('composeSkillDirs', () => {
  beforeEach(() => resetContributedDirsForTest());

  it('persona dir first, then plugin dirs, then embedder/workDir tier', () => {
    addSkillDir('acme', '/plugin/skills');
    const dirs = composeSkillDirs(
      { skillDirs: ['/embedder/skills'] },
      '/persona/skills', // resolved per-persona skills dir
      { coreDir: '/core/skills' },
    );
    expect(dirs).toEqual(['/persona/skills', '/plugin/skills', '/core/skills', '/embedder/skills']);
  });

  it('omits a null persona dir and an absent core dir', () => {
    const dirs = composeSkillDirs({ skillDirs: ['/e'] }, null, {});
    expect(dirs).toEqual(['/e']);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```ts
// src/skills/compose-skill-dirs.ts
// ABOUTME: Compose the per-session skillDirs list (first-wins precedence).
// ABOUTME: persona > plugin > core > embedder/workDir. Plugin/persona/core ALWAYS layer.
import { skillDirs as pluginSkillDirs } from '@lace/agent/plugins';

export function composeSkillDirs(
  source: { skillDirs?: string[]; workDirSkillDirs?: string[] },
  personaSkillsDir: string | null,
  opts: { coreDir?: string },
): string[] {
  const out: string[] = [];
  if (personaSkillsDir) out.push(personaSkillsDir);
  out.push(...pluginSkillDirs().map((d) => d.dir));
  if (opts.coreDir) out.push(opts.coreDir);
  // embedder override replaces ONLY the workDir+user discovery tier:
  out.push(...(source.skillDirs ?? source.workDirSkillDirs ?? []));
  return out;
}
```

> At the call sites, the embedder tier is `state.skillDirs ?? getSkillDirectories(workDir)`
> — pass the resolved array in as `source.skillDirs`. `coreDir` is the FS
> `agent-skills/` path when present, else omitted.

- [ ] **Step 4: Run, verify pass.** Commit.

---

### Task 5.2: Cross-source shadow `warn` in `SkillRegistry`

**Files:** Modify `src/skills/registry.ts`; test `src/skills/registry.shadow.test.ts`.

- [ ] **Step 1: Test** that registering two dirs with a same-named skill keeps the first and emits a `warn` (capture the logger). The skill-name == dir-name rule means the dir name collides; assert first-wins + a warn-level log.
- [ ] **Step 2:** In `loadSkillFromDirectory`, where it currently skips an
  already-registered name at `debug`, change the shadow log to `logger.warn` with
  both `skillDir`s. (Keep first-wins behavior.)
- [ ] **Step 3: Run, commit.**

---

### Task 5.3: Wire `composeSkillDirs` at the three session-side producers

**Files:** Modify `src/rpc/handlers/{session,prompt,tools}.ts`.

- [ ] **Step 1:** At each of the three sites that build `new SkillRegistry({ skillDirs })`,
  replace the `skillDirs` computation with:

```ts
const personaSkillsDir = personaRegistry.personaSkillsDir(<activePersona>);
const skillDirs = composeSkillDirs(
  { skillDirs: state.skillDirs ?? getSkillDirectories(workDir) },
  personaSkillsDir,
  { coreDir: <coreSkillsDirOrUndefined> },
);
```

  `<activePersona>` per the Phase-4 source-of-truth table (the `persona` param at
  `composeAndWriteSystemPromptSet`; `state.activeSession.meta.persona ?? 'lace'` at
  `tools.ts`).

- [ ] **Step 2: Do NOT touch `getSubagentHostSkillDirs`** (`subagent-job.ts`) — it
  keeps shipping the raw `state.skillDirs ?? getSkillDirectories(workDir)`; the child
  re-composes. Add a one-line comment there stating this is intentional.
- [ ] **Step 3: Test** (e2e-ish): a persona with a `<persona>/skills/` skill →
  the per-session `SkillRegistry` (built via the handler path) lists it for that
  persona and not for another; an embedder `state.skillDirs` still layers
  plugin/persona skills on top.
- [ ] **Step 4: Run** the handler/skill tests. Typecheck. Commit.

---

# Phase 6 — Docs

### Task 6.1: Update plugin/persona docs

**Files:** `docs/reference/plugins.md`, `docs/writing-plugins.md`, `docs/external-tools.md`, `docs/building-agents-on-lace.md`, `docs/agent-personas.md`.

- [ ] **Step 1:** `reference/plugins.md` — remove `api.personas.register`/`PersonaDef`/`registries.personas` and the `PersonaDef` section; document `api.personas.addDir` + `api.skills.addDir` + `api.tools.registerExecDir`; change the namespacing rule `<ns>/<entry>` → `<ns>:<entry>`.
- [ ] **Step 2:** `writing-plugins.md` + `external-tools.md` — add skills, the `<persona>/tools|skills/` convention, `:`-namespacing; correct `/`→`:` in tool examples.
- [ ] **Step 3:** `building-agents-on-lace.md` — update genuine plugin tool-name refs to `:`; **leave MCP `<server>/<tool>` slash names** (e.g. `knowledge/grep`).
- [ ] **Step 4:** `agent-personas.md` — add the `api.personas.addDir` + `<persona>/tools|skills/` convention.
- [ ] **Step 5: Commit.**

---

# Final verification (after all phases)

- [ ] `cd packages/agent && npx tsc --noEmit -p .` — clean.
- [ ] `cd packages/agent && npx eslint src --ext .ts` — clean (or `--fix`).
- [ ] `cd packages/agent && npm test` — full suite green (no regressions; was ~3330 tests).
- [ ] Grep: no `registries.personas` / `api.personas.register` / `PersonaDef` / `renderString`-for-personas / `discoverExecTools(`-async remain.
- [ ] Grep: no plugin `<ns>/<entry>` tool names remain (only MCP `<server>/<tool>` slash names).

# Self-review (author checklist — done)

- **Spec coverage:** Part 0 → Tasks 0.1–0.6; Part 1 → 1.1–1.2; Part 2 → 2.1–2.2; Part 3 → 3.1; Part 4 → 4.1; Part 5 → 5.1–5.3; docs → 6.1. The TemplateEngine opt-in (the round-3 render fix) is Task 0.1; per-site persona source-of-truth (round-3 Part 4 fix) is Task 4.1's table; the subagent-stays-raw rule is Task 5.3 Step 2.
- **Type consistency:** `personaToolsDir`/`personaSkillsDir`/`renderPersona`/`resourceDir` (Task 0.3) are used in 3.1/4.1/5.3; `discoverExecToolsSync(dir, namePrefix)` (1.2) is used in 2.1/3.1; `ExecToolAdapter` `nameOverride` (1.2) used by 1.2; `composeSkillDirs` signature (5.1) used in 5.3; `addPersonaDir/personaDirs/addSkillDir/skillDirs/resetContributedDirsForTest` (0.2) used across.
- **Open (settle while implementing):** within-source duplicate exec-tool name → warn-and-skip (discovery already skips dup descriptor names per the bad-binary path; confirm). Built-ins stay bare.

# Execution handoff

(See top banner.) Phases are ordered by dependency: **Phase 0 first** (blocks 3 & 5), then 1 → 2 → 3 → 4 → 5 → 6. Within a phase, tasks are sequential.
