// ABOUTME: Example persona plugin — registers a single PersonaDef (security-reviewer)
// ABOUTME: through the plugin API. Demonstrates config fields and template variables.
//
// ── PACKAGING CONTRACT ────────────────────────────────────────────────────────
// This plugin ships in a SEPARATE package from @lace/agent. Mark @lace/agent as
// EXTERNAL in your bundler so registry identity (a single shared Map) is preserved.
// Type-only imports are erased at build time and are always safe.
// ─────────────────────────────────────────────────────────────────────────────

import type { PluginApi, PluginModule, PersonaDef } from '@lace/agent/plugins';

export const meta = {
  name: 'persona-example',
  namespace: 'persona-example',
  version: '1.0.0',
};

// A security-reviewer persona: runs in-process (runtime: root), uses a custom
// compaction strategy name, and embeds {{system.sessionDate}} so the rendered
// prompt is date-stamped without requiring file-on-disk delivery.
const securityReviewer: PersonaDef = {
  config: {
    runtime: { type: 'root' },
    compaction: { strategy: 'track-based' },
  } as never, // cast: PersonaConfig is strict; partial objects fail Zod unless cast
  body:
    'You are Security Reviewer. Today is {{system.sessionDate}}.\n' +
    'Your job is to inspect code changes for security vulnerabilities: ' +
    'injection flaws, secrets in source, insecure defaults, and privilege escalation. ' +
    'Be concise. Flag severity (critical/high/medium/low) for every finding.',
};

export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.personas.register('persona-example/security-reviewer', securityReviewer);
}

export default { meta, register } satisfies PluginModule;
