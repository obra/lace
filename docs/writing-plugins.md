# Writing Plugins

A walkthrough for extending a lace agent with your own tools, compaction
strategies, personas, and container runtimes. For the precise contract, see the
[Plugin System Reference](reference/plugins.md).

## What a plugin is

Lace is a generic agent kernel. You add product-specific behavior by writing a
**plugin** — a module that registers entries into the kernel's registries when
the agent process starts. One environment variable, `LACE_PLUGINS`, lists the
plugins to load. Every lace process (the root agent and every subagent) loads
the same set, so your extensions are available everywhere automatically.

You can contribute several kinds of thing:

- **tools** — functions the model can call (registered by name into the tools registry)
- **compaction strategies** — how a long conversation gets summarized
- **personas** — named system-prompt + config bundles for (sub)agents, contributed as a directory of `.md` files
- **skills** — prompt skill directories, contributed as a directory of skill subdirs
- **exec tools** — standalone executable tools discovered from a directory
- **container runtimes** — backends that run containerized work

A single plugin can contribute any mix of these.

> Bringing in a tool that lives _outside_ the process — a standalone executable
> or an MCP server — is a separate mechanism; see
> [External Tools](external-tools.md).

## Hello, tool

The smallest useful plugin: one tool. A plugin exports `register(api)` and
(recommended) `meta`.

```ts
// acme-plugin.ts
import { z } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';

export const meta = { name: 'acme', namespace: 'acme', version: '1.0.0' };

class WhoAmITool extends Tool {
  name = 'acme:whoami';
  description = 'Reports the persona assigned to this session';
  schema = z.object({});

  protected async executeValidated(
    _args: {},
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.createResult(
      `You are running as persona: ${ctx.persona ?? 'unknown'}`
    );
  }
}

export function register(api: PluginApi): void {
  api.assertVersion(1); // fail loudly on kernel major skew
  api.tools.register('acme:whoami', new WhoAmITool());
}

export default { meta, register } satisfies PluginModule;
```

Three things to notice:

1. **`extends Tool`** gives you input validation (your Zod `schema` is enforced
   before `executeValidated` runs) and result helpers (`createResult`,
   `createError`). The argument type is inferred from `schema`.
2. **`ctx.persona` is the authoritative session identity.** It's stamped
   server-side; the model cannot forge it by passing an argument. Use it — never
   a tool arg — for "who am I / what am I allowed to do" decisions.
3. **Namespace the name** (`acme:whoami`). Plugin-contributed names use
   `<namespace>:<entry>` (colon separator). Names are globally unique across all
   plugins and built-ins; a collision is fatal at boot (see
   [Gotchas](#gotchas)).

### Loading it

Point `LACE_PLUGINS` at your module specifier:

```
LACE_PLUGINS=@acme/lace-plugin
```

The loader imports each listed specifier at startup and calls its `register()`.
Multiple plugins are comma-separated and loaded in order. The tool is now
available to the agent and every subagent.

## Contributing the other kinds

A single `register(api)` may register **any number** of entries — call
`api.tools.register(name, instance)` once per tool. Bundling several related
tools into one **toolset** plugin (e.g. `acme:parse`, `acme:compare`,
`acme:bump`) is a common, encouraged shape.

Registering into a _different_ registry is the same pattern — just a different
`api` field. Full type shapes are in the
[reference](reference/plugins.md#entry-type-contracts); the essentials:

### A compaction strategy

```ts
import type { CompactionStrategy } from '@lace/agent/compaction/types';
import { mergePreservedAdjacent } from '@lace/agent/compaction/toolkit';

const myStrategy: CompactionStrategy = {
  name: 'acme:aggressive',
  async compact(events, ctx) {
    // ...decide what to preserve...
    // run preserved entries through the toolkit so replay stays legal:
    // const preserved = mergePreservedAdjacent(rawPreserved);
    return { noop: true }; // or { compactionEvent: { type: 'context_compacted', data } }
  },
};
// in register(api):
api.compaction.register('acme:aggressive', myStrategy);
```

A persona selects a strategy by name in its `compaction.strategy` frontmatter
config; otherwise the built-in `track-based` is used.

### Personas, skills, and exec tools via directories

Personas and skills are **file-based**: the plugin ships a directory of files
and calls `api.personas.addDir` / `api.skills.addDir`. Exec tools work the same
way via `api.tools.registerExecDir`. All three are synchronously discovered at
boot.

```ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Note: use import.meta.url — __dirname is undefined in ESM (type: module) packages.

export function register(api: PluginApi): void {
  api.assertVersion(1);

  // Contribute personas: each <entry>.md → persona named 'acme:<entry>'
  api.personas.addDir(path.join(__dirname, 'personas'));

  // Contribute skills: each <skill-name>/ dir with SKILL.md → skill named by that dir (bare, not namespaced)
  api.skills.addDir(path.join(__dirname, 'skills'));

  // Contribute exec tools: each +x binary → tool 'acme:<descriptor-name>'
  api.tools.registerExecDir(path.join(__dirname, 'exec-tools'));
}
```

**Naming:** plugin-contributed personas and exec tools are named
`<namespace>:<entry>` where `namespace` is `meta.namespace` (e.g. `acme`) and
`entry` is the file stem (personas) or the `name` returned by
`lace-tool-schema` (exec tools). Skills are **not** namespaced — a skill is
named by its sub-directory name (which must match the `name` field in its
`SKILL.md` frontmatter), bare (e.g. `researcher`, not `acme:researcher`). All
skill sources share a single flat namespace; collisions are first-wins and emit a
`warn`, so choose collision-safe skill names. Built-in and user-defined tool/persona
names stay bare (no prefix). MCP tool names continue to use `<serverId>/<toolName>`
— that slash convention is MCP-specific and unaffected.

**Persona file format:** the same YAML frontmatter + Markdown body used by
user-disk and bundled personas. See [Agent Personas](agent-personas.md) for the
frontmatter fields. Mustache variables (`{{system.os}}`, `{{system.sessionDate}}`,
etc.) work normally; `@path` includes resolve relative to the persona's own
directory.

**Per-persona resources:** a persona at `personas/<entry>.md` may have a sibling
`personas/<entry>/tools/` directory (exec tools active only when that persona is
running) and `personas/<entry>/skills/` (skills injected only for that persona).
Per-persona exec tool descriptor names are bare (not re-namespaced) and can
override a same-named global plugin or core tool — but never a reserved
kernel built-in.

**Precedence:** user-disk personas override plugin personas override bundled
ones. A user who drops a file in `~/.lace/agent-personas/` with the same logical
name silences the plugin version.

See the [reference](reference/plugins.md#personas-and-skills-via-directories)
for the full contract and ESM path note.

### A container runtime

`ContainerRuntime` is the heaviest contract (lifecycle + exec + inspect +
adopt). Most embedders use the built-in `docker`/`apple` runtimes. If you do
need one, implement the full interface from `@lace/agent/containers/types` and
`api.runtimes.register('acme:mybackend', runtime)`; it becomes selectable by
name.

## Testing your plugin

Write an **end-to-end** test: load the plugin through the real loader into the
real registries, then assert it shows up at the real consumption site. No mocks
— that's the point. Mirror the kernel's own template at
`packages/agent/src/plugins/__tests__/whole-system.integration.test.ts` (and the
worked examples in `packages/agent/src/plugins/__examples__/`).

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPlugins,
  registries,
  resetRegistriesForTest,
} from '@lace/agent/plugins';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';
import { ToolExecutor } from '@lace/agent/tools/executor';

describe('acme plugin', () => {
  beforeEach(async () => {
    resetRegistriesForTest();
    registerBuiltinTools(); // built-ins register BEFORE plugins (dup→fatal)
    await loadPlugins('@acme/lace-plugin');
  });

  it('the tool is drawn into a session executor', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    expect(ex.getTool('acme:whoami')).toBeDefined();
    expect(ex.getTool('bash')).toBeDefined(); // built-in still present
    expect(registries.tools.owner('acme:whoami')).toBe('acme');
  });
});
```

`registerBuiltinTools()` (and `registerBuiltinCompaction()` /
`registerBuiltinRuntimes()` for those kinds) must run **before** `loadPlugins` —
built-ins register first so a plugin name clashing with a built-in is a fatal
duplicate. Omit them and your assertions about built-ins coexisting will be
wrong.

Consumption sites for the other kinds (assert against these, real, no mocks):

- compaction → `resolveCompactionStrategy('acme:aggressive').name` (from
  `@lace/agent/compaction/strategy`)
- runtimes → `createDefaultContainerManager(platform, 'acme:mybackend')` (from
  `@lace/agent/containers/manager-factory`)
- personas → `new PersonaRegistry({...}).parsePersona('acme:researcher').body`
  (from `@lace/agent/config/persona-registry`; the plugin must have called
  `api.personas.addDir(dir)` and the dir must contain `researcher.md`)

### Running the test

Tests live in the `packages/agent` package, which has its **own** vitest config
— the repo-root config excludes `packages/**`. Run from inside the package:

```bash
cd packages/agent && npx vitest run src/plugins/__tests__/your-plugin.e2e.test.ts
```

### Loading an in-repo plugin

In production you load a published package (`loadPlugins('@acme/lace-plugin')`).
In an in-repo test, pass a **relative specifier resolved from
`src/plugins/loader.ts`** (the module that does the `import()`). A plugin at
`src/plugins/__examples__/my-plugin.ts` loads as:

```ts
await loadPlugins('./__examples__/my-plugin');
```

### Testing `assertVersion` without a fixture

To exercise version-skew directly, build a live `PluginApi` against scratch
registries — both helpers are exported from `@lace/agent/plugins`:

```ts
import {
  createPluginApi,
  makeRegistries,
  PluginVersionError,
} from '@lace/agent/plugins';

const api = createPluginApi(
  { name: 'x', namespace: 'x', version: '0.0.0' },
  makeRegistries()
);
expect(() => api.assertVersion(2)).toThrow(PluginVersionError); // kernel is major 1
```

## Packaging for real

Ship the plugin as its **own package**, separate from `@lace/agent`:

- Bundle with esbuild/rollup and mark **`@lace/agent` external**. Bundling a
  second copy of `@lace/agent` creates a second set of registries — your
  registrations become invisible. There must be exactly one `@lace/agent`
  instance.
- Prefer `import type { … }`. The only value you must import from the kernel is
  the `Tool` base class (you `extends` it). Everything else arrives via `api`.
- Set `LACE_PLUGINS=<your-specifier>` in the environment the agent runs in. Done
  — subagents inherit it.

## Gotchas

- **Duplicate names are fatal.** Registering a name already taken (by a built-in
  or another plugin) throws at boot. Always namespace with `<namespace>:<entry>`
  (colon separator) for plugin-contributed tools, compaction strategies, and
  runtimes.
- **`register()` must not throw** for normal operation — a throwing `register()`
  aborts the whole boot. Validate inputs, but don't do failable I/O at
  registration time; do it lazily inside `executeValidated`/`compact`.
- **`ctx.persona`, not args, for identity.** Repeating because it's the most
  common mistake.
- **The capability manifest is recorded but not yet enforced.** Declaring
  `manifest.capabilities = ['credentials']` is correct forward-looking practice,
  but it does not currently restrict anything — credential enforcement arrives
  with the credential-path work. Don't rely on it as a live security control
  yet.
- **Registry identity depends on a single `@lace/agent`.** If your tests or
  build accidentally load two copies, registrations vanish silently. Mark it
  external.
- **Repo lint is enforced on commit** (eslint `--fix` + prettier via a
  pre-commit hook). Notably `prefer-const` and `no-unused-vars` — suppress an
  intentionally unused value with `void x`. Run `npx eslint <files> --fix`
  before committing.
