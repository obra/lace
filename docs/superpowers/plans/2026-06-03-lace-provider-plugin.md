# Lace Provider Plugin Implementation Plan

Make **model providers** (and their dynamic catalogs) pluggable through the
existing `LACE_PLUGINS` system, the same way tools/compaction/runtimes/personas
already are. Today `createProvider()` is a hardcoded 6-arm `switch` and
`getCatalogForInstance()` is a hardcoded 3-arm `if`-chain — an embedder cannot
add a provider without forking the kernel.

This is the **wide** reading: a plugin can contribute both how a provider is
instantiated (`create`) and how its catalog is resolved (`getDynamicCatalog`).

## Design of record

- A provider is a **descriptor** (`ProviderDef`), not an instance — providers
  are built per-config via `createProvider(name, config)`, so the registry holds
  a factory + optional dynamic-catalog hook, never a live `AIProvider`.
- Mirror the established registry pattern **exactly**: a 5th
  `Registry<ProviderDef>` named `providers`, a `PluginApi.providers`
  owner-injecting registrar, a `registerBuiltinProviders()` with an idempotency
  sentinel, lazy registration at the consumption entrypoint, and a boot-time
  `registerBuiltinProviders()` call before `loadPlugins`.
- **Behavior must be byte-identical** for the six built-in providers and three
  dynamic catalogs after the refactor. This is a refactor of working code; the
  acceptance gate is a golden test, not new behavior.
- No new capability is required. Providers receive `config.apiKey` from the
  existing instance/credential machinery; they do not reach the `credentials`
  capability seam (that is #6, the `credentialSocket`). State this explicitly so
  the implementer does not wire a manifest check here.

## Canonical contracts (what the parts implement)

```ts
// providers/provider-def.ts (new)
import type { AIProvider, ProviderConfig } from './base-provider';
import type { CatalogProvider, ModelConfig } from './catalog/types';

/** Context handed to a provider's dynamic-catalog hook. Mirrors exactly what
 *  getCatalogForInstance already has in scope at the call site. */
export interface DynamicCatalogContext {
  instanceId: string;
  endpoint?: string;
  apiKey: string;
  staticCatalog: CatalogProvider | null;
  modelConfig?: ModelConfig;
  forceRefresh: boolean;
}

/** A plugin-contributed (or built-in) provider. `create` is required;
 *  `getDynamicCatalog` is optional — providers without it fall back to the
 *  static catalog, exactly as bedrock/gemini/lmstudio/ollama do today. */
export interface ProviderDef {
  name: string;
  create(config: ProviderConfig): AIProvider;
  getDynamicCatalog?(
    ctx: DynamicCatalogContext
  ): Promise<CatalogProvider | null>;
}
```

## What this plan builds / defers

- **Builds:** the `providers` registry + registrar + built-in registration that
  faithfully reproduces today's `createProvider` switch and
  `getCatalogForInstance` if-chain; rewrites of the two consumption sites to
  draw from the registry; boot wiring; reference-plugin + integration-test
  coverage.
- **Defers:** any change to the `AIProvider` base class itself, the
  catalog/instance/credential machinery, or `ent/providers`/`ent/models` RPC
  shapes. The plugin contract wraps the existing classes; it does not reshape
  them.

---

# Part A — The mechanism (5th registry + registrar)

## Phase A1 — `ProviderDef` type + `providers` registry

**Files:** `providers/provider-def.ts` (new), `plugins/api.ts`.

1. Create `providers/provider-def.ts` with `ProviderDef` and
   `DynamicCatalogContext` exactly as in the canonical contract above. Import
   `AIProvider`/`ProviderConfig` from `./base-provider` and
   `CatalogProvider`/`ModelConfig` from `./catalog/types` **as types only**.
2. In `plugins/api.ts`:
   - Add
     `import type { ProviderDef } from '@lace/agent/providers/provider-def';`
   - Add `providers: Registry<ProviderDef>;` to `PluginRegistries`.
   - Add `providers: PluginRegistrar<ProviderDef>;` to `PluginApi`.
   - In `makeRegistries()`:
     `providers: new Registry<ProviderDef>('providers'),`.
   - In `createPluginApi()`:
     `providers: registrar(registries.providers, meta.name),`.
   - In `resetRegistriesForTest()`: `registries.providers.clear();`.

**Tests (TDD):**

- `makeRegistries().providers` is a `Registry` of kind `'providers'`.
- `createPluginApi(meta, regs).providers.register('x', def)` records owner
  `meta.name` in `regs.providers` (assert via `regs.providers.owner('x')`).
- `resetRegistriesForTest()` clears `providers`.

## Phase A2 — `registerBuiltinProviders()` (faithful mirror, idempotent)

**File:** `providers/builtin-providers.ts` (new).

Reproduce **exactly** today's behavior. Read `providers/registry.ts:570-639`
(`createProvider` switch) and `providers/registry.ts:121-201`
(`getCatalogForInstance` if-chain) and translate each arm into a `ProviderDef`.

```ts
import { registries } from '@lace/agent/plugins';
import { AnthropicProvider } from './anthropic-provider';
// ...the other five provider classes + the three Dynamic* providers...

export function registerBuiltinProviders(): void {
  // Idempotency sentinel — mirrors registerBuiltinTools' !has('bash').
  if (registries.providers.has('anthropic')) return;

  registries.providers.register(
    'anthropic',
    {
      name: 'anthropic',
      create: (config) =>
        new AnthropicProvider({
          ...config,
          apiKey: typeof config.apiKey === 'string' ? config.apiKey : null,
        }),
      getDynamicCatalog: async ({
        instanceId,
        endpoint,
        apiKey,
        staticCatalog,
        forceRefresh,
      }) => {
        if (!staticCatalog) return null;
        const provider = new AnthropicDynamicProvider(instanceId, endpoint);
        return provider.getCatalog(apiKey, staticCatalog, forceRefresh);
      },
    },
    'builtin'
  );

  // ... bedrock, openai, gemini, lmstudio, ollama: create-only or create+catalog,
  //     each arm copied verbatim from the current switch / if-chain ...
}
```

**Migration mapping the implementer MUST preserve (verify against source):**

| name       | `create` (from switch) | `getDynamicCatalog` (from if-chain) |
| ---------- | ---------------------- | ----------------------------------- |
| anthropic  | yes                    | yes (`AnthropicDynamicProvider`)    |
| bedrock    | yes                    | no (static)                         |
| openai     | yes                    | yes (`OpenAIDynamicProvider`)       |
| gemini     | yes                    | no (static)                         |
| lmstudio   | yes                    | no (static)                         |
| ollama     | yes                    | no (static)                         |
| openrouter | **verify**             | yes (`OpenRouterDynamicProvider`)   |

> **openrouter asymmetry — do not guess.** Today `openrouter` appears in the
> catalog if-chain (`registry.ts:180`) but **not** in the `createProvider`
> switch. The implementer must determine from the code how `openrouter`
> instances are instantiated today (likely OpenAI-compatible) and reproduce that
> exactly. If openrouter has no `create` arm today, register it as a
> catalog-only `ProviderDef` whose `create` throws the same "Unknown provider"
> error the switch's `default` arm throws — preserving current behavior
> precisely. Capture the decision in a comment and the golden test.

> `register('test-provider', ...)` is **not** a built-in. Today the switch's
> `test-provider` arm throws "Test provider not supported in production builds";
> preserve that — `registerBuiltinProviders()` must not register it, so
> resolving `'test-provider'` falls through to the same error (see A3).

**Tests (TDD):**

- After `registerBuiltinProviders()`, all six (or seven) names are present with
  owner `'builtin'`.
- Second call is a no-op (sentinel); registering a duplicate does not throw.
- Each `create(config)` returns an instance of the correct provider class.

## Phase A3 — Rewrite the two consumption sites to draw from the registry

**File:** `providers/registry.ts`.

1. **`createProvider(providerName, config)`** — replace the `switch` body:

   ```ts
   registerBuiltinProviders(); // lazy + idempotent (mirrors createDefaultContainerManager)
   const def = registries.providers.resolve(providerName.toLowerCase());
   if (!def) {
     throw new Error(
       `Unknown provider: ${providerName}. Available providers: ${this.getProviderNames().join(', ')}`
     );
   }
   return def.create(config);
   ```

   - `getProviderNames()` must now derive from `registries.providers.names()` so
     the error message and any callers stay correct (verify current
     `getProviderNames` and route it through the registry).
   - Preserve the `test-provider` error: since it is unregistered, `resolve`
     returns undefined and the "Unknown provider" path fires. If any test
     asserts the exact "Test provider not supported in production builds"
     string, register a `test-provider` def whose `create` throws that message
     instead. **Verify which behavior the existing tests expect and match it.**

2. **`getCatalogForInstance(instanceId, forceRefresh)`** — replace the
   anthropic/ openai/openrouter `if`-chain with:

   ```ts
   registerBuiltinProviders();
   const def = registries.providers.resolve(instance.catalogProviderId);
   if (def?.getDynamicCatalog) {
     try {
       const dynamic = await def.getDynamicCatalog({
         instanceId,
         endpoint: instance.endpoint,
         apiKey: credential.apiKey,
         staticCatalog: this.catalogManager.getProvider(
           instance.catalogProviderId
         ),
         modelConfig: instance.modelConfig,
         forceRefresh,
       });
       if (dynamic) return dynamic;
     } catch (error) {
       logger.warn(
         'Failed to fetch dynamic catalog for instance, using static',
         {
           instanceId,
           catalogProviderId: instance.catalogProviderId,
           error,
         }
       );
     }
   }
   return this.catalogManager.getProvider(instance.catalogProviderId);
   ```

   - **Preserve every guard in current order:** the
     `LACE_DISABLE_DYNAMIC_CATALOGS === '1'` short-circuit (`registry.ts:134`),
     the `!instance` → null, the `!credential?.apiKey` → null. Move these
     _before_ the def lookup, exactly as today. Do not change the
     static-fallback semantics.
   - The openrouter arm passes `modelConfig` with its own default
     (`{ enableNewModels: true, disabledModels: [], disabledProviders: [] }`)
     and calls `getCatalogWithConfig`, not `getCatalog`. The openrouter
     `ProviderDef`'s `getDynamicCatalog` must encapsulate that difference
     internally so the call site stays uniform.

**Tests (TDD) — golden / behavior-preserving:**

- For each provider name, `createProvider(name, cfg)` returns the same class as
  before (snapshot of constructor name).
- `getCatalogForInstance` returns the dynamic catalog for
  anthropic/openai/openrouter instances and the static catalog for
  bedrock/gemini/lmstudio/ollama — assert the same source selection as
  pre-refactor.
- `LACE_DISABLE_DYNAMIC_CATALOGS=1` returns static even for anthropic.
- Dynamic-catalog throw falls back to static and logs a warning (capture the
  warning).

## Phase A4 — Boot wiring

**File:** `main.ts`.

Add `registerBuiltinProviders()` to `boot()` alongside the existing built-in
registrations, **before** `loadPlugins(...)`:

```ts
registerBuiltinTools();
registerBuiltinCompaction();
registerBuiltinRuntimes();
registerBuiltinProviders();   // new
await loadPlugins(process.env.LACE_PLUGINS, ...);
```

This guarantees a plugin can `assertVersion` and override/extend providers at
load, and that `registries.providers` is populated before the first
`createProvider`. (The lazy call in A3 covers test paths and any pre-boot use.)

**Note (no capability):** providers do **not** require a manifest capability.
Add a one-line comment at the registrar/registration site stating this, so a
future reader does not assume provider plugins are gated by the `credentials`
capability.

---

# Part B — Reference plugin + integration coverage

## Phase B1 — Extend the reference plugin with a provider

**File:** `plugins/__examples__/reference-plugin.ts`.

Add a minimal `ProviderDef` and register it:

```ts
import type { ProviderDef } from '@lace/agent/providers/provider-def';

// A stub provider def. A real plugin returns a fully-typed AIProvider subclass
// from create(); this stub returns a minimal fake to demonstrate the seam.
const memProvider: ProviderDef = {
  name: 'reference/echo',
  create: () =>
    /* minimal AIProvider stub */ ({
      /* ... */
    }) as unknown as AIProvider,
  getDynamicCatalog: async () => null,
};
// inside register(api):
api.providers.register('reference/echo', memProvider);
```

Keep the file's packaging-contract comment intact; add a `// ── 5) Provider ──`
section mirroring the existing numbered sections.

## Phase B2 — Whole-system integration test

**File:** `plugins/__tests__/whole-system.integration.test.ts`.

Extend the existing test (which already asserts the reference plugin's
tool/compaction/runtime/persona are visible at their consumption sites) to also
assert the **provider** consumption site:

- After loading the reference plugin,
  `registries.providers.has('reference/echo')` with owner `'reference'`.
- `ProviderRegistry.getInstance().createProvider('reference/echo', {...})`
  returns the stub instance (proving the rewritten `createProvider` resolves
  plugin defs, not just built-ins).
- `registries.providers.resolve('reference/echo').getDynamicCatalog` is callable
  and returns null (proving the catalog seam is wired through).

---

# Final verification (after all Parts)

- `npm run typecheck && npm run lint && npm test` in `packages/agent` — green.
- Golden behavior: the pre-existing provider/catalog tests pass unchanged (the
  refactor is behavior-preserving). If any pre-existing test referenced the
  internal `switch`/`if`-chain directly, update it to the registry seam
  **without** weakening the assertion.
- `grep` confirms `createProvider` and `getCatalogForInstance` no longer contain
  a per-provider `switch`/`if`-chain — they resolve from `registries.providers`.

# Self-review / coverage

- [ ] `providers` registry mirrors the other four (registrar, owner-tracking,
      reset).
- [ ] `registerBuiltinProviders()` reproduces the switch + if-chain arm-for-arm,
      including the openrouter asymmetry and the `test-provider`/`default`
      error.
- [ ] All catalog guards (`LACE_DISABLE_DYNAMIC_CATALOGS`, missing instance,
      missing apiKey, throw→static-fallback) preserved in original order.
- [ ] Boot calls `registerBuiltinProviders()` before `loadPlugins`; consumption
      sites also call it lazily (idempotent).
- [ ] No manifest capability added; comment documents why.
- [ ] Reference plugin + integration test cover the provider + catalog seams.

# Execution handoff

Use `superpowers:subagent-driven-development`. Phases A1→A2→A3→A4→B1→B2 are
mostly sequential (A3 depends on A2; B2 depends on B1). A3 is the
integration-judgment phase (route both consumption sites, preserve guards) —
standard model. The rest are mechanical given this spec.
