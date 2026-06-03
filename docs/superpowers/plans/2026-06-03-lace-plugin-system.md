# Lace Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> **Mandatory Part order: A → (B, C, D in any order) → E.** A is a hard prerequisite (nothing compiles without `plugins/`); E is last (it defers container-manager construction into boot). B/C/D are independent once A lands. Each phase ends with typecheck + scoped tests + commit. Default behavior is unchanged until a plugin is configured — except Part C edits the live compaction call sites and Part E edits boot wiring (review those with care).

**Goal:** Build lace's plugin system — ONE `LACE_PLUGINS` loader feeding four typed registries (`tools`, `compaction`, `runtimes`, `personas`), each wired to its real consumption site so the mechanism is proven end-to-end. Built-ins register into the same registries at boot, alongside plugins; duplicate names are fatal uniformly.

**Architecture:** ESLint one-object/many-catalogs (one `api` with typed per-plugin registrars), not a hook-bus. The loader runs in every lace process (`main.ts`); subagents inherit `LACE_PLUGINS` via env (`spawnSubagent` spreads `...process.env`) and run the same entrypoint, so registries are identical in root + subagents with no RPC. The loader is **not** a security boundary: a plugin is trusted lace code loaded only from the boot-time `LACE_PLUGINS` allowlist (never from session/protocol/client input). The only security-bearing pieces here are the **persona keystone** (identity resolved server-side, never a tool arg) and the **owner-keyed capability manifest** (default-deny credential path; full enforcement in #6).

**Tech Stack:** TypeScript (strict, no `any`), vitest, Node `child_process`, zod, `tsx` (added in Part A for the subagent-reach test). Package: `packages/agent`. Branch: base off `pri2012-shim-lace`, after the cleanup PR-A′ lands.

## Design of record
- `sen-core-v2/docs/superpowers/specs/2026-06-03-lace-embedder-architecture.md` Part 1 + Part 7.
- `lace-worktrees/pluggable-compaction/.../2026-06-03-pluggable-compaction-design.md` §1 (compaction seam, `validatePreserved`, toolkit) + §4 (the 3 call sites). **Note:** that worktree is the spawn-broker branch and contains *specs only* — no compaction registry code exists. Part C is greenfield; zero collision risk. The worktree's later breakpoints / `compact_session` tool / regime build on this plan's `api.compaction`.

## Canonical contracts (what the parts implement)

```ts
// A plugin module exports register(), and optionally meta + manifest.
export interface PluginModule {
  register(api: PluginApi): void;
  meta?: PluginMeta;                 // {name, namespace, version}; loader falls back to the specifier
  manifest?: CapabilityManifest;     // {capabilities: Capability[]}; default-deny if absent
}

// Inside register(api), a plugin registers into per-plugin registrar views that
// stamp the plugin as the OWNER of each entry (so the capability gate can ask
// "who owns this tool?").
export interface PluginApi {
  readonly meta: PluginMeta;
  readonly kernelVersion: string;
  assertVersion(major: number): void;
  tools:      PluginRegistrar<Tool>;
  compaction: PluginRegistrar<CompactionStrategy>;
  runtimes:   PluginRegistrar<ContainerRuntime>;
  personas:   PluginRegistrar<PersonaDef>;        // PersonaDef = ParsedPersona ({config, body})
}
export interface PluginRegistrar<T> { register(name: string, value: T): void; }

// The underlying registries track owner; built-ins register with owner 'builtin'.
export class Registry<T> {
  register(name: string, value: T, owner: string): void;  // dup name → fatal
  resolve(name: string): T;                                 // missing → fatal (lazy)
  owner(name: string): string;
  has(name: string): boolean;
  names(): string[];
}
```

## What this plan builds / defers
- **Builds:** the loader + four registries; tools (3 adapters + persona keystone); compaction (strategy seam + `validatePreserved` + route 3 sites); personas (`api.personas` source); runtimes (resolve-by-name; built-ins registered).
- **Defers (rides the registries):** the plane runtime *impl* + persona/runtime schema **narrowing** → #3 (Part E only makes runtimes selectable by name). Egress/workspace/credentials → #4/#5/#6 (Part B leaves a `credentialSocket` seam, gated on the manifest). MCP per-session keying/identity → D2 (until then MCP tools are barred from the `credentials` capability). The hook-bus (1:N events) is a documented seam, not built. Supply-chain integrity (digests) is out of scope.

---

# Part A — The mechanism (loader + four owner-tracking registries)

## Phase A1 — The generic owner-tracking `Registry<T>`

One instance backs each extension kind. Registration is eager (boot); resolution is lazy. A duplicate name in a trusted bundled set is a build mistake → fatal at registration. A missing name at resolve is a per-agent config error → fatal there.

**Files:** Create `packages/agent/src/plugins/registry.ts`, `packages/agent/src/plugins/registry.test.ts`.

- [ ] **Step 1: Failing tests** — `packages/agent/src/plugins/registry.test.ts`:

```typescript
// ABOUTME: Unit tests for the generic owner-tracking plugin Registry<T>
import { describe, it, expect } from 'vitest';
import { Registry, RegistryError } from './registry';

describe('Registry<T>', () => {
  it('registers and resolves by name, tracking owner', () => {
    const r = new Registry<string>('tools');
    r.register('grep', 'GREP', 'vendor-x');
    expect(r.resolve('grep')).toBe('GREP');
    expect(r.owner('grep')).toBe('vendor-x');
  });

  it('lists names in registration order and reports membership', () => {
    const r = new Registry<number>('compaction');
    r.register('a', 1, 'builtin');
    r.register('b', 2, 'builtin');
    expect(r.names()).toEqual(['a', 'b']);
    expect(r.has('a')).toBe(true);
    expect(r.has('missing')).toBe(false);
  });

  it('throws RegistryError on duplicate name (fatal-at-boot)', () => {
    const r = new Registry<string>('tools');
    r.register('bash', 'builtin-bash', 'builtin');
    expect(() => r.register('bash', 'plugin-bash', 'vendor-x')).toThrow(RegistryError);
    expect(() => r.register('bash', 'plugin-bash', 'vendor-x')).toThrow(/duplicate.*bash.*tools/i);
  });

  it('throws RegistryError when resolving or owning a missing name', () => {
    const r = new Registry<string>('personas');
    expect(() => r.resolve('ghost')).toThrow(/no.*personas.*ghost/i);
    expect(() => r.owner('ghost')).toThrow(RegistryError);
  });

  it('resolves lazily — values registered after construction are visible', () => {
    const r = new Registry<string>('runtimes');
    expect(() => r.resolve('docker')).toThrow(RegistryError);
    r.register('docker', 'DOCKER', 'builtin');
    expect(r.resolve('docker')).toBe('DOCKER');
  });

  it('clear() empties the registry (test-support)', () => {
    const r = new Registry<string>('tools');
    r.register('x', 'X', 'builtin');
    r.clear();
    expect(r.has('x')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npm test -- plugins/registry` → `Cannot find module './registry'`.

- [ ] **Step 3: Implement** — `packages/agent/src/plugins/registry.ts`:

```typescript
// ABOUTME: Generic owner-tracking select-one-by-name registry for the plugin system
// ABOUTME: register-by-name (with owner), dup→fatal, lazy-resolve; one per extension kind

export class RegistryError extends Error {
  constructor(message: string) { super(message); this.name = 'RegistryError'; }
}

interface Entry<T> { value: T; owner: string; }

export class Registry<T> {
  private readonly entries = new Map<string, Entry<T>>();
  constructor(private readonly kind: string) {}

  register(name: string, value: T, owner: string): void {
    if (this.entries.has(name)) {
      throw new RegistryError(`duplicate ${this.kind} registration: "${name}"`);
    }
    this.entries.set(name, { value, owner });
  }

  resolve(name: string): T {
    const e = this.entries.get(name);
    if (!e) {
      throw new RegistryError(
        `no ${this.kind} registered under "${name}" (known: ${this.names().join(', ') || 'none'})`
      );
    }
    return e.value;
  }

  /** The plugin (or 'builtin') that registered `name`. Throws if absent. */
  owner(name: string): string {
    const e = this.entries.get(name);
    if (!e) throw new RegistryError(`no ${this.kind} registered under "${name}"`);
    return e.owner;
  }

  has(name: string): boolean { return this.entries.has(name); }
  names(): string[] { return Array.from(this.entries.keys()); }
  /** Test-support: empty the registry. Production never calls this. */
  clear(): void { this.entries.clear(); }
}
```

- [ ] **Step 4: Run, expect PASS** — `npm test -- plugins/registry`.
- [ ] **Step 5: Commit** — `git add packages/agent/src/plugins/registry.ts packages/agent/src/plugins/registry.test.ts && git commit -m "feat(lace/plugins): owner-tracking Registry<T> (dup-fatal, lazy-resolve)"`

## Phase A2 — `PluginApi`, per-plugin registrars, `assertVersion`, the singletons

`createPluginApi` gives each plugin owner-injecting registrar views: `api.tools.register(name, value)` records owner = that plugin's `meta.name`. The four underlying `Registry<T>` singletons live here so root and every subagent share the same per-process instances.

**Files:** Create `packages/agent/src/plugins/api.ts`, `packages/agent/src/plugins/api.test.ts`. (No `context.ts` — there is no separate plugin call-context type; tool identity rides `ToolContext.persona`, Part B.)

- [ ] **Step 1: Failing tests** — `packages/agent/src/plugins/api.test.ts`:

```typescript
// ABOUTME: Tests PluginApi construction, owner injection, and assertVersion
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPluginApi, makeRegistries, KERNEL_PLUGIN_VERSION, PluginVersionError,
} from './api';

const META = { name: 'demo', namespace: 'demo', version: '1.0.0' };

describe('createPluginApi', () => {
  let registries: ReturnType<typeof makeRegistries>;
  beforeEach(() => { registries = makeRegistries(); });

  it('exposes four registrars + meta + kernelVersion', () => {
    const api = createPluginApi(META, registries);
    expect(api.meta.namespace).toBe('demo');
    expect(api.kernelVersion).toBe(KERNEL_PLUGIN_VERSION);
  });

  it('registrar.register stamps the plugin as owner in the underlying registry', () => {
    const api = createPluginApi(META, registries);
    api.personas.register('p', { config: { runtime: { type: 'root' } }, body: 'x' } as never);
    expect(registries.personas.has('p')).toBe(true);
    expect(registries.personas.owner('p')).toBe('demo');
  });

  it('assertVersion passes the current major, throws on mismatch', () => {
    const api = createPluginApi(META, registries);
    const major = Number(KERNEL_PLUGIN_VERSION.split('.')[0]);
    expect(() => api.assertVersion(major)).not.toThrow();
    expect(() => api.assertVersion(major + 1)).toThrow(PluginVersionError);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npm test -- plugins/api`.

- [ ] **Step 3: Implement** — `packages/agent/src/plugins/api.ts`:

```typescript
// ABOUTME: PluginApi — per-plugin owner-injecting registrar views over the registries
// ABOUTME: plus the process-wide registry singletons and assertVersion

import { Registry } from './registry';
import { resetManifestsForTest } from './manifest';
import type { Tool } from '@lace/agent/tools/tool';
import type { CompactionStrategy } from '@lace/agent/compaction/types';
import type { ContainerRuntime } from '@lace/agent/containers/types';
import type { ParsedPersona } from '@lace/agent/config/persona-registry';

export const KERNEL_PLUGIN_VERSION = '1.0.0';
export class PluginVersionError extends Error {
  constructor(message: string) { super(message); this.name = 'PluginVersionError'; }
}

/** A plugin-contributed persona has the same shape disk personas parse to. */
export type PersonaDef = ParsedPersona;
export interface PluginMeta { name: string; namespace: string; version: string; }

export interface PluginRegistries {
  tools: Registry<Tool>;
  compaction: Registry<CompactionStrategy>;
  runtimes: Registry<ContainerRuntime>;
  personas: Registry<PersonaDef>;
}
export interface PluginRegistrar<T> { register(name: string, value: T): void; }
export interface PluginApi {
  readonly meta: PluginMeta;
  readonly kernelVersion: string;
  assertVersion(major: number): void;
  tools: PluginRegistrar<Tool>;
  compaction: PluginRegistrar<CompactionStrategy>;
  runtimes: PluginRegistrar<ContainerRuntime>;
  personas: PluginRegistrar<PersonaDef>;
}

export function makeRegistries(): PluginRegistries {
  return {
    tools: new Registry<Tool>('tools'),
    compaction: new Registry<CompactionStrategy>('compaction'),
    runtimes: new Registry<ContainerRuntime>('runtimes'),
    personas: new Registry<PersonaDef>('personas'),
  };
}

function registrar<T>(reg: Registry<T>, owner: string): PluginRegistrar<T> {
  return { register: (name, value) => reg.register(name, value, owner) };
}

export function createPluginApi(meta: PluginMeta, registries: PluginRegistries): PluginApi {
  const kernelMajor = Number(KERNEL_PLUGIN_VERSION.split('.')[0]);
  return {
    meta,
    kernelVersion: KERNEL_PLUGIN_VERSION,
    assertVersion(major) {
      if (major !== kernelMajor) {
        throw new PluginVersionError(
          `plugin "${meta.name}" requires kernel plugin major ${major}, kernel is ${KERNEL_PLUGIN_VERSION}`
        );
      }
    },
    tools: registrar(registries.tools, meta.name),
    compaction: registrar(registries.compaction, meta.name),
    runtimes: registrar(registries.runtimes, meta.name),
    personas: registrar(registries.personas, meta.name),
  };
}

/** Process-wide registry singletons. Every lace process imports this and runs the
 *  loader, so root + subagents have identical registries. */
export const registries: PluginRegistries = makeRegistries();

/** Test-support: clear all registries + manifests between cases (the registries are
 *  process-global; vitest isolates per file, but within a file dup→fatal bites). */
export function resetRegistriesForTest(): void {
  registries.tools.clear();
  registries.compaction.clear();
  registries.runtimes.clear();
  registries.personas.clear();
  resetManifestsForTest();
}
```

> `ParsedPersona` and `PersonaConfig` are already exported from `config/persona-registry.ts` (verified). `CompactionStrategy` is added by Part C to `compaction/types.ts`; if Part A is built before Part C, temporarily `type CompactionStrategy = unknown` here and tighten in Part C, or build A's api.ts importing it once C1 Step 1 lands. Simplest: do C1 Step 1 (the type) first, or inline a minimal `interface CompactionStrategy { name: string }` placeholder and replace in C1.

- [ ] **Step 4: Run, expect PASS** — `npm test -- plugins/api`.
- [ ] **Step 5: Commit** — `git commit -m "feat(lace/plugins): PluginApi + per-plugin owner-injecting registrars + assertVersion"`

## Phase A3 — Capability manifest (owner-keyed, default-deny)

A plugin declares capabilities; the loader records them keyed by plugin name; the credential path (spec #6) asks `pluginMayUseCapability(registry.owner(toolName), 'credentials')`. This phase is the record + query; enforcement is #6.

**Files:** Create `packages/agent/src/plugins/manifest.ts`, `packages/agent/src/plugins/manifest.test.ts`.

- [ ] **Step 1: Failing tests** — `manifest.test.ts`:

```typescript
// ABOUTME: Tests the owner-keyed capability manifest (default-deny)
import { describe, it, expect, beforeEach } from 'vitest';
import { recordManifest, pluginMayUseCapability, resetManifestsForTest } from './manifest';

describe('capability manifest', () => {
  beforeEach(() => resetManifestsForTest());
  it('grants a declared capability', () => {
    recordManifest('vendor/creds', { capabilities: ['credentials'] });
    expect(pluginMayUseCapability('vendor/creds', 'credentials')).toBe(true);
  });
  it('default-denies an undeclared capability', () => {
    recordManifest('vendor/grep', { capabilities: [] });
    expect(pluginMayUseCapability('vendor/grep', 'credentials')).toBe(false);
  });
  it('default-denies an unknown plugin', () => {
    expect(pluginMayUseCapability('never-registered', 'credentials')).toBe(false);
  });
  it("grants 'builtin' all capabilities", () => {
    expect(pluginMayUseCapability('builtin', 'credentials')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npm test -- plugins/manifest`.

- [ ] **Step 3: Implement** — `manifest.ts`:

```typescript
// ABOUTME: Owner-keyed capability manifest — record at load, query at use. Default-deny.
// ABOUTME: Enforcement of the credential path is spec #6; this is the record + gate.

export type Capability = 'credentials';
export interface CapabilityManifest { capabilities: Capability[]; }

const manifests = new Map<string, CapabilityManifest>();

export function recordManifest(pluginName: string, manifest: CapabilityManifest): void {
  manifests.set(pluginName, manifest);
}

/** Built-ins (owner 'builtin') are trusted lace code → all capabilities. A plugin
 *  gets a capability only if it explicitly declared it. Unknown owner → deny. */
export function pluginMayUseCapability(owner: string, capability: Capability): boolean {
  if (owner === 'builtin') return true;
  return manifests.get(owner)?.capabilities.includes(capability) ?? false;
}

export function resetManifestsForTest(): void { manifests.clear(); }
```

- [ ] **Step 4: Run, expect PASS** — `npm test -- plugins/manifest`.
- [ ] **Step 5: Commit** — `git commit -m "feat(lace/plugins): owner-keyed capability manifest (default-deny; builtin allowed)"`

## Phase A4 — The loader (reads `meta` + `manifest`, records, registers)

Parse `LACE_PLUGINS` (ordered, comma-separated specifiers) → dynamic-import each → read its `meta` (fallback: the specifier) + optional `manifest` → `recordManifest` → call `register(api)`. Any failure is fatal (throws `PluginLoadError`); `main.ts` (A5) exits. Per-plugin TIMING logged (ESLint-TIMING-style).

**Files:** Create `packages/agent/src/plugins/loader.ts`, `packages/agent/src/plugins/index.ts`, `packages/agent/src/plugins/loader.test.ts`, and fixtures under `packages/agent/src/plugins/__fixtures__/`.

- [ ] **Step 1: Fixtures** — create:

`__fixtures__/good-plugin.ts`:
```typescript
// ABOUTME: Fixture — well-formed plugin with meta + manifest, registers a persona
import type { PluginApi } from '../api';
export const meta = { name: 'good', namespace: 'good', version: '1.2.3' };
export const manifest = { capabilities: [] as const };
export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.personas.register('fixture-persona', { config: { runtime: { type: 'root' } }, body: 'hi' } as never);
}
```

`__fixtures__/creds-plugin.ts`:
```typescript
// ABOUTME: Fixture — declares the credentials capability
import type { PluginApi } from '../api';
export const meta = { name: 'creds', namespace: 'creds', version: '1.0.0' };
export const manifest = { capabilities: ['credentials' as const] };
export function register(_api: PluginApi): void { /* registers nothing for this test */ }
```

`__fixtures__/dup-persona-plugin.ts`:
```typescript
// ABOUTME: Fixture — registers the same persona name as good-plugin (dup→fatal)
import type { PluginApi } from '../api';
export const meta = { name: 'dup', namespace: 'dup', version: '1.0.0' };
export function register(api: PluginApi): void {
  api.personas.register('fixture-persona', { config: { runtime: { type: 'root' } }, body: 'x' } as never);
}
```

`__fixtures__/throws-on-register-plugin.ts`:
```typescript
import type { PluginApi } from '../api';
export const meta = { name: 'boom', namespace: 'boom', version: '1.0.0' };
export function register(_api: PluginApi): void { throw new Error('boom during register'); }
```

`__fixtures__/version-skew-plugin.ts`:
```typescript
import type { PluginApi } from '../api';
export const meta = { name: 'skew', namespace: 'skew', version: '1.0.0' };
export function register(api: PluginApi): void { api.assertVersion(999); }
```

`__fixtures__/not-a-plugin.ts`:
```typescript
export const nope = true;
```

- [ ] **Step 2: Failing tests** — `loader.test.ts`:

```typescript
// ABOUTME: Tests the LACE_PLUGINS loader against fixture modules
import { describe, it, expect } from 'vitest';
import { loadPlugins, parsePluginSpec, PluginLoadError } from './loader';
import { makeRegistries } from './api';
import { pluginMayUseCapability, resetManifestsForTest } from './manifest';

const FIX = './__fixtures__';

describe('parsePluginSpec', () => {
  it('returns [] for empty/undefined', () => {
    expect(parsePluginSpec(undefined)).toEqual([]);
    expect(parsePluginSpec('  ')).toEqual([]);
  });
  it('splits + trims, preserving order', () => {
    expect(parsePluginSpec(' a , b ,c ')).toEqual(['a', 'b', 'c']);
  });
});

describe('loadPlugins', () => {
  it('no-ops on empty spec', async () => {
    const r = makeRegistries();
    expect((await loadPlugins(undefined, { registries: r })).loaded).toEqual([]);
  });
  it('loads a good plugin, populates the registry with the declared meta as owner', async () => {
    const r = makeRegistries();
    await loadPlugins(`${FIX}/good-plugin`, { registries: r });
    expect(r.personas.has('fixture-persona')).toBe(true);
    expect(r.personas.owner('fixture-persona')).toBe('good');
  });
  it('records the manifest so capability checks work', async () => {
    resetManifestsForTest();
    const r = makeRegistries();
    await loadPlugins(`${FIX}/creds-plugin`, { registries: r });
    expect(pluginMayUseCapability('creds', 'credentials')).toBe(true);
    expect(pluginMayUseCapability('good', 'credentials')).toBe(false);
  });
  it('records per-plugin timing', async () => {
    const r = makeRegistries();
    const res = await loadPlugins(`${FIX}/good-plugin`, { registries: r });
    expect(res.loaded[0].name).toBe('good');
    expect(typeof res.loaded[0].ms).toBe('number');
  });
  it('fatal: unimportable specifier', async () => {
    await expect(loadPlugins(`${FIX}/nope-missing`, { registries: makeRegistries() })).rejects.toThrow(PluginLoadError);
  });
  it('fatal: no register() export', async () => {
    await expect(loadPlugins(`${FIX}/not-a-plugin`, { registries: makeRegistries() })).rejects.toThrow(/register/i);
  });
  it('fatal: register() throws', async () => {
    await expect(loadPlugins(`${FIX}/throws-on-register-plugin`, { registries: makeRegistries() })).rejects.toThrow(/boom/);
  });
  it('fatal: duplicate name across plugins', async () => {
    await expect(loadPlugins(`${FIX}/good-plugin,${FIX}/dup-persona-plugin`, { registries: makeRegistries() })).rejects.toThrow(/duplicate/i);
  });
  it('fatal: version skew', async () => {
    await expect(loadPlugins(`${FIX}/version-skew-plugin`, { registries: makeRegistries() })).rejects.toThrow(/major/i);
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `npm test -- plugins/loader`.

- [ ] **Step 4: Implement** — `loader.ts`:

```typescript
// ABOUTME: The one LACE_PLUGINS loader — import in order, read meta+manifest, register, validate
// ABOUTME: Pure async (no process.exit); fatal == throws PluginLoadError. main.ts handles exit.

import { logger } from '@lace/agent/utils/logger';
import { createPluginApi, registries as globalRegistries, type PluginRegistries, type PluginMeta } from './api';
import { recordManifest, type CapabilityManifest } from './manifest';

export class PluginLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = 'PluginLoadError'; }
}

interface LoadedModule {
  register: (api: import('./api').PluginApi) => void;
  meta?: PluginMeta;
  manifest?: CapabilityManifest;
}
export interface LoadPluginsOptions { registries?: PluginRegistries; }
export interface LoadPluginsResult { loaded: Array<{ name: string; ms: number }>; }

export function parsePluginSpec(spec: string | undefined): string[] {
  if (!spec || !spec.trim()) return [];
  return spec.split(',').map((s) => s.trim()).filter(Boolean);
}

function asModule(mod: unknown, specifier: string): LoadedModule {
  if (typeof (mod as { register?: unknown })?.register !== 'function') {
    throw new PluginLoadError(`plugin "${specifier}" does not export a register() function`);
  }
  return mod as LoadedModule;
}

export async function loadPlugins(spec: string | undefined, opts: LoadPluginsOptions = {}): Promise<LoadPluginsResult> {
  const registries = opts.registries ?? globalRegistries;
  const loaded: LoadPluginsResult['loaded'] = [];
  for (const specifier of parsePluginSpec(spec)) {
    const startedAt = Date.now();
    let raw: unknown;
    try { raw = await import(specifier); }
    catch (err) { throw new PluginLoadError(`failed to import plugin "${specifier}"`, { cause: err }); }
    const mod = asModule(raw, specifier);
    const meta: PluginMeta = mod.meta ?? { name: specifier, namespace: specifier, version: '0.0.0' };
    if (mod.manifest) recordManifest(meta.name, mod.manifest);
    const api = createPluginApi(meta, registries);
    try { mod.register(api); }
    catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      throw new PluginLoadError(`plugin "${specifier}" register() failed: ${m}`, { cause: err });
    }
    const ms = Date.now() - startedAt;
    loaded.push({ name: meta.name, ms });
    logger.info('plugins.loaded', { plugin: meta.name, specifier, ms });
  }
  return { loaded };
}
```

- [ ] **Step 5: Barrel** — `plugins/index.ts`:

```typescript
// ABOUTME: Public surface of the lace plugin system
export { Registry, RegistryError } from './registry';
export {
  createPluginApi, makeRegistries, registries, resetRegistriesForTest,
  KERNEL_PLUGIN_VERSION, PluginVersionError,
  type PluginApi, type PluginMeta, type PluginRegistries, type PluginRegistrar, type PersonaDef,
} from './api';
export {
  recordManifest, pluginMayUseCapability, resetManifestsForTest,
  type Capability, type CapabilityManifest,
} from './manifest';
export { loadPlugins, parsePluginSpec, PluginLoadError, type LoadPluginsResult, type LoadPluginsOptions } from './loader';
```

- [ ] **Step 6: Run, expect PASS** — `npm test -- plugins/`.
- [ ] **Step 7: Commit** — `git commit -m "feat(lace/plugins): LACE_PLUGINS loader (meta+manifest, ordered import, dup/version fatal, TIMING)"`

> Fixture import resolution: specifiers like `./__fixtures__/good-plugin` resolve relative to the compiled `loader.js`. Under vitest this works because `loader.ts` and `__fixtures__/` are siblings. If the runner can't resolve a bare relative specifier, switch the test to `new URL('./__fixtures__/good-plugin.ts', import.meta.url).pathname`. Verify which the repo's vitest supports before settling. Real `LACE_PLUGINS` entries are bare module specifiers (sen's bundled plugin package), not file URLs.

## Phase A5 — Boot integration + subagent reach

Load plugins **before** the JSON-RPC peer accepts frames, without dropping early frames; register built-ins (tools, compaction; runtimes too — see Part E) before plugins so a plugin name-clash with a built-in is a loud fatal. Then prove subagent reach with the real entrypoint.

### Why the ordering works (read before editing `main.ts`)
`main.ts` pipes `process.stdin` into a `PassThrough` tee at module load. A `PassThrough` **buffers** while nothing consumes it and only flows once a `data` listener (or pipe) attaches. So: do the async plugin load **before** attaching the protocol-log `data` listener and constructing the peer; frames buffer in the tee during the `await` and are delivered in order once the peer wires. (This also resolves the existing "H15" race the file comments describe.)

**Files:** Modify `packages/agent/src/main.ts`; add `tsx` to `packages/agent/package.json` devDeps; create `packages/agent/src/plugins/__fixtures__/reach-plugin.ts`, `packages/agent/src/__tests__/plugin-subagent-reach.test.ts`; add a one-line comment to `packages/agent/src/jobs/subagent-spawn.ts`.

- [ ] **Step 1: Add `tsx`** — in `packages/agent/package.json` devDependencies add `"tsx": "^4.19.0"` (or the repo's current major), then `npm install`. This lets a child process execute a `.ts` entry for the reach test.

- [ ] **Step 2: Refactor `main.ts` to an async `boot()`**

Move the protocol-log `data` listener, transport, `JsonRpcPeer`, `registerAgentRpcMethods`, and the backfill `setImmediate` out of module-top and into an async `boot()` that first registers built-ins and loads plugins. Keep `stdinTee` + `process.stdin.pipe(stdinTee)` + `writable` + `state` at module top. Promote `peer` to a module-scoped `let peer: JsonRpcPeer | undefined` (the `shutdown()` handler uses `peer?.close()`).

```typescript
import { loadPlugins, PluginLoadError } from './plugins';
import { registerBuiltinCompaction } from './compaction/strategy';   // Part C
import { registerBuiltinTools } from './tools/builtins';             // Part B
import { registerBuiltinRuntimes, buildContainerManager } from './containers/manager-factory'; // Part E

let peer: JsonRpcPeer | undefined;

async function boot(): Promise<void> {
  // Register built-ins BEFORE plugins so a plugin dup of a built-in name is fatal.
  registerBuiltinTools();
  registerBuiltinCompaction();
  registerBuiltinRuntimes();
  try {
    const res = await loadPlugins(process.env.LACE_PLUGINS);
    if (res.loaded.length) logger.info(`plugins: loaded ${res.loaded.map((p) => p.name).join(', ')}`);
  } catch (err) {
    logger.error(`plugins: fatal load failure: ${err instanceof PluginLoadError ? err.message : String(err)}`);
    process.exit(1); // before any frame; LaceSupervisor respawns → a persistent misconfig is a respawn loop (config error)
  }

  // Part E: now the runtimes registry is populated → build the manager + reaper.
  buildContainerManager(state);   // sets state.containerManager + state.perInvocationReaper; runs startup reaper

  // Safe to attach the stdin consumer + wire the peer.
  readable.on('data', (chunk) => {
    const lines = chunk.toString().split(/\n/).filter((l: string) => l.trim().length > 0);
    for (const line of lines) protocolLog?.write(`${new Date().toISOString()} IN ${line}\n`);
  });
  const transport = createNdjsonStdioTransport({ readable, writable });
  peer = new JsonRpcPeer(transport, { idPrefix: 'a_' });
  state.peer = peer;
  registerAgentRpcMethods(peer, state);   // wires the network-lifecycle observer; manager is already set above

  setImmediate(() => {
    try { const s = backfillIndex(getRecallIndex(), laceDir); logger.info(`recall: backfill scanned=${s.scanned} inserted=${s.inserted}`); }
    catch (err) { logger.error(`recall: backfill failed: ${err instanceof Error ? err.message : String(err)}`); }
  });
}
void boot();
```

Delete the module-top `void runStartupReaper(createContainerManagerForPlatform());` and the now-unused `createContainerManagerForPlatform` import (Part E moves reaping into `buildContainerManager`). Keep `const readable = stdinTee;` at module top.

> `registerBuiltinTools`, `registerBuiltinCompaction`, `registerBuiltinRuntimes`, `buildContainerManager` are introduced in Parts B/C/E. If you build Part A first, stub them as no-ops in their target files and fill them in their Part, or build A's `main.ts` change last (after B/C/E land). The plan's mandatory order (A → B,C,D → E) means `buildContainerManager` (E) lands last — until then keep the existing synchronous manager construction in `createAgentServerState` and only add the plugin-load block; switch to `buildContainerManager` in Part E.

- [ ] **Step 3: Annotate the reach invariant** — in `packages/agent/src/jobs/subagent-spawn.ts` at the `spawn(... { env: { ...process.env, ...(executionEnv ?? {}) } ... })` line, add:
```typescript
// Subagent plugin reach depends on inheriting LACE_PLUGINS: the child re-execs the
// same entrypoint (process.argv[1]) and runs the loader. Do NOT switch to a clean env.
```

- [ ] **Step 4: Reach fixture + test** — `__fixtures__/reach-plugin.ts`:
```typescript
import type { PluginApi } from '../api';
export const meta = { name: 'reach', namespace: 'reach', version: '1.0.0' };
export function register(api: PluginApi): void {
  api.personas.register('reach-persona', { config: { runtime: { type: 'root' } }, body: 'reached' } as never);
}
```

`packages/agent/src/__tests__/plugin-subagent-reach.test.ts` — spawn the **real agent entrypoint** with `LACE_PLUGINS` set, drive a minimal `initialize` + persona query, and assert the child sees `reach-persona`. If driving the full Ent handshake is too heavy, fall back to a probe that imports the same `boot`-time registration path. The faithful version:

```typescript
// ABOUTME: E2E — a child lace process inherits LACE_PLUGINS and loads the same plugins
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const PROBE = path.resolve(__dirname, '../plugins/__fixtures__/loader-probe.ts');

describe('subagent plugin reach (env inheritance)', () => {
  it('a child process with LACE_PLUGINS inherited registers the plugin', () => {
    const res = spawnSync(process.execPath, ['--import', 'tsx', PROBE], {
      env: { ...process.env, LACE_PLUGINS: '../plugins/__fixtures__/reach-plugin' },
      cwd: __dirname, encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('reach-persona');
  });
});
```

`plugins/__fixtures__/loader-probe.ts`:
```typescript
// ABOUTME: Probe — runs the loader like main.ts does and prints registered persona names
import { loadPlugins, registries } from '../index';
async function main(): Promise<void> {
  await loadPlugins(process.env.LACE_PLUGINS);
  process.stdout.write(registries.personas.names().join(',') + '\n');
}
void main();
```

> The probe proves env-inheritance + loader-in-child. To additionally prove the *production* entrypoint inherits, add a second assertion that `spawnSubagent`'s env construction includes `LACE_PLUGINS` (unit-level: import the env-building and assert the key survives), since `subagent-spawn.ts` spreads `...process.env`.

- [ ] **Step 5: Verify** — `npm run typecheck && npm test -- "plugins|plugin-subagent-reach"`; then `npm test` (full) with `LACE_PLUGINS` unset to confirm boot is unchanged (empty load = no-op).
- [ ] **Step 6: Commit** — `git commit -m "feat(lace/plugins): load LACE_PLUGINS at boot before frames; prove subagent reach (tsx)"`

## Hook-bus seam (no code)
A pluggy-style 1:N event bus is deliberately not built. When a genuine all-plugins-observe point appears, add a fifth field `events` to `PluginRegistries` (an ordered list, not a map); `register(api)` already accommodates one more field. Do not add speculatively.

---

# Part B — Tools registry domain

Three adapter shapes behind one `Tool`: in-process (exists), MCP (exists), **one-shot-exec** (new). The **persona keystone** (identity resolved server-side). Built-in tools register into `api.tools` so a plugin name-clash is fatal, not silent.

**Code mapped:** `tools/tool.ts` (`Tool` base: `name`/`description`/`schema`/`inputSchema` getter; `execute(args,ctx)`→`executeValidated`). `tools/types.ts` (`ToolContext` — has `signal`, `activeSessionId`; **no `persona`/`timeoutMs`**; `ToolResult{content:ContentBlock[];status:'completed'|'failed'|'aborted'|...}`). `mcp/tool-adapter.ts:89` (`executeValidated(args,_context)` ignores ctx). `core/conversation/runner.ts:1637-1662` (the ToolContext assembly; sets `activeSessionId`). `core/conversation/types.ts:35-56` (`RunnerConfig` — no `personaName`). `tools/executor.ts:287-316` (`registerAllAvailableTools`; per-session `ToolExecutor`, `private tools = new Map`). `tools/implementations/bash.ts` (abort = SIGTERM then SIGKILL).

## Phase B1 — The persona keystone (via `RunnerConfig`, resolved at construction)

The authoritative persona must reach every tool, resolved server-side, never from tool args. Thread it through `RunnerConfig` (set where the runner is built, where the persona is already known) — NOT a lazy disk scan.

**Files:** Modify `tools/types.ts`, `core/conversation/types.ts`, `core/conversation/runner.ts`, and the runner construction site(s). Test under `core/conversation/__tests__/`.

- [ ] **Step 1: Add the fields**

`tools/types.ts` `ToolContext`, near `activeSessionId` (~:44):
```typescript
  /** Authoritative persona for the active session, resolved SERVER-SIDE. Never from
   *  tool arguments — the keystone invariant. */
  persona?: string;
  /** Per-call timeout for out-of-process tools (one-shot-exec). */
  timeoutMs?: number;
```

`core/conversation/types.ts` `RunnerConfig` (alongside `sessionId`/`sessionDir`):
```typescript
  /** Persona name for this session; stamped into every ToolContext. */
  persona?: string;
```

- [ ] **Step 2: Stamp it in the runner's ToolContext assembly**

In `runner.ts` at the `toolExecutor.execute(..., { ... })` context literal (~:1637-1662), next to `activeSessionId`:
```typescript
        ...(this.config.persona ? { persona: this.config.persona } : {}),
```
No new import, no disk scan, no `personaForSessionDir` — the persona is already on `this.config`.

- [ ] **Step 3: Populate `RunnerConfig.persona` at construction**

`grep -rn "new ConversationRunner" packages/agent/src` to find the construction site(s). At each, pass the resolved persona. The persona is available: at `session/new`/`session/resume` it's the requested/stored persona (`session.ts` parses it; `SessionMeta.persona`); for subagents it's threaded at `subagent-job.ts:968` (`parent.personaName`). Set `persona` on the `RunnerConfig` you build there. (If the runner is built from session state, read `SessionMeta.persona`.)

- [ ] **Step 4: Failing test** — a capturing tool asserts the stamped persona is unaffected by args. Build the runner the way the existing `core/conversation/__tests__/runner*.test.ts` do (hand-rolled `new ConversationRunner(config, deps)` with a stub provider emitting one tool_use); set `config.persona='researcher'`. Assert the captured `ctx.persona === 'researcher'` even when the tool-call args contain `persona:'attacker'`. (Mirror the neighbouring runner test's harness; do not invent a `buildRunnerForTest` helper — none exists.)

```typescript
// ABOUTME: runner stamps the authoritative persona into ToolContext, server-side
// (construct the runner exactly as the sibling runner tests do; only the assertion shown)
it('stamps ToolContext.persona from config.persona, ignoring tool args', async () => {
  let captured: import('@lace/agent/tools/types').ToolContext | undefined;
  const captureTool = { name: 'capture', description: 'x',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async (_a: unknown, ctx: import('@lace/agent/tools/types').ToolContext) => {
      captured = ctx; return { content: [{ type: 'text', text: 'ok' }], status: 'completed' as const };
    } };
  const runner = /* new ConversationRunner({ ...baseConfig, persona: 'researcher' }, depsWith(captureTool, providerEmits('capture', { persona: 'attacker' }))) */;
  await runner.run();
  expect(captured?.persona).toBe('researcher');
});
```

- [ ] **Step 5: Verify + commit** — `npm test -- runner` (the keystone test green); `git commit -m "feat(lace/tools): stamp authoritative persona into ToolContext via RunnerConfig (keystone)"`

## Phase B2 — Exec-tool descriptor

`<bin> lace-tool-schema` prints an MCP-like descriptor on stdout, exit 0. Parsed envelope; the inputSchema stays opaque JSON Schema.

**Files:** Create `tools/exec/descriptor.ts`, `tools/exec/descriptor.test.ts`.

- [ ] **Step 1: Failing tests** — `tools/exec/descriptor.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseExecToolDescriptor, ExecToolDescriptorError } from './descriptor';
describe('parseExecToolDescriptor', () => {
  it('parses a valid descriptor', () => {
    const d = parseExecToolDescriptor('{"name":"weather","description":"w","inputSchema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}');
    expect(d.name).toBe('weather'); expect(d.inputSchema.type).toBe('object');
  });
  it('accepts optional capabilities', () => {
    const d = parseExecToolDescriptor('{"name":"c","description":"x","inputSchema":{"type":"object","properties":{}},"capabilities":["credentials"]}');
    expect(d.capabilities).toEqual(['credentials']);
  });
  it('throws on bad JSON', () => { expect(() => parseExecToolDescriptor('nope')).toThrow(ExecToolDescriptorError); });
  it('throws on missing fields', () => { expect(() => parseExecToolDescriptor('{"name":"x"}')).toThrow(ExecToolDescriptorError); });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — `tools/exec/descriptor.ts`:
```typescript
// ABOUTME: The exec-tool schema descriptor (output of `<bin> lace-tool-schema`)
import { z } from 'zod';
import type { Capability } from '@lace/agent/plugins';

export class ExecToolDescriptorError extends Error {
  constructor(m: string) { super(m); this.name = 'ExecToolDescriptorError'; }
}
const schema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.object({ type: z.literal('object') }).passthrough(),
  capabilities: z.array(z.enum(['credentials'])).optional(),
}).strict();

export interface ExecToolDescriptor {
  name: string; description: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  capabilities?: Capability[];
}
export function parseExecToolDescriptor(raw: string): ExecToolDescriptor {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new ExecToolDescriptorError(`not JSON: ${raw.slice(0, 200)}`); }
  const r = schema.safeParse(json);
  if (!r.success) throw new ExecToolDescriptorError(`invalid descriptor: ${r.error.message}`);
  return r.data as ExecToolDescriptor;
}
```
- [ ] **Step 4: Run PASS; commit** `feat(lace/tools): exec-tool schema descriptor`.

## Phase B3 — Isolated child runner + `ExecToolAdapter` (BEFORE discovery — discover imports these)

Terraform-`external` invocation: JSON stdin (`{input, context}` — context built by lace, unforgeable), JSON stdout, exit-code verdict, stderr message. Minimal env (never the agent env), per-call cwd, **process-group kill** on abort, concurrency cap.

**Files:** Create `tools/exec/run-once.ts`, `tools/exec/exec-tool-adapter.ts`, tests, and shell fixtures.

- [ ] **Step 1: Fixtures** (all `chmod +x`, committed executable via `git update-index --chmod=+x`):

`tools/exec/__fixtures__/echo-tool.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "lace-tool-schema" ]; then
  printf '%s' '{"name":"echo","description":"echoes input.msg","inputSchema":{"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"]}}'; exit 0; fi
if [ "${1:-}" = "lace-tool-invoke" ]; then
  p="$(cat)"; msg="$(printf '%s' "$p" | sed -n 's/.*"msg":"\([^"]*\)".*/\1/p')"
  persona="$(printf '%s' "$p" | sed -n 's/.*"persona":"\([^"]*\)".*/\1/p')"
  printf '{"content":"echo:%s persona:%s"}' "$msg" "$persona"; exit 0; fi
echo "unknown subcommand" >&2; exit 2
```
`tools/exec/__fixtures__/fail-tool.sh`: schema branch prints `{"name":"fail","description":"x","inputSchema":{"type":"object","properties":{}}}`; otherwise `echo "boom" >&2; exit 3`.
`tools/exec/__fixtures__/slow-tool.sh`: schema branch as above (name `slow`); otherwise `sleep 30`.
`tools/exec/__fixtures__/env-dump-tool.sh`: schema branch (name `envdump`); otherwise `env; exit 0`.

- [ ] **Step 2: Failing tests** — `tools/exec/run-once.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { runExecToolProcess } from './run-once';
const FIX = path.join(__dirname, '__fixtures__');
describe('runExecToolProcess', () => {
  it('captures stdout + exit code', async () => {
    const r = await runExecToolProcess(path.join(FIX, 'echo-tool.sh'), ['lace-tool-invoke'],
      { stdin: JSON.stringify({ input: { msg: 'hi' }, context: { sessionId: 's', persona: 'p' } }), cwd: FIX, timeoutMs: 5000 });
    expect(r.exitCode).toBe(0); expect(r.stdout).toContain('echo:hi');
  });
  it('does NOT leak the parent env to the child', async () => {
    process.env.LACE_SECRET_PROBE = 'topsecret';
    const r = await runExecToolProcess(path.join(FIX, 'env-dump-tool.sh'), ['lace-tool-invoke'], { stdin: '{}', cwd: FIX, timeoutMs: 5000 });
    expect(r.stdout).not.toContain('topsecret'); delete process.env.LACE_SECRET_PROBE;
  });
  it('kills the process group on abort', async () => {
    const ac = new AbortController();
    const p = runExecToolProcess(path.join(FIX, 'slow-tool.sh'), ['lace-tool-invoke'], { stdin: '{}', cwd: FIX, timeoutMs: 10000, signal: ac.signal });
    setTimeout(() => ac.abort(), 100); expect((await p).aborted).toBe(true);
  });
  it('reports timeout', async () => {
    const r = await runExecToolProcess(path.join(FIX, 'slow-tool.sh'), ['lace-tool-invoke'], { stdin: '{}', cwd: FIX, timeoutMs: 100 });
    expect(r.timedOut).toBe(true);
  });
});
```

- [ ] **Step 3: Run FAIL; implement** `tools/exec/run-once.ts`:
```typescript
// ABOUTME: Spawn a one-shot tool process in isolation — minimal env, cwd, process-group kill
import { spawn } from 'node:child_process';
export interface RunExecOptions { stdin: string; cwd: string; timeoutMs: number; signal?: AbortSignal; env?: Record<string, string>; }
export interface RunExecResult { stdout: string; stderr: string; exitCode: number | null; aborted: boolean; timedOut: boolean; }

function minimalEnv(extra?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp' };
  for (const k of ['TZ', 'LANG', 'LC_ALL']) { const v = process.env[k]; if (v) base[k] = v; }
  return { ...base, ...(extra ?? {}) };
}

export function runExecToolProcess(bin: string, args: string[], opts: RunExecOptions): Promise<RunExecResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: minimalEnv(opts.env), stdio: ['pipe','pipe','pipe'], detached: true });
    let stdout = '', stderr = '', aborted = false, timedOut = false, settled = false;
    const killGroup = (sig: NodeJS.Signals) => { if (child.pid) { try { process.kill(-child.pid, sig); } catch { /* gone */ } } };
    const timer = setTimeout(() => { timedOut = true; killGroup('SIGKILL'); }, opts.timeoutMs);
    const onAbort = () => { aborted = true; killGroup('SIGKILL'); };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const finish = (code: number | null) => {
      if (settled) return; settled = true; clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode: code, aborted, timedOut });
    };
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
    child.stdin.end(opts.stdin);
  });
}
```
> `process.kill(-pid)` (process-group kill) is Linux/macOS — lace's targets. No Windows path.

- [ ] **Step 4: Failing tests** — `tools/exec/exec-tool-adapter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { ExecToolAdapter } from './exec-tool-adapter';
import { parseExecToolDescriptor } from './descriptor';
import type { ToolContext } from '@lace/agent/tools/types';
const FIX = path.join(__dirname, '__fixtures__');
const echo = parseExecToolDescriptor('{"name":"echo","description":"echoes input.msg","inputSchema":{"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"]}}');
const ctx = (o: Partial<ToolContext> = {}): ToolContext => ({ signal: new AbortController().signal, activeSessionId: 'sess', persona: 'researcher', ...o });
describe('ExecToolAdapter', () => {
  it('exposes descriptor name/description/schema (required defaults to [])', () => {
    const t = new ExecToolAdapter(path.join(FIX, 'echo-tool.sh'), echo);
    expect(t.name).toBe('echo'); expect(t.inputSchema.type).toBe('object'); expect(Array.isArray(t.inputSchema.required)).toBe(true);
  });
  it('builds the context block server-side (persona from ctx, not args) and maps stdout', async () => {
    const t = new ExecToolAdapter(path.join(FIX, 'echo-tool.sh'), echo);
    const r = await t.execute({ msg: 'hi', persona: 'attacker' }, ctx());
    expect(r.status).toBe('completed'); expect(r.content[0].text).toContain('echo:hi'); expect(r.content[0].text).toContain('persona:researcher');
  });
  it('maps non-zero exit to failed', async () => {
    const fail = parseExecToolDescriptor('{"name":"fail","description":"x","inputSchema":{"type":"object","properties":{}}}');
    expect((await new ExecToolAdapter(path.join(FIX, 'fail-tool.sh'), fail).execute({}, ctx())).status).toBe('failed');
  });
  it('maps abort to aborted', async () => {
    const slow = parseExecToolDescriptor('{"name":"slow","description":"x","inputSchema":{"type":"object","properties":{}}}');
    const ac = new AbortController(); setTimeout(() => ac.abort(), 100);
    expect((await new ExecToolAdapter(path.join(FIX, 'slow-tool.sh'), slow).execute({}, ctx({ signal: ac.signal }))).status).toBe('aborted');
  });
});
```

- [ ] **Step 5: Run FAIL; implement** `tools/exec/exec-tool-adapter.ts`:
```typescript
// ABOUTME: ExecToolAdapter — a one-shot executable behind the Tool interface
// ABOUTME: lace builds the unforgeable context block; lace does NO input validation (binary validates)
import { z, ZodType } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext, ToolInputSchema } from '@lace/agent/tools/types';
import { runExecToolProcess } from './run-once';
import type { ExecToolDescriptor } from './descriptor';

let inFlight = 0; const MAX = 16; const waiters: Array<() => void> = [];
async function acquire() { if (inFlight < MAX) { inFlight++; return; } await new Promise<void>((r) => waiters.push(r)); inFlight++; }
function release() { inFlight--; waiters.shift()?.(); }
const resultSchema = z.object({ content: z.union([z.string(), z.record(z.unknown())]).optional(), metadata: z.record(z.unknown()).optional() }).passthrough();

export class ExecToolAdapter extends Tool {
  name: string; description: string; schema: ZodType;
  constructor(private binPath: string, private descriptor: ExecToolDescriptor) {
    super();
    this.name = descriptor.name; this.description = descriptor.description;
    this.schema = z.object({}).passthrough(); // lace does not validate; the binary is the source of truth
  }
  // Advertise the binary's JSON Schema to the model; default required:[] (optional on descriptor, required on ToolInputSchema).
  get inputSchema(): ToolInputSchema {
    return { ...this.descriptor.inputSchema, required: this.descriptor.inputSchema.required ?? [] } as ToolInputSchema;
  }
  protected async executeValidated(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const payload = JSON.stringify({
      input: args,
      context: { sessionId: context.activeSessionId ?? '', persona: context.persona ?? '' /* credentialSocket: seam for #6, gated on the manifest */ },
    });
    await acquire();
    try {
      const res = await runExecToolProcess(this.binPath, ['lace-tool-invoke'], {
        stdin: payload, cwd: context.workingDirectory ?? context.toolTempDir ?? process.cwd(),
        timeoutMs: context.timeoutMs ?? 120_000, signal: context.signal,
      });
      if (res.aborted) return this.createCancellationResult(res.stdout || undefined);
      if (res.timedOut) return this.createError(`exec tool "${this.name}" timed out`);
      if (res.exitCode !== 0) return this.createError(`exec tool "${this.name}" failed (exit ${res.exitCode}): ${res.stderr.trim()}`);
      const parsed = resultSchema.safeParse(safeJson(res.stdout));
      if (!parsed.success) return this.createResult(res.stdout.trim());
      return this.createResult(parsed.data.content ?? res.stdout.trim(), parsed.data.metadata);
    } finally { release(); }
  }
}
function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return undefined; } }
```

- [ ] **Step 6: Run PASS; commit** `feat(lace/tools): ExecToolAdapter + isolated one-shot runner`.

## Phase B4 — Discovery + built-in registration + executor draw

`discoverExecTools(dir)` scans a scoped dir (one bad binary skipped, not fatal). `registerBuiltinTools()` puts stateless built-ins into `registries.tools` (owner `'builtin'`) at boot. The per-session `ToolExecutor` draws all tools from `registries.tools` and adds the per-session option-taking built-ins (`delegate`, `use_skill`), failing loudly if a plugin claimed those names.

**Files:** Create `tools/exec/discover.ts` (+ test), `tools/builtins.ts` (+ test); modify `tools/executor.ts`.

- [ ] **Step 1: `discover.ts`** (after the adapter exists):
```typescript
// ABOUTME: Discover one-shot-exec tools from a SCOPED directory (never $PATH)
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '@lace/agent/utils/logger';
import { parseExecToolDescriptor } from './descriptor';
import { ExecToolAdapter } from './exec-tool-adapter';
import { runExecToolProcess } from './run-once';
export async function discoverExecTools(dir: string): Promise<ExecToolAdapter[]> {
  let entries: string[];
  try { entries = await fs.readdir(dir); } catch { return []; }
  const out: ExecToolAdapter[] = [];
  for (const entry of entries) {
    const bin = path.join(dir, entry);
    try {
      const st = await fs.stat(bin);
      if (!st.isFile() || (st.mode & 0o111) === 0) continue;
      const { stdout, exitCode } = await runExecToolProcess(bin, ['lace-tool-schema'], { stdin: '', cwd: dir, timeoutMs: 5000 });
      if (exitCode !== 0) { logger.warn('exectool.schema.nonzero', { bin, exitCode }); continue; }
      out.push(new ExecToolAdapter(bin, parseExecToolDescriptor(stdout)));
    } catch (err) { logger.warn('exectool.discover.skipped', { bin, error: err instanceof Error ? err.message : String(err) }); }
  }
  return out;
}
```
Test against `echo-tool.sh` (builds `echo` adapter) + `fail-tool.sh` schema-invalid case (skipped, no throw) + missing dir (`[]`).

- [ ] **Step 2: `tools/builtins.ts`** — register stateless built-ins into `registries.tools`:
```typescript
// ABOUTME: Register lace's built-in (stateless) tools into the plugin tools registry
// ABOUTME: so a plugin name-clash is fatal at load. Option-taking tools (delegate, use_skill)
// ABOUTME: stay per-session in the executor; their names are guarded there.
import { registries } from '@lace/agent/plugins';
import { BashTool } from './implementations/bash';
import { RecallTool } from './implementations/recall';
import { FileReadTool } from './implementations/file-read';
import { FileWriteTool } from './implementations/file-write';
import { FileEditTool } from './implementations/file-edit';
import { RipgrepSearchTool } from './implementations/ripgrep-search';
import { FileFindTool } from './implementations/file-find';
import { UrlFetchTool } from './implementations/url-fetch';
import { JobOutputTool } from './implementations/job-output';
import { JobsListTool } from './implementations/jobs-list';
import { JobKillTool } from './implementations/job-kill';
import { JobNotifyTool } from './implementations/job-notify';
import { TodoReadTool } from './implementations/todo-read';
import { TodoWriteTool } from './implementations/todo-write';
import { ManageRemindersTool } from './implementations/manage_reminders';

let done = false;
/** The per-session option-taking built-ins; the executor owns their names. */
export const PER_SESSION_BUILTIN_NAMES = new Set(['delegate', 'use_skill']);
export function registerBuiltinTools(): void {
  if (done) return;
  for (const t of [
    new BashTool(), new RecallTool(), new FileReadTool(), new FileWriteTool(), new FileEditTool(),
    new RipgrepSearchTool(), new FileFindTool(), new UrlFetchTool(), new JobOutputTool(), new JobsListTool(),
    new JobKillTool(), new JobNotifyTool(), new TodoReadTool(), new TodoWriteTool(), new ManageRemindersTool(),
  ]) registries.tools.register(t.name, t, 'builtin');
  done = true;
}
```
> Verify each import path/class name against `tools/implementations/index.ts`; adjust to the actual exports. (The exact tool class names match `registerAllAvailableTools`'s current list, minus `DelegateTool`/`UseSkillTool`.)

- [ ] **Step 3: Rewrite `registerAllAvailableTools`** in `tools/executor.ts` to draw from the registry + add the per-session built-ins:
```typescript
  registerAllAvailableTools(skillRegistry?: SkillRegistry, options: RegisterToolsOptions = {}): void {
    // Draw all registry tools (stateless built-ins + plugins). registries.tools is populated
    // at boot (registerBuiltinTools + loadPlugins); identical in root + subagents.
    for (const name of registries.tools.names()) {
      this.registerTool(name, registries.tools.resolve(name));
    }
    // Per-session option-taking built-ins. Fail loud if a plugin claimed their reserved names.
    for (const reserved of PER_SESSION_BUILTIN_NAMES) {
      if (registries.tools.has(reserved)) {
        throw new Error(`plugin registered reserved built-in tool name "${reserved}"`);
      }
    }
    this.registerTool('delegate', new DelegateTool({ personaRegistry: options.personaRegistry }));
    if (skillRegistry) this.registerTool('use_skill', new UseSkillTool(skillRegistry));
  }
```
Add `import { registries } from '@lace/agent/plugins';` and `import { PER_SESSION_BUILTIN_NAMES } from './builtins';`. Remove the old hand-rolled `tools: Tool[]` list (its stateless members now come from the registry).

- [ ] **Step 4: Test** — `tools/__tests__/executor-plugin-tools.test.ts`: with `resetRegistriesForTest()` in `beforeEach`, call `registerBuiltinTools()`, register a plugin tool via `registries.tools.register('echo', echoAdapter, 'vendor')`, build a `ToolExecutor`, `registerAllAvailableTools()`, assert `getTool('echo')` and `getTool('bash')` both defined; and that registering a plugin tool named `delegate` makes `registerAllAvailableTools` throw.

- [ ] **Step 5: Verify + commit** — `npm test -- "exec|executor|builtins"`; `git commit -m "feat(lace/tools): exec discovery + built-ins into api.tools (uniform dup→fatal)"`

## Phase B5 — MCP identity (deferred, D2)

`MCPToolAdapter.executeValidated(args,_context)` ignores ctx and `mcpConnectionKey` omits sessionId — full MCP per-session keying is D2. Do not half-fix (passing identity as a forgeable arg is wrong). Add `// TODO(D2): MCP session keying + identity` at `mcp/tool-adapter.ts:89`. **Invariant until D2:** MCP-adapter tools are barred from the `credentials` capability — the default-deny manifest already does this (an MCP tool has no declared manifest → `pluginMayUseCapability` returns false). State it; the keystone is delivered for in-process + exec adapters, MCP is the known gap.

---

# Part C — Compaction registry domain

Greenfield (no existing registry code — see front matter). Implement the strategy seam + `validatePreserved`, register `track-based`, route the three call sites. The worktree's later breakpoints/tool/regime build on `api.compaction`.

**Code mapped:** `compaction/index.ts` exports `compact` + `CompactionContext`. `compaction/types.ts`: `CompactionContext { threadId; provider?; agent?; modelId? }`. `track-compaction.ts:451` `compact(events: TypedDurableEvent[], ctx): Promise<CompactResult>`; `CompactResult` at `:388-395`; `buildPreservedWithPrefix` at `:501` (prefix-into-leading-user only — does NOT generalize). `storage/event-types.ts:121-132` `ContextCompactedEventData { strategy; preserved: unknown[]; summary?; messagesCompacted? }`. Call sites: `runner.ts:1049-1094`; `rpc/handlers/session-operations.ts:460-525` (hardcoded `strategy !== 'track-based' → throw` at ~:463); `conversation/slash-commands.ts:132-183`.

## Phase C1 — Strategy seam, `validatePreserved`, `track-based` registered

**Files:** Modify `compaction/types.ts`, `compaction/track-compaction.ts`; create `compaction/toolkit.ts`, `compaction/track-strategy.ts`, `compaction/strategy.ts` (+ test).

- [ ] **Step 1: Types** — in `compaction/types.ts`, add `sessionDir` to `CompactionContext`, move `CompactResult` here, add `CompactionStrategy`:
```typescript
import type { TypedDurableEvent, ContextCompactedEventData } from '@lace/agent/storage/event-types';

export interface CompactionContext {
  threadId: string;
  sessionDir: string;        // NEW — present now so the worktree's later resolveModel/guidance don't re-touch call sites
  provider?: AIProvider;
  agent?: CompactionAgent;
  modelId?: string;
}
export type CompactResult =
  | { compactionEvent: { type: 'context_compacted'; data: ContextCompactedEventData } }
  | { noop: true };
export interface CompactionStrategy {
  name: string;
  compact(events: TypedDurableEvent[], ctx: CompactionContext): Promise<CompactResult>;
}
```
In `track-compaction.ts` delete its local `CompactResult` and `import type { CompactResult } from './types';`.

- [ ] **Step 2: Failing tests** — `compaction/strategy.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { validatePreserved, resolveCompactionStrategy, registerBuiltinCompaction } from './strategy';
import { resetRegistriesForTest, registries } from '@lace/agent/plugins';
import type { CompactResult } from './types';
const made = (preserved: unknown[]): CompactResult => ({ compactionEvent: { type: 'context_compacted', data: { type: 'context_compacted', strategy: 'x', preserved } } });

describe('validatePreserved', () => {
  it('passes noop through', () => { expect(validatePreserved({ noop: true })).toEqual({ noop: true }); });
  it('empty/whitespace preserved → noop', () => {
    expect('noop' in validatePreserved(made([]))).toBe(true);
    expect('noop' in validatePreserved(made([{ role: 'user', content: '   ' }]))).toBe(true);
  });
  it('merges consecutive same-role entries', () => {
    const r = validatePreserved(made([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]));
    if (!('noop' in r)) expect((r.compactionEvent.data.preserved as unknown[]).length).toBe(1);
  });
  it('makes the first entry user-role (merges/drops leading assistant)', () => {
    const r = validatePreserved(made([{ role: 'assistant', content: 'x' }, { role: 'user', content: 'y' }]));
    if (!('noop' in r)) expect((r.compactionEvent.data.preserved as Array<{ role: string }>)[0].role).toBe('user');
  });
  it('is idempotent', () => {
    const once = validatePreserved(made([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]));
    expect(validatePreserved(once)).toEqual(once);
  });
});

describe('resolveCompactionStrategy', () => {
  beforeEach(() => { resetRegistriesForTest(); registerBuiltinCompaction(); });
  it('resolves the built-in track-based', () => { expect(resolveCompactionStrategy('track-based').name).toBe('track-based'); });
  it('registers track-based with owner builtin', () => { expect(registries.compaction.owner('track-based')).toBe('builtin'); });
  it('throws on unknown strategy', () => { expect(() => resolveCompactionStrategy('nope')).toThrow(); });
});
```

- [ ] **Step 3: Run FAIL; implement** `compaction/track-strategy.ts`:
```typescript
// ABOUTME: The built-in 'track-based' compaction strategy (wraps compact())
import type { CompactionStrategy } from './types';
import { compact } from './track-compaction';
export const trackBasedStrategy: CompactionStrategy = { name: 'track-based', compact: (e, c) => compact(e, c) };
```

`compaction/toolkit.ts` — promote the existing private stages to exports (`splitAtTailBoundary`, `buildTurnToTrackMap`+`groupEarlierEventsByTrack` as `demuxByTrack`, `buildPreservedTail`, `buildPreservedWithPrefix`, `renderCompactionPrefix`, the Slack renderer — move them out of `track-compaction.ts` unchanged and re-import them there) PLUS author `mergePreservedAdjacent`:
```typescript
// ABOUTME: Replay-legality merge for preserved[] — message-builder replay does NOT repair same-role adjacency
type Block = { type: string; [k: string]: unknown };
interface PreservedEntry { role: string; content: string | Block[]; toolCalls?: unknown[]; toolResults?: unknown[]; }

function isEmpty(e: PreservedEntry): boolean {
  const hasTool = (e.toolCalls?.length ?? 0) > 0 || (e.toolResults?.length ?? 0) > 0;
  if (hasTool) return false;
  if (typeof e.content === 'string') return e.content.trim().length === 0;
  return e.content.length === 0;
}
function mergeContent(a: PreservedEntry['content'], b: PreservedEntry['content']): PreservedEntry['content'] {
  if (typeof a === 'string' && typeof b === 'string') return a.trim() && b.trim() ? `${a}\n${b}` : (a.trim() ? a : b);
  const arr = (c: PreservedEntry['content']): Block[] => typeof c === 'string' ? (c.trim() ? [{ type: 'text', text: c }] : []) : c;
  return [...arr(a), ...arr(b)];
}
function mergeInto(a: PreservedEntry, b: PreservedEntry): PreservedEntry {
  return { role: a.role, content: mergeContent(a.content, b.content),
    toolCalls: [...(a.toolCalls ?? []), ...(b.toolCalls ?? [])],
    toolResults: [...(a.toolResults ?? []), ...(b.toolResults ?? [])] };
}

/** Drop empties, merge consecutive same-role entries, ensure the first entry is user-role.
 *  Returns [] when nothing remains (caller → noop). Idempotent. Image/resource blocks
 *  are preserved verbatim (carried in the Block[] content). */
export function mergePreservedAdjacent(entries: PreservedEntry[]): PreservedEntry[] {
  const out: PreservedEntry[] = [];
  for (const raw of entries) {
    if (isEmpty(raw)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === raw.role) out[out.length - 1] = mergeInto(prev, raw);
    else out.push(raw);
  }
  // Ensure leading user-role: merge a leading assistant forward, else drop it.
  while (out.length > 0 && out[0].role !== 'user') {
    if (out.length === 1) { out.shift(); break; }
    const merged = mergeInto({ ...out[1], role: out[1].role }, out[0]); // fold assistant content into the next entry
    out.splice(0, 2, { ...merged, role: out[1].role });
  }
  return out;
}
export type { PreservedEntry };
```
> Refactor `track-compaction.ts`'s `compact()` to import the promoted toolkit functions (no behavior change — C3 golden guards bytes). `mergePreservedAdjacent` is **new** (the prior `buildPreservedWithPrefix` does not generalize).

`compaction/strategy.ts`:
```typescript
// ABOUTME: Compaction registry seam — register built-ins, resolve by name, enforce replay-legality
import { registries } from '@lace/agent/plugins';
import type { CompactionStrategy, CompactResult } from './types';
import { trackBasedStrategy } from './track-strategy';
import { mergePreservedAdjacent, type PreservedEntry } from './toolkit';

let done = false;
export function registerBuiltinCompaction(): void {
  if (done) return;
  registries.compaction.register('track-based', trackBasedStrategy, 'builtin');
  done = true;
}
export function resolveCompactionStrategy(name: string): CompactionStrategy { return registries.compaction.resolve(name); }

export function validatePreserved(result: CompactResult): CompactResult {
  if ('noop' in result) return result;
  const repaired = mergePreservedAdjacent(result.compactionEvent.data.preserved as PreservedEntry[]);
  if (repaired.length === 0) return { noop: true };
  return { compactionEvent: { type: 'context_compacted', data: { ...result.compactionEvent.data, preserved: repaired } } };
}
```

- [ ] **Step 4: Run PASS; commit** `feat(lace/compaction): strategy seam + registry + validatePreserved (track-based, owner builtin)`.

## Phase C2 — Route the three call sites; persona selection

**Files:** Modify `config/persona-registry.ts` (additive schema), `storage/event-log.ts` (export), `runner.ts`, `session-operations.ts`, `slash-commands.ts`; create `compaction/select.ts`.

- [ ] **Step 1: Additive persona schema** — in `config/persona-registry.ts` `personaConfigSchema` (`.strict()`), add the full block (declare both keys so the worktree's breakpoint work doesn't re-edit this strict object; only `strategy` is read here):
```typescript
    compaction: z.object({
      strategy: z.string().optional(),
      breakpoints: z.array(z.object({ at: z.number(), action: z.enum(['notify', 'compact']) })).optional(),
    }).strict().optional(),
```

- [ ] **Step 2: Export the persona resolver** — add `export` to `function personaForSessionDir` in `storage/event-log.ts:61` (additive; it is module-private today).

- [ ] **Step 3: `compaction/select.ts`**:
```typescript
// ABOUTME: Resolve the compaction strategy NAME for a session from its persona (default track-based)
import { personaForSessionDir } from '@lace/agent/storage/event-log';
import { personaRegistry } from '@lace/agent/config/persona-registry';
export function compactionStrategyNameForSession(sessionDir: string): string {
  try {
    const persona = personaForSessionDir(sessionDir);
    if (persona) return personaRegistry.parsePersona(persona).config.compaction?.strategy ?? 'track-based';
  } catch { /* default */ }
  return 'track-based';
}
```
> Resolution is also exercised at session open (so a misconfigured strategy fails early): when a persona declares `compaction.strategy`, validate `registries.compaction.has(name)` at `session/new`/`session/resume` and surface a clear error there. Keep the per-compaction resolve inside the runner's existing try/catch so an unknown name degrades to logged-and-skip rather than aborting a turn.

- [ ] **Step 4: Runner site** (`runner.ts:1065`): replace `await compact(...)` with:
```typescript
        const strategy = resolveCompactionStrategy(this.config.persona ? compactionStrategyNameForSession(sessionDir) : 'track-based');
        const raw = await strategy.compact(allEvents as unknown as TypedDurableEvent[], { threadId: sessionId, sessionDir, provider, modelId: modelId ?? undefined });
        const result = validatePreserved(raw);
```
Swap the import `compact` → `import { resolveCompactionStrategy, validatePreserved } from '@lace/agent/compaction/strategy'; import { compactionStrategyNameForSession } from '@lace/agent/compaction/select';`. The `if (!('noop' in result))` write block is unchanged (`validatePreserved` may turn a non-noop into noop — handled).

- [ ] **Step 5: RPC site** (`session-operations.ts:460-525`): delete the hardcoded gate (~:463-465); replace the `compact(events, {...})` call with:
```typescript
      const name = parsed?.strategy ?? compactionStrategyNameForSession(sessionDir);
      const raw = await resolveCompactionStrategy(name).compact(events, { threadId: state.activeSession!.meta.sessionId, sessionDir, provider, modelId: effectiveConfig.modelId });
      const result = validatePreserved(raw);
```
Same imports. An unknown explicit `strategy` now throws via the registry (clearer than the old string check).

- [ ] **Step 6: Slash site** (`slash-commands.ts:132-183`): replace `compact(events, {...}).finally(...)` with:
```typescript
    const name = compactionStrategyNameForSession(sessionDir);
    const raw = await resolveCompactionStrategy(name).compact(events, { threadId: sessionId, sessionDir, provider, modelId: effectiveConfig.modelId }).finally(() => provider.cleanup());
    const result = validatePreserved(raw);
```

- [ ] **Step 7: Bypass audit** — `grep -rn "from '@lace/agent/compaction/track-compaction'\|import { compact }" packages/agent/src` and confirm ONLY these three sites (plus `track-strategy.ts`) call `compact` directly; route any other.

- [ ] **Step 8: Verify + commit** — `npm run typecheck && npm test -- "compaction|runner|session-operations|slash"`; `git commit -m "feat(lace/compaction): route all 3 call sites through the registry; drop hardcoded gate"`

## Phase C3 — Golden (byte-identical) + idempotency + one-loader confirm

- [ ] **Step 1: Capture the golden BEFORE the refactor.** (If C1's toolkit extraction already landed, capture from `git stash`/`git show eb10a780:...` of pre-refactor `compact`.) Build a deterministic event fixture (`compaction/__tests__/_golden-events.ts`: a handful of user/assistant/tool durable events) and snapshot today's `compact()` output to a committed golden JSON.

- [ ] **Step 2: Tests** — `compaction/__tests__/track-golden.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCompactionStrategy, validatePreserved, registerBuiltinCompaction } from '../strategy';
import { resetRegistriesForTest } from '@lace/agent/plugins';
import { goldenEvents, goldenCtx, goldenOutput } from './_golden-events';
describe('track-based golden', () => {
  beforeEach(() => { resetRegistriesForTest(); registerBuiltinCompaction(); });
  it('registry path is byte-identical to the captured pre-refactor output', async () => {
    const raw = await resolveCompactionStrategy('track-based').compact(goldenEvents, goldenCtx);
    expect(JSON.stringify(raw)).toBe(JSON.stringify(goldenOutput));
  });
  it('validatePreserved is a no-op on legacy track-based output (byte-safe seam)', async () => {
    const raw = await resolveCompactionStrategy('track-based').compact(goldenEvents, goldenCtx);
    expect(JSON.stringify(validatePreserved(raw))).toBe(JSON.stringify(raw));
  });
});
```
The no-op-on-legacy test proves the seam doesn't mutate today's bytes; the idempotency test (C1) proves `validatePreserved∘validatePreserved == validatePreserved`.

- [ ] **Step 3: One loader** — `grep -rn "LACE_COMPACTION_PLUGINS" packages/` → expect NONE on this branch (the worktree never shipped it). If present, delete it; the only loader is `LACE_PLUGINS`.

- [ ] **Step 4: Commit** — `git commit -m "test(lace/compaction): golden byte-identical + validatePreserved no-op-on-legacy + idempotent"`

---

# Part D — Personas registry domain

`api.personas` is a second source alongside the disk-backed `PersonaRegistry`. `PersonaDef = ParsedPersona` (set in Part A). Precedence: **user-disk > plugin > bundled**.

**Code mapped:** `config/persona-registry.ts` — `PersonaRegistry` with `parsePersona(name): ParsedPersona`, `hasPersona`, `listAvailablePersonas`, `validatePersona`; sources `userPersonasCache` (disk, overrides) + `bundledPersonasCache`; singleton `personaRegistry`; per-initialize construction at `rpc/handlers/initialize.ts:120`. `ParsedPersona` is exported. Selection at `rpc/handlers/session.ts:418`.

## Phase D1 — Consult `api.personas`

**Files:** Modify `config/persona-registry.ts`; test `config/__tests__/persona-registry-plugins.test.ts`.

- [ ] **Step 1: Failing test**:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { PersonaRegistry } from '@lace/agent/config/persona-registry';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';
const reg = () => new PersonaRegistry({ bundledPersonasPath: '/nonexistent', userPersonasPaths: [] });
describe('PersonaRegistry + api.personas', () => {
  beforeEach(() => resetRegistriesForTest());
  it('resolves a plugin persona', () => {
    registries.personas.register('plugin-researcher', { config: { runtime: { type: 'root' } } as never, body: 'You are a researcher.' }, 'vendor');
    const r = reg();
    expect(r.hasPersona('plugin-researcher')).toBe(true);
    expect(r.parsePersona('plugin-researcher').body).toContain('researcher');
  });
  it('lists plugin personas', () => {
    registries.personas.register('plugin-listed', { config: {} as never, body: 'x' }, 'vendor');
    expect(reg().listAvailablePersonas().some((p) => p.name === 'plugin-listed')).toBe(true);
  });
});
```

- [ ] **Step 2: Run FAIL; implement** — in `config/persona-registry.ts`, `import { registries as pluginRegistries } from '@lace/agent/plugins';` and weave in (disk wins):
```typescript
  hasPersona(name: string): boolean {
    this.loadUserPersonas();
    return this.userPersonasCache.has(name) || pluginRegistries.personas.has(name) || this.bundledPersonasCache.has(name);
  }
  parsePersona(name: string): ParsedPersona {
    this.loadUserPersonas();
    if (!this.userPersonasCache.has(name) && pluginRegistries.personas.has(name)) {
      return pluginRegistries.personas.resolve(name);            // plugin source (user disk still wins)
    }
    this.validatePersona(name);
    /* ...existing disk read + frontmatter parse unchanged... */
  }
```
In `listAvailablePersonas()`, after the user-personas loop and before the bundled loop, add plugin personas respecting `seen`:
```typescript
    for (const name of pluginRegistries.personas.names()) {
      if (!seen.has(name)) { personas.push({ name, isUserDefined: false, path: `plugin:${name}` }); seen.add(name); }
    }
```

- [ ] **Step 3: Verify + commit** — `npm test -- persona`; `git commit -m "feat(lace/personas): resolve plugin-contributed personas via api.personas (disk wins)"`

> Persona-schema NARROWING (docker/egress/cap fields) is NOT here — coupled to `delegate.ts`, lands with the plane (#3).

---

# Part E — Runtimes registry domain (safe deferred construction)

Built-in runtimes register into `api.runtimes`; `createDefaultContainerManager` resolves the runtime by name. The container manager is built in `boot()` **after** `loadPlugins` (so an embedder runtime plugin — the plane — is available); the deferral is made safe (manager set before the RPC observer wires; reaper reassigned, no `readonly` hack).

**Code mapped:** `containers/manager-factory.ts` — `createDefaultContainerManager(platform, sel)` parses `LACE_CONTAINER_RUNTIME ∈ {auto,apple,docker}` via `parseContainerRuntimeSelection` (hard-rejects others), `makeDockerRuntime()` (shim if `LACE_DOCKER_BIN` else direct), wraps in `ContainerManager`. `server.ts:97-122` `createAgentServerState()` builds the manager + `new PerInvocationReaper(containerManager)` synchronously. `server.ts:357` wires `state.containerManager?.setNetworkLifecycleObserver(...)` inside `registerAgentRpcMethods` (optional-chained → silent if null). `containers/startup-reaper.ts` `createContainerManagerForPlatform()`/`runStartupReaper`.

## Phase E1 — Register built-in runtimes; resolve by name

**Files:** Modify `containers/manager-factory.ts`; test `containers/__tests__/manager-factory-registry.test.ts`.

- [ ] **Step 1: Failing test**:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { registerBuiltinRuntimes, createDefaultContainerManager } from '@lace/agent/containers/manager-factory';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';
describe('runtime registry', () => {
  beforeEach(() => { resetRegistriesForTest(); registerBuiltinRuntimes(); });
  it('registers docker + apple built-ins (owner builtin)', () => {
    expect(registries.runtimes.has('docker')).toBe(true);
    expect(registries.runtimes.owner('docker')).toBe('builtin');
  });
  it('auto selects the platform default', () => {
    expect(createDefaultContainerManager('linux', 'auto')).not.toBeNull();
    expect(createDefaultContainerManager('darwin', 'auto')).not.toBeNull();
  });
  it('resolves an embedder runtime by name', () => {
    registries.runtimes.register('plane', { create: () => 'x' } as never, 'vendor');
    expect(createDefaultContainerManager('linux', 'plane')).not.toBeNull();
  });
  it('throws when the selected name is not registered', () => {
    expect(() => createDefaultContainerManager('linux', 'ghost')).toThrow();
  });
});
```

- [ ] **Step 2: Run FAIL; implement** — in `manager-factory.ts`, add `import { registries } from '@lace/agent/plugins';`, a `registerBuiltinRuntimes`, and make the factory resolve by name (delete `parseContainerRuntimeSelection`):
```typescript
let builtinsRegistered = false;
export function registerBuiltinRuntimes(): void {
  if (builtinsRegistered) return;
  registries.runtimes.register('docker', makeDockerRuntime(), 'builtin'); // shim or direct per LACE_DOCKER_BIN
  registries.runtimes.register('apple', new AppleContainerRuntime(), 'builtin');
  builtinsRegistered = true;
}
export function createDefaultContainerManager(
  platform: NodeJS.Platform = process.platform,
  runtimeSelection: string | undefined = process.env[CONTAINER_RUNTIME_ENV],
): ContainerManager | null {
  const sel = runtimeSelection?.trim().toLowerCase() || 'auto';
  const name = sel === 'auto'
    ? (platform === 'linux' ? 'docker' : platform === 'darwin' ? 'apple' : null)
    : sel;
  if (name === null) { logger.debug('containers.manager_factory.unsupported_platform', { platform }); return null; }
  if (!registries.runtimes.has(name)) {
    throw new Error(`${CONTAINER_RUNTIME_ENV}="${name}" but no runtime registered under that name`);
  }
  return new ContainerManager(registries.runtimes.resolve(name));
}
```
Keep imports of `DockerContainerRuntime`/`ShimContainerRuntime` (used by `makeDockerRuntime`) + `AppleContainerRuntime`. #3 later removes the docker impls and registers the plane.

- [ ] **Step 3: Run PASS; commit** `feat(lace/runtimes): register built-in runtimes; resolve container runtime by name`.

## Phase E2 — Defer manager construction into `boot()` (safely)

**Files:** Modify `server.ts` (`createAgentServerState`), `main.ts` (`boot()`), and any test/harness that called `createAgentServerState()` expecting a non-null manager.

- [ ] **Step 1: Defer in `createAgentServerState`** (`server.ts:97-122`):
```typescript
  // Resolved in boot() AFTER built-ins + plugins register (the plane is a runtime plugin).
  containerManager: null,
  perInvocationReaper: new PerInvocationReaper(null), // replaced in boot() with the real manager
```
(`PerInvocationReaper` already accepts `null`; we **reassign** the field in boot rather than mutate a `readonly` — no setter needed. Confirm `AgentServerState.containerManager` is typed `ContainerManager | null` and `perInvocationReaper` is not `readonly`; if `readonly`, drop it.)

- [ ] **Step 2: Build in `boot()`** — replace the `buildContainerManager(state)` placeholder from Part A Phase 5 with (it runs AFTER `registerBuiltinRuntimes()` + `loadPlugins`, and BEFORE `registerAgentRpcMethods` so the manager is set when the observer wires):
```typescript
  const manager = createDefaultContainerManager();          // resolves from the now-populated api.runtimes
  state.containerManager = manager;
  state.perInvocationReaper = new PerInvocationReaper(manager);
  void runStartupReaper(manager);                            // moved from module top
```
Import `createDefaultContainerManager`, `runStartupReaper` in `main.ts`; remove the module-top `void runStartupReaper(createContainerManagerForPlatform())` and the now-unused `createContainerManagerForPlatform` import.

- [ ] **Step 3: Make the observer wiring non-silent** — at `server.ts:357`, since the manager is now guaranteed set before `registerAgentRpcMethods` runs in boot, keep the call but make a null manager loud rather than silently skipped:
```typescript
  if (state.containerManager) state.containerManager.setNetworkLifecycleObserver({ /* ... */ });
  else logger.warn('containers: no manager at RPC wiring — network-lifecycle observer NOT installed');
```
(Replaces the silent `?.` so a future ordering regression is visible, not invisible.)

- [ ] **Step 4: Fix affected harnesses** — `grep -rn "createAgentServerState(" packages/agent/src` (tests + in-process harnesses). Any that then exercise container behavior must, after constructing state, run `registerBuiltinRuntimes(); state.containerManager = createDefaultContainerManager(); state.perInvocationReaper = new PerInvocationReaper(state.containerManager);` (or a shared `initContainerManager(state)` test helper — add one if more than ~2 sites need it). Enumerate and update them; this is the "behavior outside main.ts" the review flagged.

- [ ] **Step 5: Verify** — `npm run typecheck && npm test -- "server|containers|reaper|manager-factory"`; then full `npm test` with `LACE_PLUGINS` unset.
- [ ] **Step 6: Commit** — `git commit -m "refactor(lace/runtimes): build container manager in boot() after registry population (safe deferral)"`

> The plane is registered by the embedder (#3) as `api.runtimes.register('plane', planeClient)` (a `runtimes` plugin loaded via `LACE_PLUGINS`) and selected with `LACE_CONTAINER_RUNTIME=plane`; this Part makes that selection resolve. #3 also deletes the docker impls + narrows `ContainerRuntime`.

---

# Final verification (after all Parts)

```bash
npm run typecheck && npm run lint && npm test
```
Expected: green with `LACE_PLUGINS` unset (built-ins only). Confirm: `grep -rn "LACE_COMPACTION_PLUGINS\|PluginCallContext" packages/agent/src` → none (one loader; no vestigial context). `grep -rn "translateTo" packages/agent/src` → none (cleanup PR).

# Self-review / coverage

- **Four registries, each wired:** tools (B: 3 adapters + executor draw + built-ins-into-registry), compaction (C: registry + validatePreserved + 3 routed sites), personas (D: api.personas source), runtimes (E: resolve-by-name + built-ins).
- **Mechanism (A):** loader (meta+manifest), owner-tracking `Registry<T>`, owner-injecting registrars, `assertVersion`, manifest default-deny, boot + subagent reach (tsx, real-ish probe), `resetRegistriesForTest`.
- **Security:** persona keystone via `RunnerConfig.persona` (server-side, args can't reach it); credential gate = `pluginMayUseCapability(registry.owner(name), 'credentials')`, default-deny, builtin allowed, MCP barred until D2. The loader is not a boundary (trusted lace code from the boot allowlist).
- **Boot order (final):** `registerBuiltinTools()` → `registerBuiltinCompaction()` → `registerBuiltinRuntimes()` → `loadPlugins(LACE_PLUGINS)` → build container manager + reaper + startup reaper → attach stdin consumer + wire peer. Built-ins before plugins ⇒ uniform dup→fatal.
- **Mandatory merge order:** A → (B, C, D) → E. Part C edits live compaction sites; Part E edits boot wiring — review those two with care.

# Execution handoff

Execute Part by Part with **subagent-driven-development** (a fresh subagent per Phase, review between). Start with **Part A** — nothing compiles without `plugins/`. Within Part A, do Phase A1→A4 before the A5 boot wiring; the A5 `registerBuiltin*`/`buildContainerManager` calls are filled by Parts B/C/E (keep the existing synchronous manager construction until Part E swaps it in).
