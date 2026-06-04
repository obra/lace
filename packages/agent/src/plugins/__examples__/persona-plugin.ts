// ABOUTME: Example persona plugin — registers a security-reviewer persona from a file dir
// ABOUTME: through the plugin API. Demonstrates config fields and template variables.
//
// ── PACKAGING CONTRACT ────────────────────────────────────────────────────────
// This plugin ships in a SEPARATE package from @lace/agent. Mark @lace/agent as
// EXTERNAL in your bundler so registry identity (a single shared Map) is preserved.
// Type-only imports are erased at build time and are always safe.
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';

export const meta = {
  name: 'persona-example',
  namespace: 'persona-example',
  version: '1.0.0',
};

// Personas are file-based: <entry>.md files in a sibling directory, with YAML
// frontmatter carrying config fields. The plugin's meta.namespace namespaces
// each file so its logical name becomes <namespace>:<entry>
// (e.g. persona-example:security-reviewer).
//
// The security-reviewer persona: runs in-process (runtime: root), uses a custom
// compaction strategy name, and embeds {{system.sessionDate}} so the rendered
// prompt is date-stamped without requiring additional wiring.

export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.personas.addDir(path.join(__dirname, 'persona-example-personas'));
}

export default { meta, register } satisfies PluginModule;
