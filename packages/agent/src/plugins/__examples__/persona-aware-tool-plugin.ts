// ABOUTME: Example plugin demonstrating persona-keyed permission checking.
// ABOUTME: The permission set is determined entirely by ctx.persona (server-stamped),
// ABOUTME: never by tool arguments, so the model cannot escalate its own privileges.
//
// ── PACKAGING CONTRACT ────────────────────────────────────────────────────────
// Ships as a SEPARATE package from @lace/agent. Mark @lace/agent EXTERNAL in
// your bundler so there is exactly one registry instance.
// Type-only imports are erased at build time and are safe.
// The only value import from the kernel is the Tool base class (you extends it).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';
import type { PluginApi, PluginModule } from '@lace/agent/plugins';

export const meta = {
  name: 'persona-aware',
  namespace: 'persona-aware',
  version: '1.0.0',
};

// ── Permission table ──────────────────────────────────────────────────────────
// Maps persona names to the set of operation categories they may perform.
// Determined entirely server-side via ctx.persona — tool args cannot override.
const PERSONA_PERMISSIONS: Record<string, ReadonlySet<string>> = {
  admin: new Set(['read', 'write', 'deploy', 'delete']),
  developer: new Set(['read', 'write', 'deploy']),
  reviewer: new Set(['read']),
  researcher: new Set(['read']),
};

function allowedOperations(persona: string | undefined): ReadonlySet<string> {
  if (persona === undefined) return new Set();
  return PERSONA_PERMISSIONS[persona] ?? new Set();
}

// ── Tool ─────────────────────────────────────────────────────────────────────
// Checks whether the current session persona is allowed to perform an operation.
// The persona comes from ctx.persona (server-stamped), not from args.
class CheckPermissionTool extends Tool {
  name = 'persona-aware/check-permission';
  description =
    'Checks whether the session persona is authorized for an operation. ' +
    'The persona is determined server-side; the model cannot override it via arguments.';

  schema = z.object({
    operation: z
      .string()
      .describe('The operation category to check (e.g. "read", "write", "deploy", "delete")'),
  });

  protected async executeValidated(
    args: { operation: string },
    ctx: ToolContext
  ): Promise<ToolResult> {
    const persona = ctx.persona;
    const allowed = allowedOperations(persona).has(args.operation);

    if (persona === undefined) {
      return this.createResult(
        JSON.stringify({
          persona: null,
          operation: args.operation,
          allowed: false,
          reason: 'No persona assigned to this session.',
        })
      );
    }

    return this.createResult(
      JSON.stringify({
        persona,
        operation: args.operation,
        allowed,
        reason: allowed
          ? `Persona '${persona}' is authorized for '${args.operation}'.`
          : `Persona '${persona}' is NOT authorized for '${args.operation}'.`,
      })
    );
  }
}

// ── register ─────────────────────────────────────────────────────────────────
export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.tools.register('persona-aware/check-permission', new CheckPermissionTool());
}

export default { meta, register } satisfies PluginModule;
