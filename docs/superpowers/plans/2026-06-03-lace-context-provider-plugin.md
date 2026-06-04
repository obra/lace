# Lace Context-Provider Plugin Implementation Plan

Let plugins contribute **variable/context providers** — the objects that feed
data into the system-prompt template — through the existing `LACE_PLUGINS`
system.

Today `PromptManager` hardcodes its set of `VariableProvider`s
(System/Git/Project/Context + optional Tool/Skill) in its constructor
(`config/prompt-manager.ts:43-57`). The `VariableProviderManager.addProvider()`
seam exists but is never fed from the plugin loader. A plugin can already
contribute a **persona** but cannot contribute the **variables** that persona's
template references — an asymmetry worth closing, and cheap because the seam is
already there.

## Design of record

- A 6th `Registry<VariableProvider>` named `contextProviders`, mirroring the
  other five registries (registrar, owner-tracking, reset).
- `PromptManager` drains the registry into its `VariableProviderManager`
  **after** the built-in providers, so a plugin's variables merge last
  (last-write-wins in `Object.assign`, matching today's add-order semantics).
- The `VariableProvider` interface must become **exported** so plugins can type
  against it. It is currently module-private
  (`config/variable-providers.ts:11`).
- No new behavior beyond "plugin providers also run." Built-in providers and
  ordering are unchanged.

## Canonical contract

```ts
// config/variable-providers.ts — promote to an exported interface
export interface VariableProvider {
  getVariables(): Promise<Record<string, unknown>> | Record<string, unknown>;
}
```

The registry value is a `VariableProvider` **instance** (like tools — an object
you invoke), not a factory. Plugins construct their provider and register it.

---

# Part A — The mechanism

## Phase A1 — Export `VariableProvider`; add the `contextProviders` registry

**Files:** `config/variable-providers.ts`, `plugins/api.ts`.

1. In `config/variable-providers.ts`, change `interface VariableProvider` →
   `export interface VariableProvider`. No other change to that file.
2. In `plugins/api.ts`:
   - `import type { VariableProvider } from '@lace/agent/config/variable-providers';`
   - Add `contextProviders: Registry<VariableProvider>;` to `PluginRegistries`.
   - Add `contextProviders: PluginRegistrar<VariableProvider>;` to `PluginApi`.
   - `makeRegistries()`:
     `contextProviders: new Registry<VariableProvider>('contextProviders'),`.
   - `createPluginApi()`:
     `contextProviders: registrar(registries.contextProviders, meta.name),`.
   - `resetRegistriesForTest()`: `registries.contextProviders.clear();`.

**Tests (TDD):**

- `makeRegistries().contextProviders` is a `Registry` of kind
  `'contextProviders'`.
- `createPluginApi(...).contextProviders.register('x', provider)` records owner
  `meta.name`.
- `resetRegistriesForTest()` clears it.

## Phase A2 — Drain the registry into `PromptManager`

**File:** `config/prompt-manager.ts`.

After the existing built-in `addProvider(...)` calls (the block ending at
`prompt-manager.ts:57`, after the optional Skill provider), append:

```ts
import { registries as pluginRegistries } from '@lace/agent/plugins';
// ...
// Plugin-contributed context providers run AFTER built-ins, so plugin variables
// merge last (Object.assign last-write-wins). Identical reach pattern to the
// other registries: populated by loadPlugins() in boot() before any prompt is
// generated, so the registry is full by the time PromptManager is constructed.
for (const name of pluginRegistries.contextProviders.names()) {
  this.variableManager.addProvider(
    pluginRegistries.contextProviders.resolve(name)
  );
}
```

**Why this is safe (state in a comment, mirrors the other registries):**
`PromptManager` is constructed in `config/prompts.ts:65` (`loadPromptConfig`),
which runs per-session — well after `boot()` has called `loadPlugins()`. So the
process-global `registries.contextProviders` is already populated. No new boot
wiring is required (unlike providers/tools/runtimes, context providers have no
built-in registration step — the built-ins stay as direct `addProvider` calls).

**Tests (TDD):**

- With a context provider registered in `registries.contextProviders`, a
  `PromptManager` built afterward includes that provider — assert its variable
  appears in `variableManager.getTemplateContext()` (or in a generated prompt
  that references it).
- Ordering: a plugin provider returning `{ system: {...} }` overrides the
  built-in `SystemVariableProvider` key (last-write-wins), confirming
  plugin-after-builtin order. (If overriding built-ins is undesirable, document
  it — but the merge semantics are pre-existing; do not change them here.)

---

# Part B — Reference plugin + integration coverage

## Phase B1 — Extend the reference plugin with a context provider

**File:** `plugins/__examples__/reference-plugin.ts`.

Add a `// ── 6) Context provider ──` section:

```ts
import type { VariableProvider } from '@lace/agent/config/variable-providers';

const refVars: VariableProvider = {
  getVariables: () => ({ reference: { marker: 'XYZZY' } }),
};
// inside register(api):
api.contextProviders.register('reference/vars', refVars);
```

## Phase B2 — Whole-system integration test

**File:** `plugins/__tests__/whole-system.integration.test.ts`.

Extend the existing whole-system test to assert the context-provider consumption
site:

- `registries.contextProviders.has('reference/vars')` with owner `'reference'`.
- A `PromptManager` constructed after loading the reference plugin produces a
  template context containing `reference.marker === 'XYZZY'` (proving the drain
  in A2 reaches the prompt pipeline end-to-end).

---

# Final verification

- `npm run typecheck && npm run lint && npm test` in `packages/agent` — green.
- Existing prompt-manager / variable-provider tests pass unchanged (built-in set
  and order are untouched).
- `grep` confirms `PromptManager` drains `registries.contextProviders` and that
  `VariableProvider` is exported.

# Self-review / coverage

- [ ] `contextProviders` registry mirrors the other five (registrar, owner,
      reset).
- [ ] `VariableProvider` exported; plugins can type against it.
- [ ] Built-in providers and their order unchanged; plugin providers appended
      after.
- [ ] No new boot wiring needed; comment explains why the registry is already
      full.
- [ ] Reference plugin + integration test cover the seam end-to-end.

# Execution handoff

Use `superpowers:subagent-driven-development`. A1→A2→B1→B2 sequential. All
phases are mechanical given this spec; cheap model suffices except A2 (the
construction-timing reasoning) which warrants a standard model.
