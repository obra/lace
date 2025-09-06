// ABOUTME: Session MCP server list with runtime status from session's MCPServerManager
// ABOUTME: Shows which servers are actually running in this session context

import { Project } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
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

    // Get session (following existing session API pattern)
    if (!isValidThreadId(sessionId)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Get runtime server status from session's MCPServerManager
    const mcpManager = (
      session as { getMCPServerManager: () => unknown }
    ).getMCPServerManager() as unknown;
    const runningServers = (
      mcpManager as { getAllServers: () => unknown[] }
    ).getAllServers() as unknown[];

    // Get project configuration to show intended vs actual status
    const projectMCPServers = project.getMCPServers();

    const servers = Object.entries(projectMCPServers).map(([serverId, serverConfig]) => {
      const runningServer = runningServers.find(
        (s: unknown) => (s as { id: string }).id === serverId
      ) as { status?: string; lastError?: string; connectedAt?: string } | undefined;

      return {
        id: serverId,
        ...serverConfig,
        // Runtime status from session
        status: runningServer?.status || 'stopped',
        lastError: runningServer?.lastError,
        connectedAt: runningServer?.connectedAt,
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
