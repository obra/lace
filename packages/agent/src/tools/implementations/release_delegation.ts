// ABOUTME: release_delegation tool — the consuming parent reclaims a per_invocation
// ABOUTME: child's workspace: destroy the container, then remove /work; close the resume window.

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const releaseDelegationSchema = z
  .object({
    subagentSessionId: NonEmptyString,
  })
  .strict();

export class ReleaseDelegationTool extends Tool {
  name = 'release_delegation';
  description = `Reclaim a completed per_invocation delegation's workspace. Call this when you are **done reading** a subagent's deliverable (the workspace path returned by \`delegate\`).

This destroys the subagent's container and removes its \`/work\` directory, and makes the delegation non-resumable. Only the **parent that created the delegation** can release it; a subagent cannot release a sibling's or its own deliverable.

Parameters:
- \`subagentSessionId\` (required): the subagent session id from the \`delegate\` result.`;
  schema = releaseDelegationSchema;
  annotations: ToolAnnotations = {
    title: 'Release Delegation',
    // Reclaims internal scratch space; no external side effects.
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof releaseDelegationSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { workspaceReaper, activeSessionId } = context;
    const { subagentSessionId } = args;

    if (!workspaceReaper) {
      return fail('release_delegation requires workspaceReaper in context');
    }

    // Serialize against a concurrent resume of the same child.
    return workspaceReaper.runExclusive(subagentSessionId, async () => {
      const entry = workspaceReaper.get(subagentSessionId);
      if (!entry) {
        return fail(
          `No tracked delegation '${subagentSessionId}' — it may already be released, or was not created by this session.`
        );
      }
      // Authorization: only the OWNING parent releases. parentId is the
      // server-injected activeSessionId (never a tool arg), so this is
      // unspoofable. A child's activeSessionId is its own session id, never the
      // owning parent's — so a child cannot release a sibling or its own work.
      if (entry.parentId !== activeSessionId) {
        return fail(
          `Not authorized to release '${subagentSessionId}': it belongs to another session.`
        );
      }

      // dispose: cancelReap → destroy container → rm /work → forget → mark
      // released (closes the resume window; the empty-workspace gate in
      // delegate.ts backstops a crash that loses this in-memory mark).
      await workspaceReaper.dispose(subagentSessionId);

      return {
        status: 'completed' as const,
        content: [{ type: 'text' as const, text: `Released delegation ${subagentSessionId}.` }],
      };
    });
  }
}

function fail(text: string): ToolResult {
  return { status: 'failed', content: [{ type: 'text', text }] };
}
