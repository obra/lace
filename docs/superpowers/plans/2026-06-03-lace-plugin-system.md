# Lace Plugin System — comprehensive (mechanism + four registry domains) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a large plan — execute it Part by Part (A→E); each Part is independently mergeable and leaves default behavior unchanged.

**Goal:** Build lace's entire plugin system in one place — ONE `LACE_PLUGINS` loader feeding four typed registries (`tools`, `compaction`, `runtimes`, `personas`), plus each registry wired to its real consumption site so the mechanism is proven end-to-end across all four extension kinds.

**Architecture:** ESLint's one-object/many-catalogs model (one `api` with typed sub-registrars), not a pluggy hook-bus — the four kinds are catalogs-with-selection. The loader runs in every lace process (`main.ts`); subagents inherit `LACE_PLUGINS` via env (`spawnSubagent` passes `env: {...process.env}`), so plugins reach subagents with no RPC. Built-ins (track-based compaction, in-process tools, the platform container runtime, bundled personas) register into the same registries at boot, alongside plugins. Default behavior is unchanged until a plugin is configured.

**Tech Stack:** TypeScript (strict, no `any`), vitest, Node `child_process`, zod. Package: `packages/agent`. Branch: base off `pri2012-shim-lace`, after the cleanup PR-A′ lands.

---

## ⚠️ Coordination: this plan re-carves the pluggable-compaction worktree

Consolidating the **compaction** registry into the plugin system (Part C) means this plan **absorbs and supersedes the pluggable-compaction worktree's Spec A Phases 1 & 4**: the strategy seam + registry, `validatePreserved`, the toolkit extraction, routing the three compaction call sites, and dropping `LACE_COMPACTION_PLUGINS` (the loader converges to `LACE_PLUGINS`). The worktree (`design/pluggable-compaction`, owned by Jesse + Bot) **retains only**: Spec A Phase 2 (breakpoints), Phase 3 (`compact_session` tool), and Spec B (the `sen-multiconv` regime). Coordinate the merge so the registry/loader exists once, here. Authority: "lace leads the loader; compaction conforms" (Jesse, 2026-06-03), extended to "the loader + compaction registry live in the consolidated plugin spec."

---

## Design of record (read before implementing)

- `sen-core-v2/docs/superpowers/specs/2026-06-03-lace-embedder-architecture.md` — **Part 1** (the plugin system) + **Part 7** (the spec kit, code anchors). The canonical contracts: one loader, four registries, `register(api)`, `assertVersion`, marshalable context, namespacing, dup→fatal, lazy-resolve.
- `lace-worktrees/pluggable-compaction/docs/superpowers/specs/2026-06-03-pluggable-compaction-design.md` — **§1** (the `CompactionStrategy` seam, `validatePreserved` algorithm, toolkit list) + **§4** (the three compaction call sites). Part C below implements §1's seam and §4's routing.

**Canonical `PluginApi` shape:**

```ts
interface PluginApi {
  readonly meta: { name: string; namespace: string; version: string };
  readonly kernelVersion: string;
  assertVersion(major: number): void;          // Babel-style; throws on skew
  tools:      Registry<Tool>;
  compaction: Registry<CompactionStrategy>;
  runtimes:   Registry<ContainerRuntime>;
  personas:   Registry<PersonaDef>;            // PersonaDef = ParsedPersona ({config, body})
}
interface Registry<T> {
  register(name: string, value: T): void;      // dup name → fatal at boot
  resolve(name: string): T;                     // missing → per-agent config error (lazy)
  has(name: string): boolean;
  names(): string[];
}
export function register(api: PluginApi): void { /* a plugin module's entry point */ }
```

---

## What this plan builds (the whole plugin system)

- **Part A — Mechanism.** The loader, generic `Registry<T>`, `PluginApi` + `assertVersion`, the marshalable `PluginCallContext`, the capability manifest (default-deny credential gate), boot integration, and subagent reach. Establishes the four (empty) registries + the boot point where built-ins and plugins both register.
- **Part B — Tools registry domain.** Three adapter shapes behind one `Tool` (in-process exists, MCP exists, **one-shot-exec** new: Docker-CLI metadata-subcommand schema + Terraform-`external` invocation), the **persona keystone** (authoritative persona stamped server-side into `ToolContext`), and drawing `api.tools` into the per-session executor.
- **Part C — Compaction registry domain.** The `CompactionStrategy` seam, `validatePreserved` (replay-legality), the exported toolkit, `track-based` registered into `api.compaction`, all three compaction call sites routed through the registry, and `LACE_COMPACTION_PLUGINS` removed.
- **Part D — Personas registry domain.** `api.personas` as a second source alongside disk personas; `PersonaRegistry` resolution consults it; `PersonaDef = ParsedPersona`.
- **Part E — Runtimes registry domain.** Built-in container runtimes registered into `api.runtimes`; `createDefaultContainerManager` resolves the runtime by name from the registry; the embedder's runtime (the plane) becomes a registered `runtimes` plugin selected via `LACE_CONTAINER_RUNTIME`.

## What this plan defers (rides the registries, specced elsewhere)

- **The plane** — the sen reference runtime *implementation* (deny-by-default spec-builder, native exec-attach, ownership gating). Box-coordinated; spec `container-runtime+plane` (#3). Part E only makes the runtime *selectable from the registry*; it does not build or narrow the runtime.
- **Persona/runtime schema narrowing** — stripping docker/egress/cap fields is coupled to `delegate.ts` reading them; lands with the plane (#3). Part D adds only the additive plumbing (registry source; an additive `compaction` field for Part C selection).
- **Egress, workspace, credentials** — their own specs (#4/#5/#6). Part B leaves the credential socket a seam (`credentialSocket` placeholder gated on the capability manifest).
- **Compaction features** — breakpoints, `compact_session` tool, the regime — stay in the worktree (see the re-carve banner).

---

# Part A — The mechanism (loader + four registries)
## Trust (settled — not a boundary this spec introduces)

**The plugin loader is not a security boundary, and this spec does not treat it as one.** A plugin is loaded only from the boot-time `LACE_PLUGINS` allowlist — never from a session, the protocol, or any client input — so it is exactly as trusted as all other lace code, because it *is* lace code. Whether that code is delivered image-baked or via a rewritable in-container checkout is a deployment / supply-chain question, **orthogonal to the plugin mechanism and out of scope here.** The actual isolation that matters (process-per-agent; the dedicated-uid credential hop) lives in other specs.

What this spec *does* carry, as least-privilege bookkeeping among trusted code (not as a sandbox): the per-plugin **capability manifest** + the **default-deny credential gate** (Phase 3). Its job is narrow — only a plugin that explicitly declares the `credentials` capability may later open the helper socket (enforced end-to-end in spec #6). It is a seam for #6 and a record for attribution, not a containment mechanism. Supply-chain integrity (content-hash manifest, pin-by-digest) is a *target*, additive later where digests are actually wired; this spec neither builds nor depends on it.

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/agent/src/plugins/registry.ts` | Generic `Registry<T>` (register/resolve/has/names; dup→fatal; lazy resolve) |
| `packages/agent/src/plugins/registry.test.ts` | Registry unit tests |
| `packages/agent/src/plugins/context.ts` | `PluginCallContext` (marshalable floor: identity + abort + timeout) |
| `packages/agent/src/plugins/api.ts` | `PluginApi`, `PluginModule`, `assertVersion`, the four registry singletons, `KERNEL_PLUGIN_VERSION` |
| `packages/agent/src/plugins/api.test.ts` | `assertVersion` + api wiring tests |
| `packages/agent/src/plugins/manifest.ts` | Per-plugin capability manifest record + `pluginMayUseCapability()` |
| `packages/agent/src/plugins/manifest.test.ts` | Manifest tests |
| `packages/agent/src/plugins/loader.ts` | `loadPlugins(spec, opts)` — parse, import, register, validate, TIMING, fatal |
| `packages/agent/src/plugins/loader.test.ts` | Loader tests against fixture modules |
| `packages/agent/src/plugins/__fixtures__/*.ts` | Test plugin modules (good, dup, throws, version-skew) |
| `packages/agent/src/plugins/index.ts` | Barrel exports |
| `packages/agent/src/main.ts` | Refactor to async boot-init; `await loadPlugins` before peer |
| `packages/agent/src/__tests__/plugin-subagent-reach.test.ts` | End-to-end: child process inherits `LACE_PLUGINS` and registers identically |

Naming the directory `plugins/` (not `plugin/`) matches the plural-registry framing and avoids clashing with the existing `tools/`, `compaction/`, `containers/`, `config/` domain dirs that the registries will later draw from.

---

## Phase 1 — The generic `Registry<T>`

Each of the four registries is one instance of this. It is the whole "register-by-name, dup→fatal, lazy-resolve, select-by-name" machine, with nothing domain-specific.

**Files:**
- Create: `packages/agent/src/plugins/registry.ts`
- Test: `packages/agent/src/plugins/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/agent/src/plugins/registry.test.ts`:

```typescript
// ABOUTME: Unit tests for the generic plugin Registry<T>
import { describe, it, expect } from 'vitest';
import { Registry, RegistryError } from './registry';

describe('Registry<T>', () => {
  it('registers and resolves by name', () => {
    const r = new Registry<string>('tools');
    r.register('grep', 'GREP');
    expect(r.resolve('grep')).toBe('GREP');
  });

  it('reports membership and lists names in registration order', () => {
    const r = new Registry<number>('compaction');
    r.register('a', 1);
    r.register('b', 2);
    expect(r.has('a')).toBe(true);
    expect(r.has('missing')).toBe(false);
    expect(r.names()).toEqual(['a', 'b']);
  });

  it('throws RegistryError on duplicate name (fatal-at-boot)', () => {
    const r = new Registry<string>('tools');
    r.register('bash', 'first');
    expect(() => r.register('bash', 'second')).toThrow(RegistryError);
    expect(() => r.register('bash', 'second')).toThrow(/duplicate.*bash.*tools/i);
  });

  it('throws RegistryError when resolving a missing name', () => {
    const r = new Registry<string>('personas');
    expect(() => r.resolve('ghost')).toThrow(RegistryError);
    expect(() => r.resolve('ghost')).toThrow(/no.*personas.*ghost/i);
  });

  it('resolves lazily — values registered after construction are visible', () => {
    const r = new Registry<string>('runtimes');
    const resolveLater = () => r.resolve('docker');
    expect(resolveLater).toThrow(RegistryError);
    r.register('docker', 'DOCKER');
    expect(resolveLater()).toBe('DOCKER');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- plugins/registry`
Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 3: Implement `Registry<T>`**

Create `packages/agent/src/plugins/registry.ts`:

```typescript
// ABOUTME: Generic select-one-by-name registry for the lace plugin system
// ABOUTME: register-by-name, dup→fatal, lazy-resolve; one instance per extension kind

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * A select-one-by-name registry. One instance backs each plugin extension kind
 * (tools, compaction, runtimes, personas). Registration happens eagerly at boot;
 * resolution is lazy (first use). A duplicate name is a build/config mistake in a
 * trusted bundled set, so it is fatal at registration time. A missing name at
 * resolve time is a per-agent config error (e.g. a persona named a strategy whose
 * plugin was never configured) — fatal there, not at boot.
 */
export class Registry<T> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly kind: string) {}

  register(name: string, value: T): void {
    if (this.entries.has(name)) {
      throw new RegistryError(`duplicate ${this.kind} registration: "${name}"`);
    }
    this.entries.set(name, value);
  }

  resolve(name: string): T {
    const value = this.entries.get(name);
    if (value === undefined) {
      throw new RegistryError(
        `no ${this.kind} registered under "${name}" (known: ${this.names().join(', ') || 'none'})`
      );
    }
    return value;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  names(): string[] {
    return Array.from(this.entries.keys());
  }
}
```

> Namespacing note: names are stored verbatim. Namespacing (`vendor/bash`) is a *convention* a plugin applies via `api.meta.namespace` when collision-prone; `dup→fatal` catches accidental clashes in the trusted bundled set. Auto-prefixing is a future tightening, not v1.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- plugins/registry`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/plugins/registry.ts packages/agent/src/plugins/registry.test.ts
git commit -m "feat(lace/plugins): generic Registry<T> (register-by-name, dup-fatal, lazy-resolve)"
```

---

## Phase 2 — `PluginCallContext`, `PluginApi`, `assertVersion`

The per-call context *floor* and the registrar object plugins receive. The four registry singletons live here so root and every subagent share the same module-level instances within a process.

**Files:**
- Create: `packages/agent/src/plugins/context.ts`
- Create: `packages/agent/src/plugins/api.ts`
- Test: `packages/agent/src/plugins/api.test.ts`

- [ ] **Step 1: Write `PluginCallContext`**

Create `packages/agent/src/plugins/context.ts`:

```typescript
// ABOUTME: The per-call context floor passed to every plugin-provided extension
// ABOUTME: Marshalable by design (identity+timeout by-value; signal is the lone live handle)

/**
 * The authoritative caller identity. Resolved SERVER-SIDE (session → persona) —
 * never a value the LLM/tool-args can supply. This is the keystone invariant;
 * downstream specs MUST guard it with tests.
 */
export interface CallerIdentity {
  readonly sessionId: string;
  readonly persona: string;
}

/**
 * The contract floor every plugin extension is invoked with. Domain registries
 * (tools, compaction, runtimes) pass a context that INCLUDES these fields and may
 * extend them with domain capabilities.
 *
 * Marshalable by design: `identity` and `timeoutMs` are by-value so the same
 * contract survives a future move to an out-of-process / WASM boundary with no
 * re-contracting. `signal` is the single live handle, deliberately isolated — it
 * is the only field that would need a wire representation in that future move.
 * Do NOT add by-reference live kernel objects (job managers, secret stores) here.
 */
export interface PluginCallContext {
  readonly identity: CallerIdentity;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}
```

- [ ] **Step 2: Write the failing `assertVersion` / api tests**

Create `packages/agent/src/plugins/api.test.ts`:

```typescript
// ABOUTME: Tests for PluginApi construction and assertVersion
import { describe, it, expect } from 'vitest';
import { createPluginApi, KERNEL_PLUGIN_VERSION, PluginVersionError } from './api';
import { Registry } from './registry';

describe('createPluginApi', () => {
  it('exposes four typed registries plus meta and kernelVersion', () => {
    const api = createPluginApi(
      { name: 'demo', namespace: 'demo', version: '1.0.0' },
      { tools: new Registry('tools'), compaction: new Registry('compaction'),
        runtimes: new Registry('runtimes'), personas: new Registry('personas') }
    );
    expect(api.meta.namespace).toBe('demo');
    expect(api.kernelVersion).toBe(KERNEL_PLUGIN_VERSION);
    expect(api.tools.names()).toEqual([]);
    expect(api.personas.names()).toEqual([]);
  });

  it('assertVersion passes for the current kernel major', () => {
    const major = Number(KERNEL_PLUGIN_VERSION.split('.')[0]);
    const api = createPluginApi(
      { name: 'demo', namespace: 'demo', version: '1.0.0' },
      { tools: new Registry('tools'), compaction: new Registry('compaction'),
        runtimes: new Registry('runtimes'), personas: new Registry('personas') }
    );
    expect(() => api.assertVersion(major)).not.toThrow();
  });

  it('assertVersion throws PluginVersionError on major mismatch', () => {
    const api = createPluginApi(
      { name: 'demo', namespace: 'demo', version: '1.0.0' },
      { tools: new Registry('tools'), compaction: new Registry('compaction'),
        runtimes: new Registry('runtimes'), personas: new Registry('personas') }
    );
    const wrongMajor = Number(KERNEL_PLUGIN_VERSION.split('.')[0]) + 1;
    expect(() => api.assertVersion(wrongMajor)).toThrow(PluginVersionError);
    expect(() => api.assertVersion(wrongMajor)).toThrow(/major/i);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- plugins/api`
Expected: FAIL — `Cannot find module './api'`.

- [ ] **Step 4: Implement `api.ts`**

Create `packages/agent/src/plugins/api.ts`:

```typescript
// ABOUTME: PluginApi — the registrar object a plugin's register(api) receives
// ABOUTME: One api per plugin (carries its meta + a shared set of four registries)

import { Registry } from './registry';
import type { Tool } from '@lace/agent/tools/tool';
import type { CompactionStrategy } from '@lace/agent/compaction/types';
import type { ContainerRuntime } from '@lace/agent/containers/types';
import type { PersonaConfig } from '@lace/agent/config/persona-registry';

/** The plugin-API major.minor.patch. Bump the MAJOR on a breaking api/context change. */
export const KERNEL_PLUGIN_VERSION = '1.0.0';

export class PluginVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginVersionError';
  }
}

/** Persona definitions live in config; this alias names the registry value type. */
export type PersonaDef = PersonaConfig;

/** The four registries, shared across all plugins loaded in a process. */
export interface PluginRegistries {
  tools: Registry<Tool>;
  compaction: Registry<CompactionStrategy>;
  runtimes: Registry<ContainerRuntime>;
  personas: Registry<PersonaDef>;
}

export interface PluginMeta {
  name: string;
  namespace: string;
  version: string;
}

/** What `register(api)` receives. */
export interface PluginApi extends PluginRegistries {
  readonly meta: PluginMeta;
  readonly kernelVersion: string;
  /** Babel-style: a plugin declares the kernel major it was built against. */
  assertVersion(major: number): void;
}

/** The required shape of a plugin module. */
export interface PluginModule {
  register(api: PluginApi): void;
}

export function createPluginApi(meta: PluginMeta, registries: PluginRegistries): PluginApi {
  const kernelMajor = Number(KERNEL_PLUGIN_VERSION.split('.')[0]);
  return {
    ...registries,
    meta,
    kernelVersion: KERNEL_PLUGIN_VERSION,
    assertVersion(major: number): void {
      if (major !== kernelMajor) {
        throw new PluginVersionError(
          `plugin "${meta.name}" requires kernel plugin major ${major}, ` +
            `but this kernel is ${KERNEL_PLUGIN_VERSION}`
        );
      }
    },
  };
}

/**
 * The process-wide registry singletons. Constructed once per lace process; the
 * loader registers into these, and downstream consumers resolve from them. Because
 * every lace process (root + each subagent) imports this module and runs the loader,
 * the registries are identical across the process tree.
 */
export const registries: PluginRegistries = {
  tools: new Registry<Tool>('tools'),
  compaction: new Registry<CompactionStrategy>('compaction'),
  runtimes: new Registry<ContainerRuntime>('runtimes'),
  personas: new Registry<PersonaDef>('personas'),
};
```

> If `PersonaConfig` is not an exported name in `config/persona-registry.ts`, export the zod-inferred type there (`export type PersonaConfig = z.infer<typeof personaConfigSchema>;`) — a one-line additive export, no behavior change. Verify the exact exported name before importing; do not invent it.

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- plugins/api`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/plugins/context.ts packages/agent/src/plugins/api.ts packages/agent/src/plugins/api.test.ts
git commit -m "feat(lace/plugins): PluginApi + assertVersion + marshalable PluginCallContext"
```

---

## Phase 3 — Capability manifest + default-deny credential gate (seam)

A plugin declares which privileged capabilities it needs; the loader records the declaration; a single query function answers "may this plugin use capability X?". v1 enforces nothing beyond the **credential path default-deny** seam (full enforcement is spec #6). This is least-privilege bookkeeping among trusted code, not a containment mechanism (see "Trust" above).

**Files:**
- Create: `packages/agent/src/plugins/manifest.ts`
- Test: `packages/agent/src/plugins/manifest.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/agent/src/plugins/manifest.test.ts`:

```typescript
// ABOUTME: Tests for the per-plugin capability manifest
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordManifest, pluginMayUseCapability, resetManifestsForTest, type CapabilityManifest,
} from './manifest';

describe('capability manifest', () => {
  beforeEach(() => resetManifestsForTest());

  it('grants a capability a plugin explicitly declared', () => {
    const m: CapabilityManifest = { capabilities: ['credentials'] };
    recordManifest('vendor/creds', m);
    expect(pluginMayUseCapability('vendor/creds', 'credentials')).toBe(true);
  });

  it('default-denies a capability not declared (the credential path)', () => {
    recordManifest('vendor/grep', { capabilities: [] });
    expect(pluginMayUseCapability('vendor/grep', 'credentials')).toBe(false);
  });

  it('default-denies an unknown plugin', () => {
    expect(pluginMayUseCapability('never-registered', 'credentials')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- plugins/manifest`
Expected: FAIL — `Cannot find module './manifest'`.

- [ ] **Step 3: Implement `manifest.ts`**

Create `packages/agent/src/plugins/manifest.ts`:

```typescript
// ABOUTME: Per-plugin capability manifest — the privileged-capability declaration
// ABOUTME: v1: record + query; default-deny. Enforcement of the credential path = spec #6.

/** Privileged capabilities a plugin may declare a need for. Grows additively. */
export type Capability = 'credentials';

export interface CapabilityManifest {
  capabilities: Capability[];
}

const manifests = new Map<string, CapabilityManifest>();

/** Record a plugin's declared manifest at load time (keyed by plugin name). */
export function recordManifest(pluginName: string, manifest: CapabilityManifest): void {
  manifests.set(pluginName, manifest);
}

/**
 * Default-deny: a capability is granted only if the plugin explicitly declared it.
 * An unknown plugin (no manifest recorded) is denied. The credential path (spec #6)
 * gates on this so only explicitly-granted tools may open the helper socket.
 */
export function pluginMayUseCapability(pluginName: string, capability: Capability): boolean {
  return manifests.get(pluginName)?.capabilities.includes(capability) ?? false;
}

/** Test-only: clear recorded manifests between cases. */
export function resetManifestsForTest(): void {
  manifests.clear();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- plugins/manifest`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/plugins/manifest.ts packages/agent/src/plugins/manifest.test.ts
git commit -m "feat(lace/plugins): per-plugin capability manifest + default-deny credential gate"
```

---

## Phase 4 — The loader

Parse `LACE_PLUGINS` (comma-separated module specifiers, in order), dynamic-import each, call `register(api)` with a fresh api carrying that plugin's meta + the shared registries, validate, record per-plugin TIMING. Any failure (missing module, import throw, bad shape, dup name, version skew) is fatal. The loader is a pure async function (no `process.exit` inside it) so tests can assert the thrown error; `main.ts` (Phase 5) is what exits.

**Files:**
- Create: `packages/agent/src/plugins/loader.ts`
- Create: fixture modules under `packages/agent/src/plugins/__fixtures__/`
- Create: `packages/agent/src/plugins/index.ts`
- Test: `packages/agent/src/plugins/loader.test.ts`

- [ ] **Step 1: Create the fixture plugin modules**

Create `packages/agent/src/plugins/__fixtures__/good-plugin.ts`:

```typescript
// ABOUTME: Test fixture — a well-formed plugin that registers one persona-ish value
import type { PluginApi } from '../api';

export function register(api: PluginApi): void {
  api.assertVersion(1);
  // Register into the personas registry with a minimal stub value. The mechanism,
  // not the domain value, is under test here; cast keeps the fixture decoupled from
  // the full PersonaConfig shape.
  api.personas.register('fixture-persona', { runtime: { type: 'root' } } as never);
}
```

Create `packages/agent/src/plugins/__fixtures__/dup-persona-plugin.ts`:

```typescript
// ABOUTME: Test fixture — registers the SAME name as good-plugin to trigger dup→fatal
import type { PluginApi } from '../api';

export function register(api: PluginApi): void {
  api.personas.register('fixture-persona', { runtime: { type: 'root' } } as never);
}
```

Create `packages/agent/src/plugins/__fixtures__/throws-on-register-plugin.ts`:

```typescript
// ABOUTME: Test fixture — throws inside register() to exercise fatal-on-register
import type { PluginApi } from '../api';

export function register(_api: PluginApi): void {
  throw new Error('boom during register');
}
```

Create `packages/agent/src/plugins/__fixtures__/version-skew-plugin.ts`:

```typescript
// ABOUTME: Test fixture — asserts a future kernel major to exercise version skew
import type { PluginApi } from '../api';

export function register(api: PluginApi): void {
  api.assertVersion(999);
}
```

Create `packages/agent/src/plugins/__fixtures__/not-a-plugin.ts`:

```typescript
// ABOUTME: Test fixture — exports no register() to exercise bad-shape detection
export const nope = true;
```

- [ ] **Step 2: Write the failing loader tests**

Create `packages/agent/src/plugins/loader.test.ts`:

```typescript
// ABOUTME: Tests for the plugin loader against fixture modules
import { describe, it, expect } from 'vitest';
import { loadPlugins, parsePluginSpec, PluginLoadError } from './loader';
import { Registry } from './registry';
import type { PluginRegistries } from './api';

function freshRegistries(): PluginRegistries {
  return {
    tools: new Registry('tools'),
    compaction: new Registry('compaction'),
    runtimes: new Registry('runtimes'),
    personas: new Registry('personas'),
  };
}

const FIX = './__fixtures__';

describe('parsePluginSpec', () => {
  it('returns [] for undefined/empty', () => {
    expect(parsePluginSpec(undefined)).toEqual([]);
    expect(parsePluginSpec('')).toEqual([]);
    expect(parsePluginSpec('  ')).toEqual([]);
  });
  it('splits comma-separated specifiers and trims, preserving order', () => {
    expect(parsePluginSpec(' a , b ,c ')).toEqual(['a', 'b', 'c']);
  });
});

describe('loadPlugins', () => {
  it('no-ops on empty spec (default behavior unchanged)', async () => {
    const r = freshRegistries();
    const result = await loadPlugins(undefined, { registries: r });
    expect(result.loaded).toEqual([]);
    expect(r.personas.names()).toEqual([]);
  });

  it('loads a good plugin and populates the registry', async () => {
    const r = freshRegistries();
    await loadPlugins(`${FIX}/good-plugin`, { registries: r });
    expect(r.personas.has('fixture-persona')).toBe(true);
  });

  it('records per-plugin timing', async () => {
    const r = freshRegistries();
    const result = await loadPlugins(`${FIX}/good-plugin`, { registries: r });
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].name).toContain('good-plugin');
    expect(typeof result.loaded[0].ms).toBe('number');
  });

  it('is fatal when a module specifier cannot be imported', async () => {
    const r = freshRegistries();
    await expect(loadPlugins(`${FIX}/does-not-exist`, { registries: r }))
      .rejects.toThrow(PluginLoadError);
  });

  it('is fatal when a module has no register() export', async () => {
    const r = freshRegistries();
    await expect(loadPlugins(`${FIX}/not-a-plugin`, { registries: r }))
      .rejects.toThrow(/register/i);
  });

  it('is fatal when register() throws', async () => {
    const r = freshRegistries();
    await expect(loadPlugins(`${FIX}/throws-on-register-plugin`, { registries: r }))
      .rejects.toThrow(/boom during register/);
  });

  it('is fatal on duplicate name across two plugins', async () => {
    const r = freshRegistries();
    await expect(
      loadPlugins(`${FIX}/good-plugin,${FIX}/dup-persona-plugin`, { registries: r })
    ).rejects.toThrow(/duplicate/i);
  });

  it('is fatal on version skew', async () => {
    const r = freshRegistries();
    await expect(loadPlugins(`${FIX}/version-skew-plugin`, { registries: r }))
      .rejects.toThrow(/major/i);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- plugins/loader`
Expected: FAIL — `Cannot find module './loader'`.

- [ ] **Step 4: Implement `loader.ts`**

Create `packages/agent/src/plugins/loader.ts`:

```typescript
// ABOUTME: The one plugin loader — parse LACE_PLUGINS, import in order, register(api), validate
// ABOUTME: Pure async (no process.exit); fatal == throws PluginLoadError. main.ts handles exit.

import { logger } from '@lace/agent/utils/logger';
import { createPluginApi, registries as globalRegistries, type PluginRegistries, type PluginModule } from './api';

export class PluginLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PluginLoadError';
  }
}

export interface LoadPluginsOptions {
  /** Inject registries in tests; defaults to the process-wide singletons. */
  registries?: PluginRegistries;
}

export interface LoadedPlugin {
  name: string;
  ms: number;
}

export interface LoadPluginsResult {
  loaded: LoadedPlugin[];
}

/** Parse a comma-separated, ordered list of module specifiers. */
export function parsePluginSpec(spec: string | undefined): string[] {
  if (!spec || !spec.trim()) return [];
  return spec.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function isPluginModule(mod: unknown): mod is PluginModule {
  return typeof (mod as { register?: unknown })?.register === 'function';
}

/**
 * Load the ordered plugin list. Each specifier is dynamic-imported, validated to
 * export register(), and invoked with an api carrying that plugin's meta + the
 * shared registries. ANY failure is fatal (throws PluginLoadError). Iteration is
 * in array order (deterministic), so registration order — and therefore the
 * registries — is identical in every process given the same LACE_PLUGINS.
 */
export async function loadPlugins(
  spec: string | undefined,
  opts: LoadPluginsOptions = {}
): Promise<LoadPluginsResult> {
  const registries = opts.registries ?? globalRegistries;
  const specifiers = parsePluginSpec(spec);
  const loaded: LoadedPlugin[] = [];

  for (const specifier of specifiers) {
    const startedAt = Date.now();
    let mod: unknown;
    try {
      mod = await import(specifier);
    } catch (err) {
      throw new PluginLoadError(`failed to import plugin "${specifier}"`, { cause: err });
    }
    if (!isPluginModule(mod)) {
      throw new PluginLoadError(`plugin "${specifier}" does not export a register() function`);
    }
    const api = createPluginApi(
      { name: specifier, namespace: specifier, version: '0.0.0' },
      registries
    );
    try {
      mod.register(api);
    } catch (err) {
      // dup-name (RegistryError) and version-skew (PluginVersionError) surface here too.
      const message = err instanceof Error ? err.message : String(err);
      throw new PluginLoadError(`plugin "${specifier}" register() failed: ${message}`, { cause: err });
    }
    const ms = Date.now() - startedAt;
    loaded.push({ name: specifier, ms });
    logger.info('plugins.loaded', { plugin: specifier, ms }); // ESLint-TIMING-style attribution
  }

  return { loaded };
}
```

> The fixture import specifiers (`./__fixtures__/...`) resolve relative to the compiled `loader.js`. If the test runner cannot resolve relative dynamic imports from this module's directory, switch the fixtures to absolute `import.meta.url`-based specifiers in the test (compute with `new URL('./__fixtures__/good-plugin.ts', import.meta.url).pathname`). Verify which the vitest config supports before settling.

- [ ] **Step 5: Create the barrel `index.ts`**

Create `packages/agent/src/plugins/index.ts`:

```typescript
// ABOUTME: Public surface of the lace plugin system
export { Registry, RegistryError } from './registry';
export {
  createPluginApi, registries, KERNEL_PLUGIN_VERSION, PluginVersionError,
  type PluginApi, type PluginModule, type PluginMeta, type PluginRegistries, type PersonaDef,
} from './api';
export { type PluginCallContext, type CallerIdentity } from './context';
export {
  recordManifest, pluginMayUseCapability, resetManifestsForTest,
  type Capability, type CapabilityManifest,
} from './manifest';
export {
  loadPlugins, parsePluginSpec, PluginLoadError,
  type LoadPluginsResult, type LoadedPlugin, type LoadPluginsOptions,
} from './loader';
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- plugins/loader`
Expected: PASS (all loader + parse tests).

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/plugins/loader.ts packages/agent/src/plugins/index.ts \
        packages/agent/src/plugins/__fixtures__ packages/agent/src/plugins/loader.test.ts
git commit -m "feat(lace/plugins): the LACE_PLUGINS loader (ordered import, register, validate, fatal, TIMING)"
```

---

## Phase 5 — Boot integration + subagent reach

Wire the loader into `main.ts` so plugins load **before** the JSON-RPC peer accepts frames, without dropping early frames. Then prove subagent reach: a child lace process inherits `LACE_PLUGINS` (via `spawnSubagent`'s `env: { ...process.env }`) and runs the same `main.ts`, so its registries are identical — no RPC propagation needed.

### Why the ordering is delicate (read before editing `main.ts`)

`main.ts` pipes `process.stdin` into a `PassThrough` tee (`stdinTee`) at module load. A `PassThrough` **buffers** while it has no consumer and only enters flowing mode once a `data` listener (or pipe) attaches. Today the protocol-log `data` listener attaches immediately (current line 44), putting the tee in flowing mode before the peer is wired — the documented "H15" hazard the existing code dances around. The fix for plugin load is to **do the async load before attaching ANY consumer to the tee**: while we `await loadPlugins(...)`, the tee buffers inbound frames; we attach the protocol-log listener and construct the peer only after plugins are registered. No frame is lost because nothing consumed the tee during the await.

**Files:**
- Modify: `packages/agent/src/main.ts`
- Test: `packages/agent/src/__tests__/plugin-subagent-reach.test.ts`

- [ ] **Step 1: Refactor `main.ts` to an async boot-init**

Restructure `main.ts` so that everything from the protocol-log `data` listener through peer construction runs inside an async `boot()` that first awaits the loader. The `stdinTee` and the `process.stdin.pipe(stdinTee)` stay at module top (so buffering starts immediately); the `readable.on('data', ...)` listener, the `transport`, the `JsonRpcPeer`, `registerAgentRpcMethods`, and the backfill `setImmediate` all move inside `boot()` after the await.

Insert the load + guard. Replace the section that currently constructs the transport/peer (current lines ~78–98) with an async boot wrapper:

```typescript
import { loadPlugins, PluginLoadError } from './plugins';

// ... existing module-top setup (state, logger, stdinTee, pipe, writable, runStartupReaper) ...

async function boot(): Promise<void> {
  // Load plugins BEFORE any consumer attaches to stdinTee, so inbound frames
  // buffer in the tee during the (possibly slow) dynamic imports rather than
  // being consumed by the protocol-log listener and lost (H15).
  try {
    const result = await loadPlugins(process.env.LACE_PLUGINS);
    if (result.loaded.length > 0) {
      logger.info(`plugins: loaded ${result.loaded.length} (${result.loaded.map((p) => p.name).join(', ')})`);
    }
  } catch (err) {
    const message = err instanceof PluginLoadError ? err.message : String(err);
    logger.error(`plugins: fatal load failure: ${message}`);
    // Fatal: exit non-zero before accepting any frame. LaceSupervisor treats this
    // as a crash and respawns; a persistent misconfig surfaces as a respawn loop
    // with repeated fatal logs (a config error, not a flapping bug).
    process.exit(1);
  }

  // Now safe to attach the protocol-log consumer and wire the peer.
  readable.on('data', (chunk) => {
    const lines = chunk.toString().split(/\n/).filter((l: string) => l.trim().length > 0);
    if (protocolLog) {
      for (const line of lines) {
        protocolLog.write(`${new Date().toISOString()} IN ${line}\n`);
      }
    }
  });

  const transport = createNdjsonStdioTransport({ readable, writable });
  const peer = new JsonRpcPeer(transport, { idPrefix: 'a_' });
  state.peer = peer;
  registerAgentRpcMethods(peer, state);

  setImmediate(() => {
    try {
      const stats = backfillIndex(getRecallIndex(), laceDir);
      logger.info(`recall: backfill scanned=${stats.scanned} inserted=${stats.inserted}`);
    } catch (err) {
      logger.error(`recall: backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

void boot();
```

Move the `readable.on('data', ...)` listener (current lines 44–54) OUT of module-top and into `boot()` as shown — this is the load-bearing change. Keep `const readable = stdinTee;` at module top. Leave the `shutdown()` handlers (current lines 100–122) at module top; they reference `peer` — promote `peer` to a module-scoped `let peer: JsonRpcPeer | undefined;` assigned inside `boot()`, and guard `peer?.close()` in `shutdown()`.

- [ ] **Step 2: Verify the existing protocol still boots (no plugins configured)**

Run:
```bash
npm run typecheck
npm test -- agent
```
Expected: typecheck clean; existing server/RPC/integration tests still pass with `LACE_PLUGINS` unset (empty load = no-op, peer wires exactly as before). If any test asserts on boot timing/order, confirm it still passes; the only added latency is one `await` of an empty loader.

- [ ] **Step 3: Write the subagent-reach end-to-end test**

This is the test that proves the central architectural claim. It spawns a real child lace process with `LACE_PLUGINS` set to a fixture and asserts the child registered it — i.e. reach is achieved by env inheritance, not RPC.

Create `packages/agent/src/__tests__/plugin-subagent-reach.test.ts`:

```typescript
// ABOUTME: E2E — a child lace process inherits LACE_PLUGINS and loads the same plugins
// ABOUTME: Proves subagent reach is via env inheritance + loader-in-every-main.ts, not RPC
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

// A tiny standalone script that runs the loader exactly as main.ts does and prints
// the resulting registry names. Kept inline as a fixture path resolved at runtime.
const PROBE = path.resolve(__dirname, '../plugins/__fixtures__/loader-probe.ts');

describe('subagent plugin reach (env inheritance)', () => {
  it('a child process with LACE_PLUGINS set registers the plugin', () => {
    const res = spawnSync(
      process.execPath,
      ['--import', 'tsx', PROBE], // adjust runner per repo's ts execution (see note)
      {
        env: { ...process.env, LACE_PLUGINS: '../plugins/__fixtures__/good-plugin' },
        encoding: 'utf8',
        cwd: __dirname,
      }
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('fixture-persona');
  });
});
```

Create the probe `packages/agent/src/plugins/__fixtures__/loader-probe.ts`:

```typescript
// ABOUTME: Standalone probe — loads LACE_PLUGINS like main.ts and prints registry names
import { loadPlugins, registries } from '../index';

async function main(): Promise<void> {
  await loadPlugins(process.env.LACE_PLUGINS);
  process.stdout.write(registries.personas.names().join(',') + '\n');
}
void main();
```

> **Runner note:** lace's tests run under vitest; spawning a TS file in a child needs the repo's TS loader (`tsx`, `ts-node`, or a prebuilt `dist`). Inspect `package.json`/`vitest.config` for how the agent runs TS at runtime and match it (e.g. `tsx <probe>`, or point at the compiled `dist/.../loader-probe.js` if tests run post-build). If spawning TS is impractical in CI, fall back to asserting reach in-process: import `loadPlugins` + `registries` twice via two module realms is not faithful — prefer the real subprocess. Keep the subprocess form if at all achievable; it is the only faithful proof.

- [ ] **Step 4: Run to verify the e2e passes**

Run: `npm test -- plugin-subagent-reach`
Expected: PASS — child exits 0 and its persona registry contains `fixture-persona`, proving the env-inherited loader ran in the child.

- [ ] **Step 5: Run the full suite**

Run:
```bash
npm run typecheck
npm run lint
npm test
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/main.ts \
        packages/agent/src/__tests__/plugin-subagent-reach.test.ts \
        packages/agent/src/plugins/__fixtures__/loader-probe.ts
git commit -m "feat(lace/plugins): load LACE_PLUGINS at boot before frames; prove subagent reach via env"
```

---

## Hook-bus seam (no code — documented decision)

A pluggy-style 1:N "all plugins observe the same event" bus is **deliberately not built**. The four registries are select-one catalogs, not run-everything chains. When a genuine all-plugins-observe extension point appears (e.g. a future `onMessage`/`transformPrompt`), add a fifth field `events` to `PluginRegistries` whose value is a different structure (an ordered list, not a map). The `register(api)` contract already accommodates it (one more api field). Do not add it speculatively.

---

---

# Part B — Tools registry domain
## File map

| File | Responsibility |
|------|----------------|
| `packages/agent/src/tools/types.ts` | Add `persona?: string` to `ToolContext` |
| `packages/agent/src/core/conversation/runner.ts` | Stamp `persona` into the assembled `ToolContext` |
| `packages/agent/src/tools/exec/descriptor.ts` | Exec-tool descriptor type + zod parse of `lace-tool-schema` output |
| `packages/agent/src/tools/exec/discover.ts` | `discoverExecTools(dir)` — scan scoped dir, run metadata subcommand, build adapters |
| `packages/agent/src/tools/exec/exec-tool-adapter.ts` | `ExecToolAdapter extends Tool` — the invocation contract |
| `packages/agent/src/tools/exec/run-once.ts` | `runExecToolProcess()` — isolated child spawn (min env, cwd, process-group kill, timeout) |
| `packages/agent/src/tools/exec/*.test.ts` | Unit tests per module |
| `packages/agent/src/tools/exec/__fixtures__/*.sh` | Fixture exec-tool binaries (shell scripts) |
| `packages/agent/src/tools/executor.ts` | Draw plugin `api.tools` into the per-session executor |

A `tools/exec/` subdir keeps the new shape isolated from the in-process implementations in `tools/implementations/`.

---

## Phase 1 — The persona keystone

Make the authoritative persona available to every tool, resolved server-side. This is the invariant the credential tool (and exec tools) depend on: persona is **never** a tool argument.

**Files:**
- Modify: `packages/agent/src/tools/types.ts`
- Modify: `packages/agent/src/core/conversation/runner.ts`
- Test: `packages/agent/src/core/conversation/__tests__/runner-persona-context.test.ts` (or colocate with existing runner tests — match the repo's location)

- [ ] **Step 1: Write the failing test**

Assert that the `ToolContext` a tool receives carries the session's persona resolved from session meta, and that a tool-args `persona` field cannot influence it. The cleanest seam is a fake tool that captures its context. Create `packages/agent/src/core/conversation/__tests__/runner-persona-context.test.ts`:

```typescript
// ABOUTME: The runner stamps the authoritative persona into ToolContext server-side
import { describe, it, expect } from 'vitest';
import type { ToolContext } from '@lace/agent/tools/types';
// Use the repo's existing runner test harness/builders. Import the same helpers the
// neighbouring runner tests use to construct a ConversationRunner with a stub provider
// that emits a single tool call, and a session whose meta.persona = 'researcher'.
import { buildRunnerForTest, stubProviderEmittingToolCall } from './_runner-test-helpers';

describe('runner persona stamping', () => {
  it('stamps ToolContext.persona from session meta, ignoring tool args', async () => {
    let captured: ToolContext | undefined;
    const captureTool = {
      name: 'capture',
      description: 'captures ctx',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: async (_args: unknown, ctx: ToolContext) => {
        captured = ctx;
        return { content: [{ type: 'text', text: 'ok' }], status: 'completed' as const };
      },
    };
    const runner = buildRunnerForTest({
      sessionMeta: { persona: 'researcher' },
      tools: [captureTool],
      provider: stubProviderEmittingToolCall('capture', { persona: 'attacker' }),
    });
    await runner.run();
    expect(captured?.persona).toBe('researcher');
  });
});
```

> If `_runner-test-helpers` does not exist, build the runner the way the existing `runner.*.test.ts` files do (they already construct runners with stub providers). The assertion that matters: `ctx.persona === 'researcher'` even though the tool-call args contained `persona: 'attacker'`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- runner-persona-context`
Expected: FAIL — `captured.persona` is `undefined` (field not on `ToolContext` and never stamped).

- [ ] **Step 3: Add `persona` to `ToolContext`**

In `packages/agent/src/tools/types.ts`, in the `ToolContext` interface near `activeSessionId` (~line 44):

```typescript
  activeSessionId?: string;
  activeSessionDir?: string;

  // Authoritative persona for the active session, resolved SERVER-SIDE from
  // session meta. NEVER populated from tool arguments — the keystone invariant.
  persona?: string;
```

- [ ] **Step 4: Stamp `persona` at the assembly site**

In `packages/agent/src/core/conversation/runner.ts`, at the `ToolContext` object built in `executeToolCall` (~lines 1637-1662), add the persona field next to `activeSessionId`. Resolve it server-side from session meta. If the runner already has the persona on `this.deps`/`this.config` (check `this.config.personaName` / `this.deps`), use that; otherwise resolve via `personaForSessionDir(this.config.sessionDir)`:

```typescript
        ...(this.deps.activeSessionId ? { activeSessionId: this.deps.activeSessionId } : {}),
        activeSessionDir: this.config.sessionDir,
        ...(this.#resolvePersona() ? { persona: this.#resolvePersona() } : {}),
```

Add the private resolver (memoized; persona is fixed per session):

```typescript
  #personaResolved: string | null | undefined;
  #resolvePersona(): string | undefined {
    if (this.#personaResolved === undefined) {
      // Prefer an already-resolved persona on config; fall back to session meta.
      this.#personaResolved =
        this.config.personaName ?? personaForSessionDir(this.config.sessionDir) ?? null;
    }
    return this.#personaResolved ?? undefined;
  }
```

Add the import: `import { personaForSessionDir } from '@lace/agent/storage/event-log';` (verify the exact export path/name from `storage/event-log.ts:61-86`). Confirm whether `this.config` exposes `personaName` (`RunnerConfig`); if not, use the `personaForSessionDir` path only.

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- runner-persona-context`
Expected: PASS — `ctx.persona === 'researcher'`, unaffected by the args.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/tools/types.ts packages/agent/src/core/conversation/runner.ts \
        packages/agent/src/core/conversation/__tests__/runner-persona-context.test.ts
git commit -m "feat(lace/tools): stamp authoritative persona into ToolContext server-side (keystone)"
```

---

## Phase 2 — Exec-tool descriptor + discovery

A one-shot-exec tool advertises its schema via a metadata subcommand: `<bin> lace-tool-schema` prints a JSON descriptor on stdout and exits 0. Discovery scans a **scoped directory** (never `$PATH`) and builds an adapter per binary.

**Files:**
- Create: `packages/agent/src/tools/exec/descriptor.ts`
- Create: `packages/agent/src/tools/exec/discover.ts`
- Create fixtures: `packages/agent/src/tools/exec/__fixtures__/echo-tool.sh`, `bad-schema-tool.sh`
- Test: `packages/agent/src/tools/exec/descriptor.test.ts`, `discover.test.ts`

- [ ] **Step 1: Write the descriptor + its test**

Create `packages/agent/src/tools/exec/descriptor.test.ts`:

```typescript
// ABOUTME: Tests for parsing a lace-tool-schema descriptor
import { describe, it, expect } from 'vitest';
import { parseExecToolDescriptor, ExecToolDescriptorError } from './descriptor';

describe('parseExecToolDescriptor', () => {
  it('parses a valid descriptor', () => {
    const d = parseExecToolDescriptor(JSON.stringify({
      name: 'weather', description: 'get weather',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    }));
    expect(d.name).toBe('weather');
    expect(d.inputSchema.type).toBe('object');
  });

  it('accepts an optional capabilities array', () => {
    const d = parseExecToolDescriptor(JSON.stringify({
      name: 'creds', description: 'x', inputSchema: { type: 'object', properties: {} },
      capabilities: ['credentials'],
    }));
    expect(d.capabilities).toEqual(['credentials']);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseExecToolDescriptor('not json')).toThrow(ExecToolDescriptorError);
  });

  it('throws when required fields are missing', () => {
    expect(() => parseExecToolDescriptor(JSON.stringify({ name: 'x' }))).toThrow(ExecToolDescriptorError);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- exec/descriptor` → FAIL (no module).

- [ ] **Step 3: Implement `descriptor.ts`**

```typescript
// ABOUTME: The exec-tool schema descriptor (output of `<bin> lace-tool-schema`)
// ABOUTME: MCP-like: name + description + JSON-Schema inputSchema, optional capabilities

import { z } from 'zod';
import type { Capability } from '@lace/agent/plugins';

export class ExecToolDescriptorError extends Error {
  constructor(message: string) { super(message); this.name = 'ExecToolDescriptorError'; }
}

// inputSchema is a JSON Schema object; validate the envelope, keep the schema opaque.
const descriptorSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.object({ type: z.literal('object') }).passthrough(),
  capabilities: z.array(z.enum(['credentials'])).optional(),
}).strict();

export interface ExecToolDescriptor {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  capabilities?: Capability[];
}

export function parseExecToolDescriptor(raw: string): ExecToolDescriptor {
  let json: unknown;
  try { json = JSON.parse(raw); }
  catch { throw new ExecToolDescriptorError(`lace-tool-schema output is not valid JSON: ${raw.slice(0, 200)}`); }
  const result = descriptorSchema.safeParse(json);
  if (!result.success) {
    throw new ExecToolDescriptorError(`invalid lace-tool-schema descriptor: ${result.error.message}`);
  }
  return result.data as ExecToolDescriptor;
}
```

- [ ] **Step 4: Create fixture binaries**

`packages/agent/src/tools/exec/__fixtures__/echo-tool.sh` (mode `+x`):

```bash
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "lace-tool-schema" ]; then
  printf '%s' '{"name":"echo","description":"echoes input.msg","inputSchema":{"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"]}}'
  exit 0
fi
if [ "${1:-}" = "lace-tool-invoke" ]; then
  payload="$(cat)"                       # JSON on stdin: { input, context }
  msg="$(printf '%s' "$payload" | sed -n 's/.*"msg":"\([^"]*\)".*/\1/p')"
  persona="$(printf '%s' "$payload" | sed -n 's/.*"persona":"\([^"]*\)".*/\1/p')"
  printf '{"content":"echo:%s persona:%s"}' "$msg" "$persona"   # JSON on stdout
  exit 0
fi
echo "unknown subcommand" >&2
exit 2
```

`packages/agent/src/tools/exec/__fixtures__/bad-schema-tool.sh` (mode `+x`):

```bash
#!/usr/bin/env bash
if [ "${1:-}" = "lace-tool-schema" ]; then echo "not json"; exit 0; fi
exit 2
```

> Ensure both are committed executable: `git update-index --chmod=+x` (or `chmod +x` before `git add`). The discovery code does not rely on the extension; it relies on the file being executable.

- [ ] **Step 5: Write the discovery test**

Create `packages/agent/src/tools/exec/discover.test.ts`:

```typescript
// ABOUTME: Tests exec-tool discovery against fixture binaries in a scoped dir
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { discoverExecTools } from './discover';

const FIX = path.join(__dirname, '__fixtures__');

describe('discoverExecTools', () => {
  it('builds an adapter per valid binary in the scoped dir', async () => {
    const tools = await discoverExecTools(FIX);
    const echo = tools.find((t) => t.name === 'echo');
    expect(echo).toBeDefined();
    expect(echo!.description).toContain('echoes');
  });

  it('skips (and logs) a binary whose schema is invalid — does not throw', async () => {
    const tools = await discoverExecTools(FIX);
    // bad-schema-tool produces no adapter; discovery is resilient to one bad tool.
    expect(tools.some((t) => t.name === 'bad')).toBe(false);
  });

  it('returns [] for a missing directory', async () => {
    expect(await discoverExecTools(path.join(FIX, 'nope'))).toEqual([]);
  });
});
```

- [ ] **Step 6: Run to verify failure** — `npm test -- exec/discover` → FAIL (no module).

- [ ] **Step 7: Implement `discover.ts`**

```typescript
// ABOUTME: Discover one-shot-exec tools from a SCOPED directory (never $PATH)
// ABOUTME: Runs `<bin> lace-tool-schema` per executable, builds an ExecToolAdapter

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '@lace/agent/utils/logger';
import { parseExecToolDescriptor } from './descriptor';
import { ExecToolAdapter } from './exec-tool-adapter';
import { runExecToolProcess } from './run-once';

/**
 * Scan `dir` for executable files, ask each for its schema, and build an adapter.
 * A directory is the unit of trust (the embedder controls what lands there). One
 * bad binary is skipped + logged, never fatal — unlike a plugin LOAD failure,
 * a malformed tool binary should not take down the agent.
 */
export async function discoverExecTools(dir: string): Promise<ExecToolAdapter[]> {
  let entries: string[];
  try { entries = await fs.readdir(dir); }
  catch { return []; }

  const adapters: ExecToolAdapter[] = [];
  for (const entry of entries) {
    const binPath = path.join(dir, entry);
    try {
      const stat = await fs.stat(binPath);
      if (!stat.isFile() || (stat.mode & 0o111) === 0) continue; // executable bit required
      const { stdout, exitCode } = await runExecToolProcess(binPath, ['lace-tool-schema'], {
        stdin: '', cwd: dir, timeoutMs: 5000,
      });
      if (exitCode !== 0) { logger.warn('exectool.schema.nonzero', { binPath, exitCode }); continue; }
      const descriptor = parseExecToolDescriptor(stdout);
      adapters.push(new ExecToolAdapter(binPath, descriptor));
    } catch (err) {
      logger.warn('exectool.discover.skipped', { binPath, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return adapters;
}
```

- [ ] **Step 8: Run** — `npm test -- exec/discover` → PASS after Phase 3 provides `runExecToolProcess` + `ExecToolAdapter`. (Discovery and the adapter co-depend; if running tests now, expect failures until Phase 3 — that's fine, commit Phase 2's descriptor first, then Phase 3, then re-run discover.)

- [ ] **Step 9: Commit the descriptor + fixtures**

```bash
git add packages/agent/src/tools/exec/descriptor.ts packages/agent/src/tools/exec/descriptor.test.ts \
        packages/agent/src/tools/exec/__fixtures__ packages/agent/src/tools/exec/discover.ts \
        packages/agent/src/tools/exec/discover.test.ts
git commit -m "feat(lace/tools): exec-tool schema descriptor + scoped-dir discovery"
```

---

## Phase 3 — The isolated child runner + `ExecToolAdapter`

The invocation contract (Terraform-`external` shape) plus the process hygiene the research flagged: minimal env (NEVER inherit the agent env — it holds API keys), per-call cwd, kill the **process group** on abort, a concurrency cap.

**Files:**
- Create: `packages/agent/src/tools/exec/run-once.ts`
- Create: `packages/agent/src/tools/exec/exec-tool-adapter.ts`
- Create fixtures: `__fixtures__/fail-tool.sh`, `__fixtures__/slow-tool.sh`
- Test: `packages/agent/src/tools/exec/run-once.test.ts`, `exec-tool-adapter.test.ts`

- [ ] **Step 1: Write the runner test**

Create `packages/agent/src/tools/exec/run-once.test.ts`:

```typescript
// ABOUTME: Tests the isolated one-shot child runner (env, cwd, abort, timeout)
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { runExecToolProcess } from './run-once';

const FIX = path.join(__dirname, '__fixtures__');

describe('runExecToolProcess', () => {
  it('captures stdout and exit code', async () => {
    const r = await runExecToolProcess(path.join(FIX, 'echo-tool.sh'), ['lace-tool-invoke'], {
      stdin: JSON.stringify({ input: { msg: 'hi' }, context: { sessionId: 's', persona: 'p' } }),
      cwd: FIX, timeoutMs: 5000,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('echo:hi');
  });

  it('does NOT leak the parent environment to the child', async () => {
    process.env.LACE_SECRET_PROBE = 'topsecret';
    const r = await runExecToolProcess(path.join(FIX, 'env-dump-tool.sh'), ['lace-tool-invoke'], {
      stdin: '{}', cwd: FIX, timeoutMs: 5000,
    });
    expect(r.stdout).not.toContain('topsecret');
    delete process.env.LACE_SECRET_PROBE;
  });

  it('kills the process group on abort and reports aborted', async () => {
    const ac = new AbortController();
    const p = runExecToolProcess(path.join(FIX, 'slow-tool.sh'), ['lace-tool-invoke'], {
      stdin: '{}', cwd: FIX, timeoutMs: 10000, signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 100);
    const r = await p;
    expect(r.aborted).toBe(true);
  });

  it('reports timeout', async () => {
    const r = await runExecToolProcess(path.join(FIX, 'slow-tool.sh'), ['lace-tool-invoke'], {
      stdin: '{}', cwd: FIX, timeoutMs: 100,
    });
    expect(r.timedOut).toBe(true);
  });
});
```

Add fixtures `__fixtures__/fail-tool.sh` (`exit 3` after printing to stderr), `__fixtures__/slow-tool.sh` (`sleep 30`), and `__fixtures__/env-dump-tool.sh`:

```bash
#!/usr/bin/env bash
if [ "${1:-}" = "lace-tool-schema" ]; then printf '%s' '{"name":"envdump","description":"x","inputSchema":{"type":"object","properties":{}}}'; exit 0; fi
env; exit 0
```

(All `chmod +x` and committed executable.)

- [ ] **Step 2: Run to verify failure** — `npm test -- exec/run-once` → FAIL (no module).

- [ ] **Step 3: Implement `run-once.ts`**

```typescript
// ABOUTME: Spawn a one-shot tool process in isolation; collect stdout/stderr/exit
// ABOUTME: minimal env, per-call cwd, process-group kill on abort/timeout

import { spawn } from 'node:child_process';

export interface RunExecOptions {
  stdin: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Extra env to expose to the child, on top of the minimal base. */
  env?: Record<string, string>;
}

export interface RunExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  aborted: boolean;
  timedOut: boolean;
}

/**
 * The minimal base env. We NEVER pass the agent's process.env (it carries provider
 * API keys and lace internals). A tool that needs a secret gets it via the
 * lace-owned credential socket (spec #6), not the environment.
 */
function minimalEnv(extra?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp',
  };
  for (const key of ['TZ', 'LANG', 'LC_ALL']) {
    const v = process.env[key];
    if (v) base[key] = v;
  }
  return { ...base, ...(extra ?? {}) };
}

export function runExecToolProcess(
  bin: string, args: string[], opts: RunExecOptions
): Promise<RunExecResult> {
  return new Promise<RunExecResult>((resolve) => {
    // detached:true → child is its own process-group leader, so we can kill the
    // whole group (the tool + any grandchildren it forked) with kill(-pid).
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: minimalEnv(opts.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '', stderr = '', aborted = false, timedOut = false, settled = false;
    const killGroup = (sig: NodeJS.Signals) => {
      if (child.pid) { try { process.kill(-child.pid, sig); } catch { /* already gone */ } }
    };

    const timer = setTimeout(() => { timedOut = true; killGroup('SIGKILL'); }, opts.timeoutMs);
    const onAbort = () => { aborted = true; killGroup('SIGKILL'); };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));

    function finish(code: number | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode: code, aborted, timedOut });
    }

    child.stdin.end(opts.stdin);
  });
}
```

- [ ] **Step 4: Write the adapter test**

Create `packages/agent/src/tools/exec/exec-tool-adapter.test.ts`:

```typescript
// ABOUTME: Tests ExecToolAdapter — schema, lace-built context block, result mapping
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { ExecToolAdapter } from './exec-tool-adapter';
import { parseExecToolDescriptor } from './descriptor';
import type { ToolContext } from '@lace/agent/tools/types';

const FIX = path.join(__dirname, '__fixtures__');
const echoDescriptor = parseExecToolDescriptor(
  '{"name":"echo","description":"echoes input.msg","inputSchema":{"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"]}}'
);

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return { signal: new AbortController().signal, activeSessionId: 'sess_x', persona: 'researcher', ...over };
}

describe('ExecToolAdapter', () => {
  it('exposes the descriptor name/description/schema', () => {
    const t = new ExecToolAdapter(path.join(FIX, 'echo-tool.sh'), echoDescriptor);
    expect(t.name).toBe('echo');
    expect(t.inputSchema.type).toBe('object');
  });

  it('passes a lace-built context block (persona from ctx, not args) and maps stdout', async () => {
    const t = new ExecToolAdapter(path.join(FIX, 'echo-tool.sh'), echoDescriptor);
    const r = await t.execute({ msg: 'hi', persona: 'attacker' }, ctx());
    expect(r.status).toBe('completed');
    expect(r.content[0].text).toContain('echo:hi');
    expect(r.content[0].text).toContain('persona:researcher'); // server-side identity won
  });

  it('maps a non-zero exit to a failed result with stderr', async () => {
    const failDescriptor = parseExecToolDescriptor('{"name":"fail","description":"x","inputSchema":{"type":"object","properties":{}}}');
    const t = new ExecToolAdapter(path.join(FIX, 'fail-tool.sh'), failDescriptor);
    const r = await t.execute({}, ctx());
    expect(r.status).toBe('failed');
  });

  it('maps abort to an aborted result', async () => {
    const slowDescriptor = parseExecToolDescriptor('{"name":"slow","description":"x","inputSchema":{"type":"object","properties":{}}}');
    const t = new ExecToolAdapter(path.join(FIX, 'slow-tool.sh'), slowDescriptor);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const r = await t.execute({}, ctx({ signal: ac.signal }));
    expect(r.status).toBe('aborted');
  });
});
```

- [ ] **Step 5: Run to verify failure** — `npm test -- exec/exec-tool-adapter` → FAIL (no module).

- [ ] **Step 6: Implement `exec-tool-adapter.ts`**

```typescript
// ABOUTME: ExecToolAdapter — a one-shot executable behind the Tool interface
// ABOUTME: Terraform-external invocation; lace builds the unforgeable context block

import { z, ZodType } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext, ToolInputSchema } from '@lace/agent/tools/types';
import { runExecToolProcess } from './run-once';
import type { ExecToolDescriptor } from './descriptor';

/** Bounded concurrency across ALL exec tools in this process. */
let inFlight = 0;
const MAX_INFLIGHT = 16;
const waiters: Array<() => void> = [];
async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_INFLIGHT) { inFlight++; return; }
  await new Promise<void>((r) => waiters.push(r));
  inFlight++;
}
function releaseSlot(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

const resultSchema = z.object({
  content: z.union([z.string(), z.record(z.unknown())]).optional(),
  metadata: z.record(z.unknown()).optional(),
}).passthrough();

export class ExecToolAdapter extends Tool {
  name: string;
  description: string;
  schema: ZodType;

  constructor(private binPath: string, private descriptor: ExecToolDescriptor) {
    super();
    this.name = descriptor.name;
    this.description = descriptor.description;
    // Args are validated permissively here; the binary is the source of truth for
    // its own schema. We accept the declared object shape and pass it through.
    this.schema = z.object({}).passthrough();
  }

  // Advertise the binary's own JSON Schema to the model (not the permissive zod above).
  get inputSchema(): ToolInputSchema {
    return this.descriptor.inputSchema as ToolInputSchema;
  }

  protected async executeValidated(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // The LLM controls ONLY `input`. lace builds `context` server-side — the
    // binary trusts identity because it came from lace, not the model. A `persona`
    // smuggled into args never reaches the context block.
    const payload = JSON.stringify({
      input: args,
      context: {
        sessionId: context.activeSessionId ?? '',
        persona: context.persona ?? '',
        // credentialSocket: <seam for spec #6 — gated on the capability manifest>
      },
    });

    await acquireSlot();
    try {
      const res = await runExecToolProcess(this.binPath, ['lace-tool-invoke'], {
        stdin: payload,
        cwd: context.workingDirectory ?? context.toolTempDir ?? process.cwd(),
        timeoutMs: context.timeoutMs ?? 120_000,
        signal: context.signal,
      });

      if (res.aborted) return this.createCancellationResult(res.stdout || undefined);
      if (res.timedOut) return this.createError(`exec tool "${this.name}" timed out`);
      if (res.exitCode !== 0) {
        return this.createError(`exec tool "${this.name}" failed (exit ${res.exitCode}): ${res.stderr.trim()}`);
      }

      const parsed = resultSchema.safeParse(safeJson(res.stdout));
      if (!parsed.success) {
        // Tolerate a plain-text tool that just prints to stdout.
        return this.createResult(res.stdout.trim());
      }
      const content = parsed.data.content ?? res.stdout.trim();
      return this.createResult(content, parsed.data.metadata);
    } finally {
      releaseSlot();
    }
  }
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}
```

> `context.timeoutMs` is not yet a `ToolContext` field. Either add `timeoutMs?: number` to `ToolContext` (additive, matches the marshalable-context floor from #1) or hardcode the `120_000` default and drop the `??`. Adding the field is preferred — it aligns `ToolContext` with `PluginCallContext`'s timeout. Make that a one-line additive edit in `tools/types.ts` if you take that path.

- [ ] **Step 7: Run the exec suite** — `npm test -- exec/` → all PASS (descriptor, discover, run-once, adapter).

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/tools/exec/run-once.ts packages/agent/src/tools/exec/exec-tool-adapter.ts \
        packages/agent/src/tools/exec/run-once.test.ts packages/agent/src/tools/exec/exec-tool-adapter.test.ts \
        packages/agent/src/tools/exec/__fixtures__
git commit -m "feat(lace/tools): ExecToolAdapter — one-shot-exec invocation, isolation, identity block"
```

---

## Phase 4 — Registration glue (draw the plugin registry into the executor)

Make plugin-registered tools (including discovered exec tools) appear in every session's executor and therefore in root + every subagent. The per-session `ToolExecutor` adds the process-global `api.tools` registry as a second source after its built-ins.

**Files:**
- Modify: `packages/agent/src/tools/executor.ts`
- Test: `packages/agent/src/tools/__tests__/executor-plugin-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// ABOUTME: registerAllAvailableTools also surfaces tools from the plugin registry
import { describe, it, expect, afterEach } from 'vitest';
import { ToolExecutor } from '@lace/agent/tools/executor';
import { registries } from '@lace/agent/plugins';
import { ExecToolAdapter } from '@lace/agent/tools/exec/exec-tool-adapter';
import { parseExecToolDescriptor } from '@lace/agent/tools/exec/descriptor';
import * as path from 'node:path';

const echo = new ExecToolAdapter(
  path.join(__dirname, '../exec/__fixtures__/echo-tool.sh'),
  parseExecToolDescriptor('{"name":"echo","description":"x","inputSchema":{"type":"object","properties":{}}}')
);

describe('executor draws plugin tools', () => {
  afterEach(() => { /* registries are process-global; keep names unique per test */ });

  it('surfaces a tool registered in api.tools', () => {
    registries.tools.register('echo', echo);
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    expect(ex.getTool('echo')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- executor-plugin-tools` → FAIL (`getTool('echo')` undefined).

- [ ] **Step 3: Wire the registry into `registerAllAvailableTools`**

In `packages/agent/src/tools/executor.ts`, after `this.registerTools(tools);` (end of `registerAllAvailableTools`, ~line 315), add:

```typescript
    // Also surface plugin-registered tools (in-process or exec). Because the
    // plugin registry is populated identically in every lace process (root +
    // subagents), these tools reach subagents for free. Built-ins win on a name
    // clash (registerTool would overwrite); register plugins first if you want
    // the opposite — here built-ins are authoritative, so only add plugin tools
    // whose names are not already taken.
    for (const name of pluginRegistries.tools.names()) {
      if (!this.tools.has(name)) {
        this.registerTool(name, pluginRegistries.tools.resolve(name));
      }
    }
```

Add the import: `import { registries as pluginRegistries } from '@lace/agent/plugins';`

> Decide name-clash policy explicitly: built-ins authoritative (shown) is the safe default for v1 (a plugin cannot shadow `bash`). If a reviewer wants plugins to override, flip the guard — but built-ins-win avoids a plugin silently replacing a core tool.

- [ ] **Step 4: Run to verify pass** — `npm test -- executor-plugin-tools` → PASS.

- [ ] **Step 5: Full suite**

```bash
npm run typecheck && npm run lint && npm test
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/tools/executor.ts packages/agent/src/tools/__tests__/executor-plugin-tools.test.ts
git commit -m "feat(lace/tools): per-session executor surfaces plugin-registered tools (built-ins win)"
```

---

## Phase 5 (note) — MCP identity (deferred, D2)

`MCPToolAdapter.executeValidated(args, _context)` ignores `_context`, and `mcpConnectionKey` (`mcp/server-manager.ts:34-46`) omits `sessionId`. Full MCP per-session keying is **D2**, out of scope here. Optional one-liner now: thread `context.persona`/`activeSessionId` into the MCP `callTool` arguments is **wrong** (it would let identity ride as a forgeable arg) — so do nothing here rather than a half-fix. Leave a `// TODO(D2): MCP session keying + identity` at `mcp/tool-adapter.ts:89` and move on.

---



---

# Part C — Compaction registry domain

Route all compaction through `api.compaction`. `track-based` becomes a registered built-in strategy; every call site resolves by name and passes through `validatePreserved`. This absorbs the pluggable-compaction worktree's Spec A Phases 1 & 4 (see the re-carve banner) and removes `LACE_COMPACTION_PLUGINS`.

**Code already mapped (contracts to match):**
- `compaction/index.ts` exports `compact` (from `track-compaction.ts`) + `CompactionContext`.
- `compaction/types.ts` — `CompactionContext { threadId; provider?; agent?; modelId? }`, `CompactionAgent`.
- `compaction/track-compaction.ts:451` — `compact(events: TypedDurableEvent[], ctx: CompactionContext): Promise<CompactResult>`; `CompactResult` (`:388-395`) = `{ compactionEvent: { type:'context_compacted'; data: ContextCompactedEventData } } | { noop: true }`.
- `storage/event-types.ts:121-132` — `ContextCompactedEventData { type; strategy; preserved: unknown[]; summary?; messagesCompacted? }`.
- Call sites: `core/conversation/runner.ts:1049-1094` (post-turn); `rpc/handlers/session-operations.ts:460-525` (`ent/session/compact`, with the hardcoded `strategy !== 'track-based' → throw` at ~:464); `conversation/slash-commands.ts:132-183` (`/compact`).
- The `validatePreserved` algorithm + the toolkit list are specified in the worktree's `2026-06-03-pluggable-compaction-design.md` §1 — Part C ports them; the algorithm is restated below so this doc is self-contained.

## Phase C1 — The strategy seam, registry registration, and `validatePreserved`

**Files:**
- Modify: `packages/agent/src/compaction/types.ts` (add `CompactionStrategy`, move `CompactResult` here)
- Modify: `packages/agent/src/compaction/track-compaction.ts` (import `CompactResult` from types; export the toolkit functions it uses)
- Create: `packages/agent/src/compaction/strategy.ts` (`validatePreserved`, `resolveCompactionStrategy`, `registerBuiltinCompaction`)
- Create: `packages/agent/src/compaction/track-strategy.ts` (`track-based` `CompactionStrategy` wrapper)
- Test: `packages/agent/src/compaction/strategy.test.ts`

- [ ] **Step 1: Move `CompactResult` to `types.ts` and add the strategy interface**

In `compaction/types.ts`, add (and move `CompactResult` from `track-compaction.ts:388-395` here to avoid a cycle):

```typescript
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';
import type { ContextCompactedEventData } from '@lace/agent/storage/event-types';

export type CompactResult =
  | { compactionEvent: { type: 'context_compacted'; data: ContextCompactedEventData } }
  | { noop: true };

/** A named compaction strategy. Built-ins and plugins both register one. */
export interface CompactionStrategy {
  name: string;
  compact(events: TypedDurableEvent[], ctx: CompactionContext): Promise<CompactResult>;
}
```

In `track-compaction.ts`, delete its local `CompactResult` definition and `import type { CompactResult } from './types';`.

- [ ] **Step 2: Write the `validatePreserved` + registry tests**

Create `compaction/strategy.test.ts`:

```typescript
// ABOUTME: Tests the compaction strategy registry resolve+validate seam
import { describe, it, expect, beforeEach } from 'vitest';
import { validatePreserved, resolveCompactionStrategy, registerBuiltinCompaction } from './strategy';
import { registries } from '@lace/agent/plugins';
import type { CompactResult } from './types';

function compacted(preserved: unknown[]): CompactResult {
  return { compactionEvent: { type: 'context_compacted',
    data: { type: 'context_compacted', strategy: 'x', preserved } } };
}

describe('validatePreserved', () => {
  it('passes noop through unchanged', () => {
    expect(validatePreserved({ noop: true })).toEqual({ noop: true });
  });
  it('turns empty/whitespace preserved into noop', () => {
    expect('noop' in validatePreserved(compacted([]))).toBe(true);
  });
  it('merges consecutive same-role entries', () => {
    const r = validatePreserved(compacted([
      { role: 'user', content: 'a' }, { role: 'user', content: 'b' },
    ]));
    expect('noop' in r).toBe(false);
    if (!('noop' in r)) {
      expect((r.compactionEvent.data.preserved as unknown[]).length).toBe(1);
    }
  });
  it('drops/merges a leading assistant entry so the first is user-role', () => {
    const r = validatePreserved(compacted([
      { role: 'assistant', content: 'x' }, { role: 'user', content: 'y' },
    ]));
    if (!('noop' in r)) {
      const first = (r.compactionEvent.data.preserved as Array<{ role: string }>)[0];
      expect(first.role).toBe('user');
    }
  });
});

describe('resolveCompactionStrategy', () => {
  beforeEach(() => registerBuiltinCompaction());
  it('resolves the built-in track-based strategy', () => {
    expect(resolveCompactionStrategy('track-based').name).toBe('track-based');
  });
  it('throws on an unknown strategy name (fail loud)', () => {
    expect(() => resolveCompactionStrategy('nope')).toThrow();
  });
  it('track-based is registered into api.compaction', () => {
    expect(registries.compaction.has('track-based')).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npm test -- compaction/strategy` → FAIL (no module).

- [ ] **Step 4: Implement `track-strategy.ts`**

```typescript
// ABOUTME: The built-in 'track-based' compaction strategy (wraps compact())
import type { CompactionStrategy } from './types';
import { compact } from './track-compaction';

export const trackBasedStrategy: CompactionStrategy = {
  name: 'track-based',
  compact: (events, ctx) => compact(events, ctx),
};
```

- [ ] **Step 5: Implement `strategy.ts`**

`validatePreserved` ports the worktree §1 algorithm verbatim (restated): (a) empty/whitespace-only `preserved[]` → `{noop:true}`; (b) walk and **merge** consecutive same-role entries (concat content, union tool calls/results) — the same merge primitive `buildPreservedWithPrefix` uses, generalized to all adjacencies; (c) merge-forward/drop a leading assistant entry so the first entry is user-role. Runs on **every** strategy's output, including track-based.

```typescript
// ABOUTME: Compaction registry seam — resolve a strategy by name + enforce replay-legality
// ABOUTME: validatePreserved repairs same-role adjacency that message-builder replay does NOT

import { registries } from '@lace/agent/plugins';
import type { CompactionStrategy, CompactResult } from './types';
import { trackBasedStrategy } from './track-strategy';
import { mergePreservedAdjacent } from './toolkit'; // promoted from buildPreservedWithPrefix internals

let builtinsRegistered = false;
/** Register built-in strategies into api.compaction. Idempotent (boot + tests). */
export function registerBuiltinCompaction(): void {
  if (builtinsRegistered) return;
  registries.compaction.register('track-based', trackBasedStrategy);
  builtinsRegistered = true;
}

/** Resolve a strategy by name (lazy; throws if unknown — fail loud). */
export function resolveCompactionStrategy(name: string): CompactionStrategy {
  return registries.compaction.resolve(name);
}

/**
 * Enforce replay-legality on a strategy's output. message-builder replay sets
 * messages.length=0, pushes preserved[] verbatim, then only drops orphan tool
 * blocks — it does NOT repair consecutive same-role messages (which break
 * provider cache reach + turn structure). So every strategy's output passes here.
 */
export function validatePreserved(result: CompactResult): CompactResult {
  if ('noop' in result) return result;
  const preserved = result.compactionEvent.data.preserved as Array<Record<string, unknown>>;
  const repaired = mergePreservedAdjacent(preserved); // empty→[], merge same-role, fix leading assistant
  if (repaired.length === 0) return { noop: true }; // empty array would zero the conversation
  return {
    compactionEvent: {
      type: 'context_compacted',
      data: { ...result.compactionEvent.data, preserved: repaired },
    },
  };
}
```

- [ ] **Step 6: Promote the toolkit + add `mergePreservedAdjacent`**

Create `compaction/toolkit.ts` exporting the existing-but-private compaction stages so strategies (and `validatePreserved`) compose them. Per the worktree §1 list: `splitAtTailBoundary`, `demuxByTrack` (`buildTurnToTrackMap` + `groupEarlierEventsByTrack`), `buildPreservedTail`, **`buildPreservedWithPrefix`** (currently private in `track-compaction.ts` — export it), `renderCompactionPrefix`, the Slack transcript renderer. Add `mergePreservedAdjacent(entries)` — the generalized same-role merge (the primitive `buildPreservedWithPrefix` uses for the prefix, applied to all adjacencies + the leading-assistant fix). Refactor `track-compaction.ts`'s `compact()` to consume the toolkit (no behavior change — guarded by the Phase C3 golden test).

> This is the worktree's Spec A Phase 1 toolkit work. The exact internal functions live in `track-compaction.ts` (450+ lines); promote them to `toolkit.ts` exports unchanged. `mergePreservedAdjacent` generalizes the merge `buildPreservedWithPrefix` already does. Do not change byte output — C3 enforces it.

- [ ] **Step 7: Run to verify pass** — `npm test -- compaction/strategy` → PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/compaction/types.ts packages/agent/src/compaction/track-compaction.ts \
        packages/agent/src/compaction/strategy.ts packages/agent/src/compaction/track-strategy.ts \
        packages/agent/src/compaction/toolkit.ts packages/agent/src/compaction/strategy.test.ts
git commit -m "feat(lace/compaction): strategy seam + registry + validatePreserved (track-based registered)"
```

## Phase C2 — Route all three call sites through the registry; drop the hardcoded gate

Each site currently calls `compact(events, ctx)` directly. Replace with resolve-by-name → `validatePreserved`. Strategy name comes from the session's persona (additive `compaction.strategy` field, default `track-based`).

**Files:**
- Modify: `packages/agent/src/config/persona-registry.ts` (additive `compaction` field)
- Create: `packages/agent/src/compaction/select.ts` (`compactionStrategyNameForSession`)
- Modify: `core/conversation/runner.ts`, `rpc/handlers/session-operations.ts`, `conversation/slash-commands.ts`
- Modify: `packages/agent/src/main.ts` (call `registerBuiltinCompaction()` at boot)

- [ ] **Step 1: Add the additive persona `compaction` field**

In `config/persona-registry.ts` `personaConfigSchema` (it is `.strict()`, so the key must be declared), add:

```typescript
    compaction: z.object({ strategy: z.string().optional() }).strict().optional(),
```

> Additive only (does not narrow). Breakpoints belong to the worktree; only `strategy` is read here.

- [ ] **Step 2: Add the session→strategy-name helper**

Create `compaction/select.ts`:

```typescript
// ABOUTME: Resolve the compaction strategy NAME for a session from its persona
import { personaForSessionDir } from '@lace/agent/storage/event-log';
import { personaRegistry } from '@lace/agent/config/persona-registry';

export function compactionStrategyNameForSession(sessionDir: string): string {
  try {
    const persona = personaForSessionDir(sessionDir);
    if (persona) {
      const { config } = personaRegistry.parsePersona(persona);
      return config.compaction?.strategy ?? 'track-based';
    }
  } catch { /* fall through to default */ }
  return 'track-based';
}
```

- [ ] **Step 3: Rewrite the runner post-turn site** (`runner.ts:1049-1094`)

Replace the `const result = await compact(...)` call with:

```typescript
        const strategy = resolveCompactionStrategy(compactionStrategyNameForSession(sessionDir));
        const raw = await strategy.compact(allEvents as unknown as TypedDurableEvent[], {
          threadId: sessionId, provider, modelId: modelId ?? undefined,
        });
        const result = validatePreserved(raw);
```

Update imports: replace `import { compact } from '@lace/agent/compaction/track-compaction';` with
`import { resolveCompactionStrategy, validatePreserved } from '@lace/agent/compaction/strategy';`
`import { compactionStrategyNameForSession } from '@lace/agent/compaction/select';`
The `if (!('noop' in result))` write block stays unchanged.

- [ ] **Step 4: Rewrite `ent/session/compact`** (`session-operations.ts:460-525`)

Delete the hardcoded gate (~:464):

```typescript
    const parsed = params as { strategy?: string } | undefined;
    if (parsed?.strategy && parsed.strategy !== 'track-based') {
      throwInvalidParams('strategy must be track-based (legacy strategies removed)');
    }
```

Replace the `const result = await compact(events, {...})` with the resolve+validate pattern, taking the strategy name from `parsed?.strategy ?? compactionStrategyNameForSession(sessionDir)`:

```typescript
      const name = parsed?.strategy ?? compactionStrategyNameForSession(sessionDir);
      const raw = await resolveCompactionStrategy(name).compact(events, {
        threadId: state.activeSession!.meta.sessionId, provider, modelId: effectiveConfig.modelId,
      });
      const result = validatePreserved(raw);
```

Add the same imports. The `'noop' in result` branch and the token-delta response stay unchanged. (An unknown explicit `strategy` now throws via `resolveCompactionStrategy` — a clearer, registry-driven error than the old hardcoded string check.)

- [ ] **Step 5: Rewrite `/compact`** (`slash-commands.ts:132-183`)

Replace `const result = await compact(events, {...}).finally(...)` with:

```typescript
    const name = compactionStrategyNameForSession(sessionDir);
    const raw = await resolveCompactionStrategy(name)
      .compact(events, { threadId: sessionId, provider, modelId: effectiveConfig.modelId })
      .finally(() => provider.cleanup());
    const result = validatePreserved(raw);
```

Add the same imports.

- [ ] **Step 6: Register built-ins at boot**

In `main.ts`'s `boot()` (Part A Phase 5), before/after `loadPlugins` register built-in strategies so `track-based` exists even with no plugins:

```typescript
  registerBuiltinCompaction();          // built-ins into api.compaction
  await loadPlugins(process.env.LACE_PLUGINS);
```

Add `import { registerBuiltinCompaction } from './compaction/strategy';`. (Built-ins register before plugins so a plugin dup of `track-based` is a loud fatal.)

- [ ] **Step 7: Verify** — `npm run typecheck && npm test -- "compaction|runner|session-operations|slash"` → green.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/config/persona-registry.ts packages/agent/src/compaction/select.ts \
        packages/agent/src/core/conversation/runner.ts \
        packages/agent/src/rpc/handlers/session-operations.ts \
        packages/agent/src/conversation/slash-commands.ts packages/agent/src/main.ts
git commit -m "feat(lace/compaction): route all 3 call sites through the registry; drop hardcoded gate"
```

## Phase C3 — Golden test (byte-identical) + remove `LACE_COMPACTION_PLUGINS`

- [ ] **Step 1: Golden test**

Add a test that runs a representative event fixture through the registry path (`resolveCompactionStrategy('track-based').compact` + `validatePreserved`) and asserts the `context_compacted` `data` is byte-identical to the pre-refactor `compact()` output (capture a golden from `git show` of the old behavior, or snapshot the current `compact()` before refactor and compare). This guards the toolkit extraction. Use Ada's existing compaction fixture if present (`grep -rl context_compacted packages/agent/src/compaction/__tests__`).

```typescript
// ABOUTME: track-based via the registry must produce byte-identical output to compact()
import { describe, it, expect } from 'vitest';
import { resolveCompactionStrategy, validatePreserved, registerBuiltinCompaction } from '../strategy';
import { fixtureEvents, fixtureCtx } from './_compaction-fixture'; // reuse existing fixture

describe('track-based golden', () => {
  it('registry path matches the legacy compact() output byte-for-byte', async () => {
    registerBuiltinCompaction();
    const raw = await resolveCompactionStrategy('track-based').compact(fixtureEvents, fixtureCtx);
    const viaRegistry = validatePreserved(raw);
    expect(JSON.stringify(viaRegistry)).toMatchSnapshot();
  });
});
```

> If no shared fixture exists, build a minimal deterministic event list (a few user/assistant/tool events) — the point is byte-stability across the refactor, snapshotted.

- [ ] **Step 2: Remove `LACE_COMPACTION_PLUGINS`**

Grep the tree: `grep -rn "LACE_COMPACTION_PLUGINS" packages/`. If the worktree's loader has not merged into this branch, there is nothing to remove here — record that and ensure the worktree's merge drops it (the re-carve banner). If any reference exists on this branch, delete it; the one loader is `LACE_PLUGINS`.

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck && npm test -- compaction
git add packages/agent/src/compaction
git commit -m "test(lace/compaction): golden byte-identical track-based via registry; one loader only"
```


---

# Part D — Personas registry domain

Make `api.personas` a second source for persona resolution, alongside the disk-backed `PersonaRegistry`. A plugin can contribute a persona; disk personas still win.

**Code already mapped:**
- `config/persona-registry.ts` — `PersonaRegistry` with `parsePersona(name): ParsedPersona`, `hasPersona(name)`, `listAvailablePersonas(): PersonaInfo[]`, `validatePersona(name)`; disk sources = `bundledPersonasCache` (built-in) + `userPersonasCache` (disk paths, user-overrides-bundled). `ParsedPersona = { config: PersonaConfig; body: string }`. Singleton `personaRegistry`; per-initialize construction in `rpc/handlers/initialize.ts:120`.
- Selection at session start: `rpc/handlers/session.ts:418` calls `state.personaRegistry.parsePersona(requestedPersona)`.

**Precedence (decided):** user-disk > plugin (`api.personas`) > bundled. User overrides everything; a plugin overrides only bundled built-ins.

## Phase D1 — `api.personas` as a resolution source

**Files:**
- Modify: `packages/agent/src/plugins/api.ts` (`PersonaDef = ParsedPersona`)
- Modify: `packages/agent/src/config/persona-registry.ts` (consult `api.personas`)
- Test: `packages/agent/src/config/__tests__/persona-registry-plugins.test.ts`

- [ ] **Step 1: Refine `PersonaDef` to a full parsed persona**

In `plugins/api.ts`, replace the `PersonaConfig` alias with the parsed shape (a persona needs its template body, not just frontmatter):

```typescript
import type { ParsedPersona } from '@lace/agent/config/persona-registry';
/** A plugin-contributed persona = the same shape disk personas parse to. */
export type PersonaDef = ParsedPersona;
```

Confirm `ParsedPersona` is exported from `config/persona-registry.ts`; if it is only an internal interface, add `export` to it (additive).

- [ ] **Step 2: Write the failing test**

```typescript
// ABOUTME: PersonaRegistry resolves plugin-contributed personas (api.personas), disk wins
import { describe, it, expect, afterEach } from 'vitest';
import { PersonaRegistry } from '@lace/agent/config/persona-registry';
import { registries } from '@lace/agent/plugins';

const reg = () => new PersonaRegistry({ bundledPersonasPath: '/nonexistent', userPersonasPaths: [] });

describe('PersonaRegistry + api.personas', () => {
  afterEach(() => { /* registries are process-global; use unique names per test */ });

  it('resolves a persona registered via api.personas', () => {
    registries.personas.register('plugin-researcher', {
      config: { runtime: { type: 'root' } } as never, body: 'You are a researcher.',
    });
    const r = reg();
    expect(r.hasPersona('plugin-researcher')).toBe(true);
    expect(r.parsePersona('plugin-researcher').body).toContain('researcher');
  });

  it('lists plugin personas alongside disk personas', () => {
    registries.personas.register('plugin-listed', { config: {} as never, body: 'x' });
    expect(reg().listAvailablePersonas().some((p) => p.name === 'plugin-listed')).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npm test -- persona-registry-plugins` → FAIL (`hasPersona` false; `parsePersona` throws not-found).

- [ ] **Step 4: Consult `api.personas` in the registry**

In `config/persona-registry.ts`, import the registries and weave them into the three resolution methods with disk-wins precedence:

```typescript
import { registries as pluginRegistries } from '@lace/agent/plugins';
```

`hasPersona(name)` — add the plugin source:

```typescript
  hasPersona(name: string): boolean {
    this.loadUserPersonas();
    return (
      this.userPersonasCache.has(name) ||
      pluginRegistries.personas.has(name) ||
      this.bundledPersonasCache.has(name)
    );
  }
```

`parsePersona(name)` — short-circuit to the plugin persona when disk has no user override:

```typescript
  parsePersona(name: string): ParsedPersona {
    this.loadUserPersonas();
    // user-disk wins; then plugin; then bundled (existing path below).
    if (!this.userPersonasCache.has(name) && pluginRegistries.personas.has(name)) {
      return pluginRegistries.personas.resolve(name);
    }
    this.validatePersona(name);
    // ... existing disk read + frontmatter parse unchanged ...
  }
```

`listAvailablePersonas()` — include plugin personas (after user, before bundled), respecting the `seen` set so a user override hides the plugin one:

```typescript
    // after the user-personas loop, before the bundled loop:
    for (const name of pluginRegistries.personas.names()) {
      if (!seen.has(name)) {
        personas.push({ name, isUserDefined: false, path: `plugin:${name}` });
        seen.add(name);
      }
    }
```

- [ ] **Step 5: Run to verify pass** — `npm test -- persona-registry-plugins` → PASS.

- [ ] **Step 6: Verify the whole persona suite + commit**

```bash
npm run typecheck && npm test -- persona
git add packages/agent/src/plugins/api.ts packages/agent/src/config/persona-registry.ts \
        packages/agent/src/config/__tests__/persona-registry-plugins.test.ts
git commit -m "feat(lace/personas): resolve plugin-contributed personas via api.personas (disk wins)"
```

> Persona-schema NARROWING (stripping docker/egress/cap fields) is **not** here — it is coupled to `delegate.ts` reading those fields and lands with the plane (#3). Part D only adds the registry as a source.


---

# Part E — Runtimes registry domain

Make the container runtime selectable by name from `api.runtimes`. Built-in runtimes register at boot; `createDefaultContainerManager` resolves the selected one from the registry. The embedder's runtime (the plane, #3) becomes a registered `runtimes` plugin chosen via `LACE_CONTAINER_RUNTIME`.

**Code already mapped:**
- `containers/manager-factory.ts` — `createDefaultContainerManager(platform, runtimeSelection)`: parses `LACE_CONTAINER_RUNTIME` ∈ {auto,apple,docker}; `makeDockerRuntime()` returns `ShimContainerRuntime(LACE_DOCKER_BIN)` if set else `DockerContainerRuntime()`; `auto` → linux=docker, darwin=apple, else null; wraps in `ContainerManager`.
- `server.ts:97-122` — `createAgentServerState()` calls `createDefaultContainerManager()` and builds `perInvocationReaper: new PerInvocationReaper(containerManager)` synchronously at module load (via `main.ts:17`).
- `containers/startup-reaper.ts` — `createContainerManagerForPlatform()` = `createDefaultContainerManager()`; `main.ts:76` runs `runStartupReaper(createContainerManagerForPlatform())`.
- `containers/types.ts:123-164` — the `ContainerRuntime` interface.

**Boot-ordering problem (the lifecycle change the kit flagged):** the runtime is selected synchronously at `main.ts:17` (`createAgentServerState`), but a registry-resolved runtime must be chosen **after** built-ins + plugins register (inside `boot()`). So runtime/manager construction moves out of `createAgentServerState` into `boot()`, after `loadPlugins`.

## Phase E1 — Register built-in runtimes; resolve the factory from the registry

**Files:**
- Modify: `packages/agent/src/containers/manager-factory.ts`
- Test: `packages/agent/src/containers/__tests__/manager-factory-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// ABOUTME: createDefaultContainerManager resolves the runtime from api.runtimes
import { describe, it, expect } from 'vitest';
import { registerBuiltinRuntimes, createDefaultContainerManager } from '@lace/agent/containers/manager-factory';
import { registries } from '@lace/agent/plugins';

describe('runtime registry', () => {
  it('registers docker + apple built-ins', () => {
    registerBuiltinRuntimes();
    expect(registries.runtimes.has('docker')).toBe(true);
    expect(registries.runtimes.has('apple')).toBe(true);
  });

  it('auto selects the platform default from the registry', () => {
    registerBuiltinRuntimes();
    expect(createDefaultContainerManager('linux', 'auto')).not.toBeNull();   // docker
    expect(createDefaultContainerManager('linux', 'docker')).not.toBeNull();
  });

  it('resolves an embedder-registered runtime by name', () => {
    registerBuiltinRuntimes();
    const fake = { create: () => 'x' } as never;
    registries.runtimes.register('plane', fake);
    expect(createDefaultContainerManager('linux', 'plane')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- manager-factory-registry` → FAIL (`registerBuiltinRuntimes` missing; selection enum rejects `plane`).

- [ ] **Step 3: Add `registerBuiltinRuntimes` + resolve-by-name**

In `containers/manager-factory.ts`:

```typescript
import { registries } from '@lace/agent/plugins';

let builtinsRegistered = false;
/** Register the platform's built-in container runtimes into api.runtimes. Idempotent. */
export function registerBuiltinRuntimes(): void {
  if (builtinsRegistered) return;
  // 'docker' = the shim (LACE_DOCKER_BIN) or direct docker; 'apple' = macOS container CLI.
  registries.runtimes.register('docker', makeDockerRuntime());
  registries.runtimes.register('apple', new AppleContainerRuntime());
  builtinsRegistered = true;
}
```

Replace the selection logic so it resolves a **name** from the registry (auto → platform default), instead of `new`-ing impls inline:

```typescript
export function createDefaultContainerManager(
  platform: NodeJS.Platform = process.platform,
  runtimeSelection: string | undefined = process.env[CONTAINER_RUNTIME_ENV]
): ContainerManager | null {
  const sel = (runtimeSelection?.trim().toLowerCase() || 'auto');
  let name: string | null;
  if (sel === 'auto') {
    name = platform === 'linux' ? 'docker' : platform === 'darwin' ? 'apple' : null;
  } else {
    name = sel; // any registered runtime name (docker, apple, or an embedder's e.g. 'plane')
  }
  if (name === null) {
    logger.debug('containers.manager_factory.unsupported_platform', { platform });
    return null;
  }
  if (!registries.runtimes.has(name)) {
    throw new Error(`${CONTAINER_RUNTIME_ENV}="${name}" but no runtime registered under that name`);
  }
  return new ContainerManager(registries.runtimes.resolve(name));
}
```

> The old `parseContainerRuntimeSelection` (which hard-rejected anything but auto/apple/docker) is removed — the registry is now the source of valid names, so an embedder runtime like `plane` is accepted once registered. `makeDockerRuntime()` keeps honoring `LACE_DOCKER_BIN` (shim vs direct). Keep the existing imports of `DockerContainerRuntime`/`ShimContainerRuntime`/`AppleContainerRuntime` (they back the built-ins) until #3 removes the docker impls.

- [ ] **Step 4: Run to verify pass** — `npm test -- manager-factory-registry` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/containers/manager-factory.ts \
        packages/agent/src/containers/__tests__/manager-factory-registry.test.ts
git commit -m "feat(lace/runtimes): register built-in runtimes; resolve container runtime by name"
```

## Phase E2 — Boot ordering: construct the manager after the registry is populated

**Files:**
- Modify: `packages/agent/src/server.ts` (`createAgentServerState` no longer builds the manager)
- Modify: `packages/agent/src/main.ts` (build manager in `boot()` after registry population)
- Test: `packages/agent/src/__tests__/boot-runtime-order.test.ts` (or fold into an existing boot test)

- [ ] **Step 1: Defer manager construction in `createAgentServerState`**

In `server.ts:97-122`, set `containerManager: null` and a reaper that tolerates late binding. The cleanest minimal change: leave `containerManager: null` and `perInvocationReaper: new PerInvocationReaper(null)` (the reaper already accepts null), then have `boot()` assign the real ones:

```typescript
  // containerManager is resolved from api.runtimes in boot(), after built-ins +
  // plugins register. Null here; boot() sets it before the peer accepts frames.
  containerManager: null,
  perInvocationReaper: new PerInvocationReaper(null),
```

Add a setter or assign directly in boot (state is mutable). If `PerInvocationReaper` cannot be rebound to a manager after construction, add a `setContainerManager(m)` method to it (small additive change) and call it in boot.

- [ ] **Step 2: Build the manager in `boot()`**

In `main.ts` `boot()` (Part A Phase 5), after `registerBuiltinRuntimes()` + `loadPlugins(...)`:

```typescript
  registerBuiltinRuntimes();
  registerBuiltinCompaction();
  await loadPlugins(process.env.LACE_PLUGINS);

  // Now the runtimes registry is populated (built-ins + plugins) — resolve the manager.
  const containerManager = createDefaultContainerManager();
  state.containerManager = containerManager;
  state.perInvocationReaper.setContainerManager(containerManager); // or rebuild the reaper
  void runStartupReaper(containerManager);                          // moved from module top
```

Remove the module-top `void runStartupReaper(createContainerManagerForPlatform());` (current `main.ts:76`) and the now-unused `createContainerManagerForPlatform` import if nothing else uses it (verify; `startup-reaper.ts` may still export it for tests).

- [ ] **Step 3: Verify boot still works (no plugins)**

```bash
npm run typecheck
npm test -- "server|boot|containers|reaper"
```
Expected: green. The container manager is now built one tick later (after the empty loader) but before the peer wires — no observable change with `LACE_PLUGINS` unset. Fix any test that constructed state expecting a non-null `containerManager` straight out of `createAgentServerState` (it is now set in `boot()`); such tests should call `registerBuiltinRuntimes()` + `createDefaultContainerManager()` themselves, or assert via boot.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/server.ts packages/agent/src/main.ts \
        packages/agent/src/jobs/per-invocation-reaper.ts \
        packages/agent/src/__tests__/boot-runtime-order.test.ts
git commit -m "refactor(lace/runtimes): build container manager in boot() after registry population"
```

> The plane (the sen runtime impl) is **not** built here. #3 registers it as a `runtimes` plugin (`api.runtimes.register('plane', planeClient)`) and the box sets `LACE_CONTAINER_RUNTIME=plane`; this Part makes that selection resolve. #3 also deletes the docker impls + narrows the `ContainerRuntime` interface.


---

# Unified self-review

**Whole-system coverage (the four registries, each wired to a real consumption site):**
- **tools** — Part B: three adapters; built-ins + plugins drawn into the per-session executor; persona keystone.
- **compaction** — Part C: `track-based` registered; all three call sites resolve via `api.compaction` + `validatePreserved`.
- **runtimes** — Part E: built-ins registered; `createDefaultContainerManager` resolves by name from `api.runtimes`.
- **personas** — Part D: `PersonaRegistry` consults `api.personas` (disk wins).

**Mechanism coverage (Part A):** one `LACE_PLUGINS` loader; ordered dynamic-import in every process; `register(api)` + fatal-on-load; generic `Registry<T>` (dup→fatal, lazy-resolve); `assertVersion`; marshalable `PluginCallContext`; capability manifest + default-deny credential gate; boot integration; subagent reach via env (proven by a real child-process test); hook-bus seam documented-not-built.

**Boot sequence (final, after all Parts):** in `main.ts` `boot()` — `registerBuiltinRuntimes()` → `registerBuiltinCompaction()` → `await loadPlugins(LACE_PLUGINS)` → resolve the container manager from `api.runtimes` → run startup reaper → attach stdin consumer + wire the JSON-RPC peer. Built-ins register before plugins so a plugin dup of a built-in name is a loud fatal. Frames buffer in the stdin tee throughout (nothing consumes it until after the peer wires).

**Cross-Part type consistency:** `PluginApi`/`Registry<T>` method names (`register`/`resolve`/`has`/`names`) identical across all Parts; `PersonaDef = ParsedPersona` (refined in Part D); `CompactionStrategy`/`CompactResult` shared from `compaction/types.ts`; `ContainerRuntime` unchanged here (narrowed in #3).

**Verify-then-do flags for implementers:** (1) exact exported type names — `ParsedPersona`, `PersonaConfig` in `config/persona-registry.ts`; export if internal. (2) `RunnerConfig.personaName` presence (Part B). (3) `personaForSessionDir` export path. (4) The repo's TS-in-child-process mechanism for the Part A subagent-reach probe + Part B exec fixtures committed executable. (5) `PerInvocationReaper` late-binding (`setContainerManager`) for Part E2. (6) Whether `LACE_COMPACTION_PLUGINS` exists on this branch (Part C3) — it lives in the worktree, not necessarily here.

**Collision guards:** Part A is self-contained in `plugins/`. Part B in `tools/exec/` + additive `ToolContext` fields + executor draw. Part C re-carves the compaction worktree (banner). Part D/E touch persona/runtime resolution but **not** the narrowing/plane (deferred to #3). No Part touches egress/workspace/credentials.

# Open items carried forward (downstream specs)

- **The plane** (sen runtime impl) registered as a `runtimes` plugin; docker-impl deletion; `ContainerRuntime` narrowing — `container-runtime+plane` (#3).
- **Persona/runtime schema narrowing** (strip docker/egress/cap fields, coupled to `delegate.ts`) — #3.
- **Credential capability gate enforcement** + the credential socket protocol (the Part B `credentialSocket` seam) — `credentials` (#6).
- **MCP per-session keying + identity** — D2.
- **Compaction breakpoints + `compact_session` tool + the regime** — the pluggable-compaction worktree (Phases 2–3 + Spec B).

# Execution handoff

Plan complete. Execute Part by Part (A→E); each Part is independently mergeable with default behavior unchanged. Recommended: **subagent-driven-development** — a fresh subagent per Part (or per Phase within a Part), with a review between. Start with **Part A** (the mechanism); nothing else compiles without it.
