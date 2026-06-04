// ABOUTME: Production incident-responder persona plugin — registers an IncidentResponder
// ABOUTME: persona with a structured triage methodology, read-only tools allowlist,
// ABOUTME: maxTurns cap, and compaction strategy tuned for long incident threads.
//
// ── PACKAGING CONTRACT ────────────────────────────────────────────────────────
// This plugin ships in a SEPARATE package from @lace/agent. Mark @lace/agent as
// EXTERNAL in your bundler so registry identity (a single shared Map) is preserved.
// Type-only imports are erased at build time and are always safe.
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';

export const meta = {
  name: 'incident-responder',
  namespace: 'incident-responder',
  version: '1.0.0',
};

// Personas are file-based: <entry>.md files in a sibling directory, with YAML
// frontmatter carrying config fields. The plugin's meta.namespace namespaces
// each file so its logical name becomes <namespace>:<entry>
// (e.g. incident-responder:incident-responder).
//
// The incident-responder persona: runs in-process (runtime: root), scoped to
// read-only investigative tools, capped at 40 turns, and uses track-based
// compaction to preserve the key findings thread as the transcript grows.

export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.personas.addDir(path.join(__dirname, 'incident-responder-personas'));
}

export default { meta, register } satisfies PluginModule;
