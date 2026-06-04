// ABOUTME: Reference plugin — registers a tool, a compaction strategy, a runtime, and a
// ABOUTME: persona through one register(api). The template real plugins (sen) copy.
//
// ── PACKAGING CONTRACT ────────────────────────────────────────────────────────
// A plugin ships in a SEPARATE package from @lace/agent (e.g. sen-core's
// @sen/lace-plugin). It must NOT import @lace/agent runtime singletons as values
// (registries, logger, etc.) — doing so would bundle a second copy of @lace/agent,
// breaking registry identity (two distinct module instances = two distinct Maps).
//
// Build rule: bundle with esbuild/rollup, mark `@lace/agent` as EXTERNAL.
// Type-only imports (`import type …`) are erased at build time and are safe.
// Everything the plugin needs at runtime is handed in through `api`.
//
// Module shape (export at least register; meta + manifest are strongly recommended):
//   register(api)  — required; called by the loader
//   meta           — recommended; loader falls back to the specifier as name
//   manifest       — required when the plugin needs a privileged capability (e.g. credentials)
//
// Name convention: namespace the names you register (`<namespace>:<entry>`) so two
// vendors can each ship a tool named `greet` without colliding. dup→fatal catches
// accidental name clashes at boot.
//
// sen sets  LACE_PLUGINS=@sen/lace-plugin  in the lace child's env; every subagent
// inherits it automatically (spawnSubagent spreads process.env).
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Tool } from '@lace/agent/tools/tool'; // concrete base class; stays external at build
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';
import type { CompactionStrategy } from '@lace/agent/compaction/types';
import type { ContainerRuntime } from '@lace/agent/containers/types';

export const meta = { name: 'reference', namespace: 'reference', version: '1.0.0' };

// Declare any privileged capabilities the plugin needs. The credential path (#6)
// is default-deny: without this declaration, pluginMayUseCapability() returns false.
export const manifest = { capabilities: ['credentials' as const] };

// ── 1) Tool ──────────────────────────────────────────────────────────────────
// Identity (persona) arrives via ctx.persona, stamped server-side by the runner.
// The LLM cannot forge it — args.persona is ignored even if the model passes it.
class GreetTool extends Tool {
  name = 'reference:greet';
  description = 'Greets, echoing the authoritative persona assigned to the session';
  schema = z.object({ who: z.string() });

  protected async executeValidated(args: { who: string }, ctx: ToolContext): Promise<ToolResult> {
    return this.createResult(`hello ${args.who} from persona=${ctx.persona ?? 'unknown'}`);
  }
}

// ── 2) Compaction strategy ────────────────────────────────────────────────────
// Trivial no-op here. A real strategy calls `compact(events, ctx)` from the
// toolkit (compaction/toolkit.ts) and returns a CompactResult.
// NOTE: The `as unknown as ContainerRuntime` cast below is ONLY because this
// example stubs the runtime shape. A real plugin supplies a fully-typed value
// and needs NO cast.
const quietStrategy: CompactionStrategy = {
  name: 'reference:quiet',
  compact: async () => ({ noop: true }),
};

// ── 3) Container runtime ──────────────────────────────────────────────────────
// Stub. A real runtime implements the full ContainerRuntime interface (create,
// start, stop, remove, exec, execStream, inspect, list, daemonInspect, adopt).
// sen's plane client is the real implementation.
const memRuntime = {
  create: () => 'mem-0',
  // ...full ContainerRuntime impl omitted in this stub...
} as unknown as ContainerRuntime;

// ── 4) Persona ────────────────────────────────────────────────────────────────
// Personas are file-based: place <entry>.md files in a sibling directory and
// call api.personas.addDir(absDir). The plugin's meta.namespace namespaces each
// file so its logical name becomes <namespace>:<entry> (e.g. reference:scout).
// YAML frontmatter in the .md carries config fields (runtime, compaction, etc.).

// ── register ─────────────────────────────────────────────────────────────────
export function register(api: PluginApi): void {
  api.assertVersion(1); // fails loudly on kernel-major version skew

  api.tools.register('reference:greet', new GreetTool());
  api.tools.registerExecDir(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference-exec-tools')
  );
  api.compaction.register('reference:quiet', quietStrategy);
  api.runtimes.register('reference:mem', memRuntime);
  api.personas.addDir(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference-personas')
  );
}

// Satisfy PluginModule for type-safe authoring.
// Real plugins: `export { meta, manifest, register } satisfies PluginModule`
// (TypeScript 4.9+).
const _typeCheck: PluginModule = { meta, manifest, register };
void _typeCheck; // prevent 'unused variable' warning — this is type-only
