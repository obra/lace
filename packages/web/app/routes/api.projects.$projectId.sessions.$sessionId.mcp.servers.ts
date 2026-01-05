// ABOUTME: Session MCP server list with runtime status from the supervisor-managed agent
// ABOUTME: Shows which servers are actually running in this workspace session context

import { Project } from '@lace/web/lib/server/lace-imports';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { isWorkspaceSessionId } from '@lace/web/lib/validation/session-id-validation';
import { z } from 'zod';

const RouteParamsSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
});

export async function loader({ params }: { params: unknown; context: unknown; request: Request }) {
  try {
    const { projectId, sessionId } = RouteParamsSchema.parse(
      params as { projectId: string; sessionId: string }
    );

    // Verify project exists
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    if (!isWorkspaceSessionId(sessionId)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const supervisor = await getSupervisor();
    const workspaceSession = await supervisor.getWorkspaceSession(sessionId);
    if (!workspaceSession || workspaceSession.projectId !== projectId) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const status = (await supervisor.agentRequest({
      workspaceSessionId: sessionId,
      method: 'ent/agent/status',
      requestParams: {},
    })) as {
      mcpServers?: Array<{
        name: string;
        status: 'connected' | 'connecting' | 'disconnected' | 'error';
        error?: string;
        lastConnected?: string;
      }>;
    };

    const runtimeById = new Map(
      (status.mcpServers ?? []).map((s) => [
        s.name,
        {
          status:
            s.status === 'connected'
              ? 'running'
              : s.status === 'connecting'
                ? 'starting'
                : s.status === 'error'
                  ? 'failed'
                  : 'stopped',
          lastError: s.error,
          connectedAt: s.lastConnected,
        },
      ])
    );

    // Get project configuration to show intended vs actual status
    const projectMCPServers = project.getMCPServers();

    const servers = Object.entries(projectMCPServers).map(([serverId, serverConfig]) => {
      const runtime = runtimeById.get(serverId);

      return {
        id: serverId,
        ...serverConfig,
        // Runtime status from session
        status: runtime?.status || 'stopped',
        lastError: runtime?.lastError,
        connectedAt: runtime?.connectedAt,
      };
    });

    return createSuperjsonResponse({
      projectId,
      sessionId,
      servers,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid route parameters', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }

    console.error('Failed to load session MCP servers:', error);
    return createErrorResponse('Failed to load server status', 500);
  }
}
