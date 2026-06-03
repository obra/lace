# Writing Plugins

A walkthrough for extending a lace agent with your own tools, compaction
strategies, personas, and container runtimes. For the precise contract, see the
[Plugin System Reference](reference/plugins.md).

## What a plugin is

Lace is a generic agent kernel. You add product-specific behavior by writing a
**plugin** — a module that registers entries into the kernel's registries when the
agent process starts. One environment variable, `LACE_PLUGINS`, lists the plugins
to load. Every lace process (the root agent and every subagent) loads the same
set, so your extensions are available everywhere automatically.

You can contribute four kinds of thing:

- **tools** — functions the model can call
- **compaction strategies** — how a long conversation gets summarized
- **personas** — named system-prompt + config bundles for (sub)agents
- **container runtimes** — backends that run containerized work

A single plugin can contribute any mix of these.

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
  name = 'acme/whoami';
  description = 'Reports the persona assigned to this session';
  schema = z.object({});

  protected async executeValidated(_args: {}, ctx: ToolContext): Promise<ToolResult> {
    return this.createResult(`You are running as persona: ${ctx.persona ?? 'unknown'}`);
  }
}

export function register(api: PluginApi): void {
  api.assertVersion(1);                          // fail loudly on kernel major skew
  api.tools.register('acme/whoami', new WhoAmITool());
}

export default { meta, register } satisfies PluginModule;
```

Three things to notice:

1. **`extends Tool`** gives you input validation (your Zod `schema` is enforced
   before `executeValidated` runs) and result helpers (`createResult`,
   `createError`). The argument type is inferred from `schema`.
2. **`ctx.persona` is the authoritative session identity.** It's stamped
   server-side; the model cannot forge it by passing an argument. Use it — never a
   tool arg — for "who am I / what am I allowed to do" decisions.
3. **Namespace the name** (`acme/whoami`). Names are globally unique across all
   plugins and built-ins; a collision is fatal at boot (see [Gotchas](#gotchas)).

### Loading it

Point `LACE_PLUGINS` at your module specifier:

```
LACE_PLUGINS=@acme/lace-plugin
```

The loader imports each listed specifier at startup and calls its `register()`.
Multiple plugins are comma-separated and loaded in order. The tool is now
available to the agent and every subagent.

## Contributing the other kinds

The pattern is identical — register into a different `api` field. Full type shapes
are in the [reference](reference/plugins.md#entry-type-contracts); the essentials:

### A compaction strategy

```ts
import type { CompactionStrategy } from '@lace/agent/compaction/types';
import { mergePreservedAdjacent } from '@lace/agent/compaction/toolkit';

const myStrategy: CompactionStrategy = {
  name: 'acme/aggressive',
  async compact(events, ctx) {
    // ...decide what to preserve...
    // run preserved entries through the toolkit so replay stays legal:
    // const preserved = mergePreservedAdjacent(rawPreserved);
    return { noop: true }; // or { compactionEvent: { type: 'context_compacted', data } }
  },
};
// in register(api):
api.compaction.register('acme/aggressive', myStrategy);
```

A persona selects a strategy by name in its `compaction.strategy` config;
otherwise the built-in `track-based` is used.

### A persona

A persona is data, not code: a config object plus a system-prompt body.

```ts
import type { PersonaDef } from '@lace/agent/plugins';

const researcher: PersonaDef = {
  config: { runtime: { type: 'root' } },        // run in-process (no container)
  body: 'You are Researcher. Today is {{system.sessionDate}}. Be thorough.',
};
// in register(api):
api.personas.register('acme/researcher', researcher);
```

The `body` is rendered with the same variable substitution as disk personas
(e.g. `{{system.os}}`, `{{system.sessionDate}}`). User-disk personas override
plugin personas override bundled ones.

### A container runtime

`ContainerRuntime` is the heaviest contract (lifecycle + exec + inspect +
adopt). Most embedders use the built-in `docker`/`apple` runtimes. If you do need
one, implement the full interface from `@lace/agent/containers/types` and
`api.runtimes.register('acme/mybackend', runtime)`; it becomes selectable by name.

## Testing your plugin

Write an **end-to-end** test: load the plugin through the real loader into the
real registries, then assert it shows up at the real consumption site. No mocks —
that's the point. Mirror the kernel's own `whole-system.integration.test.ts`.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins, registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';
import { ToolExecutor } from '@lace/agent/tools/executor';

describe('acme plugin', () => {
  beforeEach(async () => {
    resetRegistriesForTest();
    registerBuiltinTools();              // built-ins register BEFORE plugins (dup→fatal)
    await loadPlugins('@acme/lace-plugin');
  });

  it('the tool is drawn into a session executor', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    expect(ex.getTool('acme/whoami')).toBeDefined();
    expect(ex.getTool('bash')).toBeDefined();           // built-in still present
    expect(registries.tools.owner('acme/whoami')).toBe('acme');
  });
});
```

Consumption sites for the other kinds (assert against these, real, no mocks):

- compaction → `resolveCompactionStrategy('acme/aggressive').name`
- runtimes → `createDefaultContainerManager(platform, 'acme/mybackend')`
- personas → `new PersonaRegistry({...}).parsePersona('acme/researcher').body`
  (and `.render(name, engine, context)` to check the rendered prompt)

## Packaging for real

Ship the plugin as its **own package**, separate from `@lace/agent`:

- Bundle with esbuild/rollup and mark **`@lace/agent` external**. Bundling a second
  copy of `@lace/agent` creates a second set of registries — your registrations
  become invisible. There must be exactly one `@lace/agent` instance.
- Prefer `import type { … }`. The only value you must import from the kernel is the
  `Tool` base class (you `extends` it). Everything else arrives via `api`.
- Set `LACE_PLUGINS=<your-specifier>` in the environment the agent runs in. Done —
  subagents inherit it.

## Gotchas

- **Duplicate names are fatal.** Registering a name already taken (by a built-in or
  another plugin) throws at boot. Always namespace (`<namespace>/<entry>`).
- **`register()` must not throw** for normal operation — a throwing `register()`
  aborts the whole boot. Validate inputs, but don't do failable I/O at registration
  time; do it lazily inside `executeValidated`/`compact`.
- **`ctx.persona`, not args, for identity.** Repeating because it's the most common
  mistake.
- **The capability manifest is recorded but not yet enforced.** Declaring
  `manifest.capabilities = ['credentials']` is correct forward-looking practice,
  but it does not currently restrict anything — credential enforcement arrives with
  the credential-path work. Don't rely on it as a live security control yet.
- **Registry identity depends on a single `@lace/agent`.** If your tests or build
  accidentally load two copies, registrations vanish silently. Mark it external.
