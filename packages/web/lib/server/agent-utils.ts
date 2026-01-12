// ABOUTME: Agent-related server utilities for route handlers
// ABOUTME: Provides helpers for finding and managing agent sessions via supervisor

import { getSupervisor } from '@lace/web/lib/server/supervisor-service';

/**
 * Finds the workspace session that contains the given agent session.
 * Returns both the supervisor instance and the workspace record if found.
 *
 * @param agentSessionId - The agent's Ent protocol session ID
 * @returns The supervisor and workspace record (record is undefined if not found)
 */
export async function findWorkspaceForAgentSession(agentSessionId: string) {
  const supervisor = await getSupervisor();
  const record = (await supervisor.listWorkspaceSessions()).find((ws) =>
    ws.agents.some((a) => a.sessionId === agentSessionId)
  );

  return { supervisor, record };
}
