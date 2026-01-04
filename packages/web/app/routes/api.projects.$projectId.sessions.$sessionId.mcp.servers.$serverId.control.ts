// ABOUTME: Session MCP server control API for runtime server management
// ABOUTME: Controls MCP servers via ent/session/configure on supervisor-managed agents

import { Project } from '@lace/web/lib/server/lace-imports';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { isWorkspaceSessionId } from '@lace/web/lib/validation/session-id-validation';
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
    if (!isWorkspaceSessionId(sessionId)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const supervisor = getSupervisor();
    const workspaceSession = supervisor.getWorkspaceSession(sessionId);
    if (!workspaceSession || workspaceSession.projectId !== projectId) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Get server configuration from project
    const serverConfig = project.getMCPServer(serverId);
    if (!serverConfig) {
      return createErrorResponse(`MCP server '${serverId}' not found`, 404);
    }

    const peer = supervisor.getPeer(sessionId);

    try {
      // Perform the requested action
      switch (action) {
        case 'start':
          await peer.request('ent/session/configure', {
            mcpServers: [
              {
                name: serverId,
                command: serverConfig.command,
                ...(serverConfig.args ? { args: serverConfig.args } : {}),
                ...(serverConfig.env ? { env: serverConfig.env } : {}),
                enabled: true,
                tools: serverConfig.tools,
              },
            ],
          });
          return createSuperjsonResponse({
            message: `Server start initiated for '${serverId}'`,
            serverId,
            status: 'starting',
          });

        case 'stop':
          await peer.request('ent/session/configure', {
            mcpServers: [
              {
                name: serverId,
                command: serverConfig.command,
                ...(serverConfig.args ? { args: serverConfig.args } : {}),
                ...(serverConfig.env ? { env: serverConfig.env } : {}),
                enabled: false,
                tools: serverConfig.tools,
              },
            ],
          });
          return createSuperjsonResponse({
            message: `Server stop initiated for '${serverId}'`,
            serverId,
            status: 'stopping',
          });

        case 'restart':
          // Stop then start
          await peer.request('ent/session/configure', {
            mcpServers: [
              {
                name: serverId,
                command: serverConfig.command,
                ...(serverConfig.args ? { args: serverConfig.args } : {}),
                ...(serverConfig.env ? { env: serverConfig.env } : {}),
                enabled: false,
                tools: serverConfig.tools,
              },
            ],
          });
          await peer.request('ent/session/configure', {
            mcpServers: [
              {
                name: serverId,
                command: serverConfig.command,
                ...(serverConfig.args ? { args: serverConfig.args } : {}),
                ...(serverConfig.env ? { env: serverConfig.env } : {}),
                enabled: true,
                tools: serverConfig.tools,
              },
            ],
          });
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
