// ABOUTME: Agent status and health check RPC handlers

import type { JsonRpcPeer } from '@lace/ent-protocol';
import { summarizeDurableEvents } from '../../storage/event-log';
import { derivePendingPermissionsFromDurableEvents } from '../../storage/permissions-from-events';
import type { PermissionRequest } from '@lace/ent-protocol';
import { assertInitialized } from '../utils';
import type { AgentServerState } from '../../server-types';

/**
 * Register agent status and health check handlers with the peer.
 * - ping: Simple health check that returns timestamp
 * - status: Detailed agent status including active session, turn, and permissions
 */
export function registerAgentStatusHandlers(
  peer: JsonRpcPeer,
  state: AgentServerState,
  reissuePendingPermissions: () => Promise<void>
): void {
  peer.onRequest('ent/agent/ping', async (_params: unknown) => {
    assertInitialized(state);
    return { ok: true, timestamp: new Date().toISOString() };
  });

  peer.onRequest('ent/agent/status', async (_params: unknown) => {
    assertInitialized(state);

    const effectiveConfig = state.activeSession?.state.config
      ? { ...state.config, ...state.activeSession.state.config }
      : state.config;

    const sessionSummary = state.activeSession
      ? summarizeDurableEvents(state.activeSession.dir)
      : { messageCount: 0, turnCount: 0, lastActive: undefined };

    // Get session cost and token usage from persisted state
    const sessionCostUsd = state.activeSession?.state.sessionCostUsd ?? 0;
    const tokenUsage = state.activeSession?.state.tokenUsage ?? {
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };
    const tokensUsed = tokenUsage.totalInputTokens + tokenUsage.totalOutputTokens;

    const pendingPermissions: PermissionRequest[] = [];
    if (state.activeSession) {
      const sessionId = state.activeSession.meta.sessionId;
      const pendingRecords = derivePendingPermissionsFromDurableEvents(state.activeSession.dir);
      if (pendingRecords.some((p) => !state.pendingPermissionRequests.has(p.toolCallId))) {
        await reissuePendingPermissions();
      }

      for (const record of pendingRecords) {
        const issued = state.pendingPermissionRequests.get(record.toolCallId);
        if (!issued) continue;
        pendingPermissions.push({
          requestId: issued.requestId,
          toolCallId: record.toolCallId,
          sessionId,
          turnId: record.turnId,
          turnSeq: record.turnSeq,
          jobId: record.jobId,
          tool: record.tool,
          kind: record.kind,
          resource: record.resource,
          options: record.options,
          requestedAt: record.requestedAt,
        });
      }
    }

    const mcpServers = state.mcpServerManager.getAllServers().map((server) => {
      const status =
        server.status === 'running'
          ? 'connected'
          : server.status === 'starting'
            ? 'connecting'
            : server.status === 'failed'
              ? 'error'
              : 'disconnected';

      return {
        name: server.id,
        status,
        ...(server.lastError ? { error: server.lastError } : {}),
        ...(server.connectedAt ? { lastConnected: server.connectedAt.toISOString() } : {}),
      };
    });

    return {
      models: [],
      mcpServers,
      currentSession: state.activeSession
        ? {
            sessionId: state.activeSession.meta.sessionId,
            messageCount: sessionSummary.messageCount,
            turnCount: sessionSummary.turnCount,
            tokensUsed,
            costUsd: sessionCostUsd,
            connectionId: effectiveConfig.connectionId,
            modelId: effectiveConfig.modelId,
          }
        : undefined,
      currentTurn: state.activeTurn
        ? {
            turnId: state.activeTurn.turnId,
            status: state.activeTurn.status,
            startedAt: state.activeTurn.startedAt,
          }
        : undefined,
      pendingPermissions,
      limits: {
        maxBudgetUsd: effectiveConfig.maxBudgetUsd,
        budgetUsedUsd: sessionCostUsd,
      },
    };
  });
}
