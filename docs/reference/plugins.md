# Plugin System Reference

The contract for extending a lace agent runtime with plugins. For a step-by-step
walkthrough, see [Writing Plugins](../writing-plugins.md).

## Model

Lace is a generic agent kernel. Everything product-specific — extra tools, a
compaction strategy, container runtimes, personas — is contributed by **plugins**
loaded at process startup. There is **one loader** feeding **four typed
registries**.

- **Boot-time, not runtime.** Plugins are loaded once, when the agent process
  starts, from the `LACE_PLUGINS` environment variable. There is no runtime
  enable/disable. (The protocol's `ent/extensions/*` verbs are a separate, generic
  protocol surface and do **not** drive this loader.)
- **Every process loads the same plugins.** The root agent and every subagent run
  the same entrypoint and inherit the same environment, so `LACE_PLUGINS`
  propagates automatically — the registries are identical in the root and in every
  subagent. You do not register anything per-subagent.
- **The loader is not a security boundary.** Plugins are trusted code: the trust
  decision is which specifiers you put in `LACE_PLUGINS` at boot. A loaded plugin
  runs with full process privileges.

## `LACE_PLUGINS`

A comma-separated list of import specifiers, loaded **in order**:

```
LACE_PLUGINS=@acme/lace-plugin,@acme/lace-extras
```

Each specifier is `await import()`ed. Whitespace around entries is trimmed; empty
entries are ignored (`parsePluginSpec`). A failed import, a module without a
`register()` export, a `register()` that throws, or a duplicate registration is
**fatal** — the loader throws `PluginLoadError` and the process exits. Fail-fast
by design: a misconfigured plugin set never boots a half-wired agent.

Built-in tools/compaction/runtimes are registered **before** plugins load, so a
plugin name that collides with a built-in is a fatal duplicate (see
[Registries](#registries)).

## Plugin module shape

A plugin is a module exporting:

| Export | Required | Purpose |
| --- | --- | --- |
| `register(api: PluginApi): void` | **yes** | Called by the loader; registers entries via `api`. |
| `meta: PluginMeta` | recommended | `{ name, namespace, version }`. Without it the loader falls back to the specifier string as the name. |
| `manifest: CapabilityManifest` | only if declaring capabilities | `{ capabilities: Capability[] }`. |

```ts
import type { PluginApi, PluginModule } from '@lace/agent/plugins';

export const meta = { name: 'acme', namespace: 'acme', version: '1.0.0' };

export function register(api: PluginApi): void {
  api.assertVersion(1);
  // api.tools.register(...), api.compaction.register(...), etc.
}

// Optional compile-time check that the module satisfies the contract:
export default { meta, register } satisfies PluginModule;
```

`PluginMeta`:

```ts
interface PluginMeta { name: string; namespace: string; version: string }
```

`meta.name` is the **owner** recorded for every entry the plugin registers (see
[ownership](#ownership-and-duplicates)). Use a stable, unique name.

## `PluginApi`

The object handed to `register()`. Everything the plugin needs at runtime arrives
through it — never import kernel runtime singletons directly (see
[Packaging](#packaging)).

```ts
interface PluginApi {
  readonly meta: PluginMeta;
  readonly kernelVersion: string;        // e.g. "1.0.0"
  assertVersion(major: number): void;    // throws PluginVersionError on major mismatch
  tools:      PluginRegistrar<Tool>;
  compaction: PluginRegistrar<CompactionStrategy>;
  runtimes:   PluginRegistrar<ContainerRuntime>;
  personas:   PluginRegistrar<PersonaDef>;
}

interface PluginRegistrar<T> { register(name: string, value: T): void }
```

Each `register(name, value)` records the entry under `name` with the plugin's
`meta.name` as owner. You do not pass the owner yourself — the registrar injects
it.

### Versioning

`assertVersion(major)` throws `PluginVersionError` unless `major` equals the
kernel's plugin-contract major version (`KERNEL_PLUGIN_VERSION`, currently
`1.0.0` → major `1`). Call it first in `register()` so a plugin built against an
incompatible kernel fails loudly at load rather than misbehaving later.

## Registries

Four registries, one per extension kind. Each is a `Registry<T>` — a
select-one-by-name table.

| `api` field | Value type | Import the type from | Consumed at |
| --- | --- | --- | --- |
| `tools` | `Tool` | `@lace/agent/tools/tool` | `ToolExecutor.registerAllAvailableTools()` draws every registered tool into each session executor. |
| `compaction` | `CompactionStrategy` | `@lace/agent/compaction/types` | `resolveCompactionStrategy(name)` selects a strategy by name (persona-configured, default `track-based`). |
| `runtimes` | `ContainerRuntime` | `@lace/agent/containers/types` | `createDefaultContainerManager(platform, name)` selects a runtime by name. |
| `personas` | `PersonaDef` | `@lace/agent/plugins` (`PersonaDef`) / `@lace/agent/config/persona-registry` (`ParsedPersona`) | `PersonaRegistry` resolves a persona by name (user-disk overrides plugin overrides bundled). |

### Ownership and duplicates

`Registry<T>` records `(value, owner)` per name. Registration is
**duplicate-fatal**: registering an already-present name throws
`RegistryError: duplicate: "<name>" already registered in <kind>`. This is uniform
for built-ins (owner `'builtin'`) and plugins, so a plugin can never silently
shadow a built-in or another plugin.

→ **Namespace your names** as `<namespace>/<entry>` (e.g. `acme/deploy`). Two
vendors can then both ship a `deploy` tool without colliding, and an accidental
clash is caught at boot.

Registry surface (read paths a plugin or test may use):

```ts
class Registry<T> {
  register(name: string, value: T, owner: string): void; // owner injected by the registrar
  resolve(name: string): T;          // throws RegistryError if absent
  owner(name: string): string;       // who registered it ('builtin' or a plugin name)
  has(name: string): boolean;
  names(): string[];
}
```

The exported `registries` object exposes one of these per kind —
`registries.tools`, `registries.compaction`, `registries.runtimes`,
`registries.personas` — each with the full surface above. In a test you can assert
ownership across all four (e.g. `registries.compaction.owner('acme/strat')`).

## Capability manifest

A plugin declares privileged capabilities in its `manifest`. The model is
**owner-keyed, default-deny**:

```ts
type Capability = 'credentials';
interface CapabilityManifest { capabilities: Capability[] }

pluginMayUseCapability(owner: string, capability: Capability): boolean
// owner 'builtin'           → always true (trusted kernel code)
// owner with the cap declared → true
// otherwise                 → false
```

The loader calls `recordManifest(meta.name, manifest)` for each plugin that
exports one. `pluginMayUseCapability` is the gate consumers query before granting
access.

> **Current status:** the manifest is **recorded but not yet enforced** in
> production — there are no call sites gating behavior on it today. Enforcement of
> the only capability (`credentials`) lands with the credential-path work
> (spec #6, the `credentialSocket` seam). Declare `credentials` now if your plugin
> will need it, but do not assume it currently restricts anything.

## Packaging

A plugin ships as a **separate package** from `@lace/agent`.

- **Mark `@lace/agent` external** in your bundler (esbuild/rollup `external`). If
  you bundle a second copy of `@lace/agent`, you get a second set of registry
  module instances — distinct `Map`s — and your registrations become invisible to
  the kernel. Registry identity depends on a single shared `@lace/agent` instance.
- **`import type { … }` is safe** — type-only imports are erased at build time.
  Import *values* only where unavoidable: the `Tool` base class (you must
  `extends Tool`) is a concrete export you genuinely need; everything else the
  plugin needs is handed in through `api`.
- **Do not import kernel runtime singletons as values** (`registries`, `logger`,
  the loader). Use `api`.

Set `LACE_PLUGINS` to your package specifier in the environment the lace process
(and therefore every subagent) runs in.

## Public exports

From `@lace/agent/plugins`:

```ts
// loader
loadPlugins, parsePluginSpec, PluginLoadError,
type LoadPluginsResult, type LoadPluginsOptions
// api
createPluginApi, makeRegistries, registries, resetRegistriesForTest,
KERNEL_PLUGIN_VERSION, PluginVersionError,
type PluginApi, type PluginMeta, type PluginRegistries,
type PluginRegistrar, type PersonaDef, type PluginModule
// registry
Registry, RegistryError
// manifest
recordManifest, pluginMayUseCapability, resetManifestsForTest,
type Capability, type CapabilityManifest
```

`registries` and `resetRegistriesForTest` are for the kernel and for tests; a
packaged plugin should not touch them at runtime (use `api`).

## Entry-type contracts

The shapes a registry value must satisfy.

### Tool (`@lace/agent/tools/tool`)

Extend the abstract `Tool` class:

```ts
abstract class Tool {
  abstract name: string;
  abstract description: string;
  abstract schema: ZodType;                  // validated before executeValidated runs
  protected abstract executeValidated(
    args: <inferred from schema>,
    context: ToolContext
  ): Promise<ToolResult>;
  // helpers: createResult(content, meta?), createError(content, meta?),
  //          createCancellationResult(partial?, meta?)
}
```

Import `Tool` from `@lace/agent/tools/tool`; import the `ToolResult` and
`ToolContext` types from `@lace/agent/tools/types`.

`ToolContext.persona` is the authoritative session identity, stamped server-side
from the session's persona. A plugin tool reads `context.persona`; tool arguments
**cannot** forge it (the model passing `args.persona` is ignored). This is the
identity keystone — use `context.persona`, never an arg, for who-am-I decisions.

To invoke a tool directly (e.g. in a test), call its **public** `execute`
(not the `protected executeValidated`): `tool.execute(args: unknown, ctx:
ToolContext)`. `ToolContext` has many optional fields; the only **required** one
is `signal: AbortSignal`. A minimal context is
`{ signal: new AbortController().signal, persona: 'researcher' }`.

### CompactionStrategy (`@lace/agent/compaction/types`)

```ts
interface CompactionStrategy {
  name: string;
  compact(events: TypedDurableEvent[], ctx: CompactionContext): Promise<CompactResult>;
}
type CompactResult =
  | { compactionEvent: { type: 'context_compacted'; data: ContextCompactedEventData } }
  | { noop: true };
interface CompactionContext { threadId; sessionDir; provider?; agent?; modelId? }
```

Return `{ noop: true }` when there is nothing to compact — do **not** return a
`compactionEvent` with an empty `preserved`. `ContextCompactedEventData` (from
`@lace/agent/storage/event-types`) requires `strategy: string` and
`preserved: unknown[]`; `summary?: string` and `messagesCompacted?: number` are
optional.

**Reading the input events:** each `TypedDurableEvent` is
`{ eventSeq, timestamp, type, data }`. Filter on the **envelope** `event.type`
(the reliable discriminant) — *not* `event.data.type`, which may be absent on
disk-loaded events. Valid `type` values include `'message'`, `'prompt'`,
`'tool_use'`, `'turn_start'`, `'turn_end'`, `'context_compacted'`, … (see
`event-types.ts` for the full union — there is no `'message_complete'`).

**The toolkit:** `@lace/agent/compaction/toolkit` exports
`mergePreservedAdjacent(entries: PreservedEntry[])` — apply it to your preserved
list so message replay stays legal (drops empties, merges consecutive same-role
entries, ensures a leading user-role entry; returns `[]` when nothing remains →
return `{ noop: true }`). A `PreservedEntry` is
`{ role: string; content: string | Block[]; toolCalls?: unknown[]; toolResults?: unknown[] }`
where `Block = { type: string; [k: string]: unknown }`. This type is internal to
the toolkit — inline the shape; it is not re-exported.

### ContainerRuntime (`@lace/agent/containers/types`)

The heaviest contract — most embedders use the built-in `docker`/`apple` runtimes
rather than writing one. If you do, implement the full interface:

```ts
interface ContainerRuntime {
  // Lifecycle
  create(config: ContainerConfig): string | Promise<string>;   // returns container ID; may be sync
  start(containerId: string): Promise<void>;
  stop(containerId: string, timeout?: number): Promise<void>;
  remove(containerId: string): Promise<void>;
  // Execution
  exec(containerId: string, options: ExecOptions): Promise<ExecResult>;
  execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle>;
  // Information
  inspect(containerId: string): ContainerInfo | Promise<ContainerInfo>;       // in-process cache; may be sync
  list(): ContainerInfo[] | Promise<ContainerInfo[]>;
  daemonInspect(containerId: string): Promise<ContainerInfo | null>;          // live daemon; null if absent
  adopt(config: ContainerConfig, state: ContainerState): Promise<void>;       // re-register a surviving box; idempotent
  // Optional — only runtimes backing the egress gateway implement it
  inspectNetworkIp?(containerId: string, networkName: string): Promise<string | undefined>;
}

interface ExecStreamHandle {
  stdin: Writable; stdout: Readable; stderr: Readable;
  wait(): Promise<{ exitCode: number }>;
  kill(signal?: NodeJS.Signals): void;
}
```

`inspect` reads the in-process cache (and may be synchronous); `daemonInspect`
hits the daemon and returns `null` when the container does not exist — that null
case is how `ContainerManager` adopts boxes after a parent restart. The supporting
types (`ContainerConfig`, `ContainerInfo`, `ContainerState`, `ExecOptions`,
`ExecResult`, `ExecStreamOptions`) are all in `@lace/agent/containers/types`.

### PersonaDef (`@lace/agent/plugins`)

`PersonaDef = ParsedPersona = { config: PersonaConfig; body: string }` — the same
shape a persona `.md` file parses to. `PersonaConfig` (from
`@lace/agent/config/persona-registry`) is:

```ts
interface PersonaConfig {
  model?: string;
  tools?: string[];
  runtime?: { type: 'root' } | { type: 'container'; /* image, mounts, … */ };  // default { type: 'root' }
  compaction?: { strategy?: string; breakpoints?: { at: number; action: 'notify' | 'compact' }[] };
  mcpServers?: Record<string, { command: string; args?: string[]; /* … */ }>;
  maxTurns?: number;
}
```

> **Typing note.** `PersonaConfig` is a Zod **`.strict()`** type, so a partial
> object literal does not satisfy it directly in TypeScript (even a complete one
> trips the strictness in many cases). Either build it via
> `personaConfigSchema.parse(...)`, or — as the examples do for brevity — write the
> literal and cast with `as PersonaDef['config']`.

`body` is the system-prompt template. Plugin persona bodies are rendered via
`engine.renderString(body, context)` (string render), **not** the file-based
`engine.render(name + '.md')` used for disk/bundled personas — so `@path` partial
includes in a plugin body resolve against `.` (cwd), not the template search
dirs. Avoid `@path` includes in plugin persona bodies; mustache variables
(`{{system.os}}`, `{{system.sessionDate}}`, …) work normally.

Precedence: user-disk overrides plugin overrides bundled. Plugin personas are
**not** run through MCP-path resolution — supply absolute/ready config.
