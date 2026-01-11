// ABOUTME: Session MCP server control API for runtime server management
// ABOUTME: Controls MCP servers via ent/session/configure on supervisor-managed agents

import { Project } from '@lace/web/lib/server/projects/project';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import {
  requireParam,
  requireSessionId,
  throwNotFound,
  throwMethodNotAllowed,
  errorToResponse,
} from '@lace/web/lib/server/route-helpers';
import { z } from 'zod';
import type { MCPServerConfig } from '@lace/web/types/core';

const ControlActionSchema = z.object({
  action: z.enum(['start', 'stop', 'restart']),
});

/**
 * Build the mcpServers config payload for ent/session/configure.
 * Extracts the repeated object construction from start/stop/restart cases.
 */
function buildMcpServerPayload(
  serverId: string,
  serverConfig: MCPServerConfig,
  enabled: boolean
): { mcpServers: Array<Record<string, unknown>> } {
  return {
    mcpServers: [
      {
        name: serverId,
        command: serverConfig.command,
        ...(serverConfig.args ? { args: serverConfig.args } : {}),
        ...(serverConfig.env ? { env: serverConfig.env } : {}),
        enabled,
        tools: serverConfig.tools,
      },
    ],
  };
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: unknown;
  context: unknown;
}) {
  try {
    if (request.method !== 'POST') {
      throwMethodNotAllowed();
    }

    const typedParams = params as Record<string, string | undefined>;
    const projectId = requireParam(typedParams, 'projectId');
    const sessionId = requireSessionId(typedParams);
    const serverId = requireParam(typedParams, 'serverId');

    const { action: controlAction } = ControlActionSchema.parse(await request.json());

    // Verify project exists
    const project = Project.getById(projectId);
    if (!project) {
      throwNotFound('Project');
    }

    // Verify session exists and belongs to project
    const supervisor = await getSupervisor();
    const workspaceSession = await supervisor.getWorkspaceSession(sessionId);
    if (!workspaceSession || workspaceSession.projectId !== projectId) {
      throwNotFound('Session');
    }

    // Get server configuration from project
    const serverConfig = project.getMCPServer(serverId);
    if (!serverConfig) {
      return createErrorResponse(`MCP server '${serverId}' not found`, 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // Perform the requested action using the shared payload builder
    switch (controlAction) {
      case 'start':
        await supervisor.agentRequest({
          workspaceSessionId: sessionId,
          method: 'ent/session/configure',
          requestParams: buildMcpServerPayload(serverId, serverConfig, true),
        });
        return createSuperjsonResponse({
          message: `Server start initiated for '${serverId}'`,
          serverId,
          status: 'starting',
        });

      case 'stop':
        await supervisor.agentRequest({
          workspaceSessionId: sessionId,
          method: 'ent/session/configure',
          requestParams: buildMcpServerPayload(serverId, serverConfig, false),
        });
        return createSuperjsonResponse({
          message: `Server stop initiated for '${serverId}'`,
          serverId,
          status: 'stopping',
        });

      case 'restart':
        // Stop then start
        await supervisor.agentRequest({
          workspaceSessionId: sessionId,
          method: 'ent/session/configure',
          requestParams: buildMcpServerPayload(serverId, serverConfig, false),
        });
        await supervisor.agentRequest({
          workspaceSessionId: sessionId,
          method: 'ent/session/configure',
          requestParams: buildMcpServerPayload(serverId, serverConfig, true),
        });
        return createSuperjsonResponse({
          message: `Server restart initiated for '${serverId}'`,
          serverId,
          status: 'restarting',
        });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }
    return errorToResponse(error, 'Server control operation failed');
  }
}
