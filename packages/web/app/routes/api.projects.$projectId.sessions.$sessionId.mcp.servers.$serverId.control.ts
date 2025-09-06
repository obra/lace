// ABOUTME: Session MCP server control API for runtime server management
// ABOUTME: Handles start/stop/restart operations on session's running MCP servers

import { Project } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { z } from 'zod';

const RouteParamsSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  serverId: z.string().min(1),
});

const ControlActionSchema = z.object({
  action: z.enum(['start', 'stop', 'restart']),
});

export async function action({
  request,
  params,
}: {
  request: Request;
  params: unknown;
  context: unknown;
}) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405);
  }

  // Validate route parameters first
  let projectId: string, sessionId: string, serverId: string;
  try {
    const parsedParams = RouteParamsSchema.parse(
      params as { projectId: string; sessionId: string; serverId: string }
    );
    projectId = parsedParams.projectId;
    sessionId = parsedParams.sessionId;
    serverId = parsedParams.serverId;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid route parameters', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }
    throw error;
  }

  try {
    const { action } = ControlActionSchema.parse(await request.json());

    // Verify project exists
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Verify session exists
    if (!isValidThreadId(sessionId)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Get server configuration from project
    const serverConfig = project.getMCPServer(serverId);
    if (!serverConfig) {
      return createErrorResponse(`MCP server '${serverId}' not found`, 404);
    }

    // Get session's MCP server manager
    const mcpManager = (
      session as { getMCPServerManager: () => unknown }
    ).getMCPServerManager() as {
      startServer: (id: string, config: unknown) => Promise<void>;
      stopServer: (id: string) => Promise<void>;
    };

    try {
      // Perform the requested action
      switch (action) {
        case 'start':
          await mcpManager.startServer(serverId, serverConfig);
          return createSuperjsonResponse({
            message: `Server start initiated for '${serverId}'`,
            serverId,
            status: 'starting',
          });

        case 'stop':
          await mcpManager.stopServer(serverId);
          return createSuperjsonResponse({
            message: `Server stop initiated for '${serverId}'`,
            serverId,
            status: 'stopping',
          });

        case 'restart':
          // Stop then start
          await mcpManager.stopServer(serverId);
          await mcpManager.startServer(serverId, serverConfig);
          return createSuperjsonResponse({
            message: `Server restart initiated for '${serverId}'`,
            serverId,
            status: 'restarting',
          });

        default:
          return createErrorResponse('Invalid action', 400);
      }
    } catch (controlError) {
      console.error(`Failed to ${action} MCP server ${serverId}:`, controlError);
      return createErrorResponse('Server control operation failed', 500);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, { details: error.errors });
    }

    console.error('Failed to control session MCP server:', error);
    return createErrorResponse('Server control operation failed', 500);
  }
}
