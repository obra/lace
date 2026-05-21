// ABOUTME: Session MCP server control API for runtime server management
// ABOUTME: Controls MCP servers via ACP session/resume on supervisor-managed agents

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
import type { McpServerConfig } from '@lace/ent-protocol';

const ControlActionSchema = z.object({
  action: z.enum(['start', 'stop', 'restart']),
});

/**
 * Build the mcpServers config payload for session/resume.
 * Extracts the repeated object construction from start/stop/restart cases.
 */
function buildMcpServerPayload(
  serverId: string,
  serverConfig: MCPServerConfig,
  enabled: boolean
): McpServerConfig[] {
  return [
    {
      name: serverId,
      command: serverConfig.command,
      ...(serverConfig.args ? { args: serverConfig.args } : {}),
      ...(serverConfig.env ? { env: serverConfig.env } : {}),
      ...(serverConfig.transport ? { transport: serverConfig.transport } : {}),
      ...(serverConfig.placement ? { placement: serverConfig.placement } : {}),
      ...(serverConfig.secretEnv ? { secretEnv: serverConfig.secretEnv } : {}),
      enabled,
      tools: serverConfig.tools,
    },
  ];
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
    const coordinator = workspaceSession.agents[0];
    if (!coordinator) {
      return createErrorResponse('Session has no coordinator agent', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    // Get server configuration from project
    const serverConfig = project.getMCPServer(serverId);
    if (!serverConfig) {
      return createErrorResponse(`MCP server '${serverId}' not found`, 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    const resumeWithMcpServer = async (enabled: boolean) => {
      await supervisor.agentRequest({
        workspaceSessionId: sessionId,
        sessionId: coordinator.sessionId,
        method: 'session/resume',
        requestParams: {
          sessionId: coordinator.sessionId,
          cwd: workspaceSession.workDir,
          mcpServers: buildMcpServerPayload(serverId, serverConfig, enabled),
        },
      });
    };

    // Perform the requested action using the shared payload builder
    switch (controlAction) {
      case 'start':
        await resumeWithMcpServer(true);
        return createSuperjsonResponse({
          message: `Server start initiated for '${serverId}'`,
          serverId,
          status: 'starting',
        });

      case 'stop':
        await resumeWithMcpServer(false);
        return createSuperjsonResponse({
          message: `Server stop initiated for '${serverId}'`,
          serverId,
          status: 'stopping',
        });

      case 'restart':
        await resumeWithMcpServer(false);
        await resumeWithMcpServer(true);
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
