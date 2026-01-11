// ABOUTME: Individual project MCP server management following established project API patterns
// ABOUTME: Thin wrapper around shared MCP route handlers for project context

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { z } from 'zod';
import {
  getMcpServer,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  CreateServerConfigSchema,
  UpdateServerSchema,
  type McpRouteContext,
} from '@lace/web/lib/server/mcp-route-handlers';
import {
  requireProjectId,
  requireParam,
  errorToResponse,
  throwMethodNotAllowed,
} from '@lace/web/lib/server/route-helpers';

export async function loader({ params }: { params: unknown; context: unknown; request: Request }) {
  try {
    const typedParams = params as Record<string, string | undefined>;
    const projectId = requireProjectId(typedParams);
    const serverId = requireParam(typedParams, 'serverId');
    const ctx: McpRouteContext = { projectId };

    const server = await getMcpServer(ctx, serverId);
    return createSuperjsonResponse(server);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      if (firstError?.path.includes('projectId')) {
        return createErrorResponse('Invalid project ID', 400, { details: error.errors });
      }
      if (firstError?.path.includes('serverId')) {
        return createErrorResponse('Invalid server ID', 400, { details: error.errors });
      }
      return createErrorResponse('Invalid request parameters', 400, { details: error.errors });
    }
    return errorToResponse(error, 'Failed to load server configuration');
  }
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
    const typedParams = params as Record<string, string | undefined>;
    const projectId = requireProjectId(typedParams);
    const serverId = requireParam(typedParams, 'serverId');
    const ctx: McpRouteContext = { projectId };

    if (request.method === 'PUT') {
      const updates = UpdateServerSchema.parse(await request.json());
      const server = await updateMcpServer(ctx, serverId, updates);

      return createSuperjsonResponse({
        message: `Project MCP server '${serverId}' updated successfully`,
        server,
      });
    } else if (request.method === 'POST') {
      const serverConfig = CreateServerConfigSchema.parse(await request.json());
      const server = await createMcpServer(ctx, serverId, serverConfig);

      return createSuperjsonResponse(
        {
          message: `Project MCP server '${serverId}' created successfully`,
          server,
        },
        { status: 201 }
      );
    } else if (request.method === 'DELETE') {
      await deleteMcpServer(ctx, serverId);

      return createSuperjsonResponse({
        message: `Project MCP server '${serverId}' deleted successfully`,
      });
    }

    throwMethodNotAllowed();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, { details: error.errors });
    }
    return errorToResponse(error, 'Server management failed');
  }
}
