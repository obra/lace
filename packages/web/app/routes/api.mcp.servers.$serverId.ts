// ABOUTME: Individual global MCP server management API with CRUD operations
// ABOUTME: Thin wrapper around shared MCP route handlers for global context

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
  requireParam,
  errorToResponse,
  throwMethodNotAllowed,
} from '@lace/web/lib/server/route-helpers';

// Global context: no projectId
const GLOBAL_CONTEXT: McpRouteContext = {};

export async function loader({ params }: { params: unknown; context: unknown; request: Request }) {
  try {
    const serverId = requireParam(params as Record<string, string | undefined>, 'serverId');
    const server = await getMcpServer(GLOBAL_CONTEXT, serverId);
    return createSuperjsonResponse(server);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid server ID', 400, { details: error.errors });
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
    const serverId = requireParam(params as Record<string, string | undefined>, 'serverId');

    if (request.method === 'PUT') {
      const updates = UpdateServerSchema.parse(await request.json());
      const server = await updateMcpServer(GLOBAL_CONTEXT, serverId, updates);

      return createSuperjsonResponse({
        message: `Global MCP server '${serverId}' updated successfully`,
        server,
      });
    } else if (request.method === 'POST') {
      const serverConfig = CreateServerConfigSchema.parse(await request.json());
      const server = await createMcpServer(GLOBAL_CONTEXT, serverId, serverConfig);

      return createSuperjsonResponse(
        {
          message: `Global MCP server '${serverId}' created successfully`,
          server,
        },
        { status: 201 }
      );
    } else if (request.method === 'DELETE') {
      await deleteMcpServer(GLOBAL_CONTEXT, serverId);

      return createSuperjsonResponse({
        message: `Global MCP server '${serverId}' deleted successfully`,
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
