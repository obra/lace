// ABOUTME: Example plugin demonstrating the capability manifest + version contract.
// ABOUTME: Declares the 'credentials' capability and exercises api.assertVersion(1).
// ABOUTME: Framing: a plugin whose tools will eventually read credentials, so it
// ABOUTME: declares the capability now — forward-looking practice per docs/writing-plugins.md.
//
// ── PACKAGING NOTE ──────────────────────────────────────────────────────────
// This plugin ships separately from @lace/agent. Mark @lace/agent external in
// your bundler so registry identity (a single shared Map) is preserved. Use
// `import type` for everything except the Tool base class, which you must extend.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';

// ── Identity ─────────────────────────────────────────────────────────────────

export const meta = {
  name: 'capability-demo',
  namespace: 'capability-demo',
  version: '1.0.0',
};

// Declare the 'credentials' capability. The loader records this via
// recordManifest(meta.name, manifest).
export const manifest = { capabilities: ['credentials' as const] };

// ── Tool ──────────────────────────────────────────────────────────────────────
// A placeholder tool that would (eventually) read credentials. The credential
// lookup is intentionally deferred — this example only demonstrates that the
// capability is declared, and the tool slot is owned.

class CredentialPingTool extends Tool {
  name = 'capability-demo/credential-ping';
  description =
    'Placeholder: will ping a credential store once the credential path is live. ' +
    'Demonstrates that this plugin owns the tool slot and declares credentials.';
  schema = z.object({
    label: z.string().describe('The credential label to eventually resolve'),
  });

  protected async executeValidated(args: { label: string }, ctx: ToolContext): Promise<ToolResult> {
    // ctx.persona is the authoritative identity — never read it from args.
    const who = ctx.persona ?? 'unknown';
    return this.createResult(
      `[capability-demo] persona="${who}" would resolve credential "${args.label}" ` +
        `(credential path not yet wired; capability declared for forward-compatibility)`
    );
  }
}

// ── register ─────────────────────────────────────────────────────────────────

export function register(api: PluginApi): void {
  // Fail loudly if this plugin is loaded against a kernel with a different
  // plugin-contract major version. Calling this first in register() ensures the
  // mismatch is caught at load time rather than at first tool invocation.
  api.assertVersion(1);

  api.tools.register('capability-demo/credential-ping', new CredentialPingTool());
}

// Compile-time check that this module satisfies the PluginModule contract.
export default { meta, manifest, register } satisfies PluginModule;
