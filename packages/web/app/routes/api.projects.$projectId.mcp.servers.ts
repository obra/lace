// ABOUTME: Project-scoped MCP server list API following Lace project hierarchy patterns
// ABOUTME: Thin wrapper around shared MCP route handlers for project context

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { z } from 'zod';
import {
  listMcpServers,
  createMcpServer,
  CreateServerSchema,
  type McpRouteContext,
} from '@lace/web/lib/server/mcp-route-handlers';
import {
  requireProjectId,
  errorToResponse,
  throwMethodNotAllowed,
} from '@lace/web/lib/server/route-helpers';

export async function loader({ params }: { params: unknown; context: unknown; request: Request }) {
  try {
    const projectId = requireProjectId(params as Record<string, string | undefined>);
    const ctx: McpRouteContext = { projectId };

    const servers = await listMcpServers(ctx);

    return createSuperjsonResponse({
      projectId,
      servers,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid project ID', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
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
    if (request.method !== 'POST') {
      throwMethodNotAllowed();
    }

    const projectId = requireProjectId(params as Record<string, string | undefined>);
    const ctx: McpRouteContext = { projectId };

    const body = (await request.json()) as unknown;
    const validatedData = CreateServerSchema.parse(body);

    const { id: serverId, ...serverConfig } = validatedData;

    const server = await createMcpServer(ctx, serverId, serverConfig);

    return createSuperjsonResponse(
      {
        message: 'Project MCP server created successfully',
        server,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string> = {};
      error.errors.forEach((err) => {
        const field = err.path.join('.');
        fieldErrors[field] = err.message;
      });

      return createErrorResponse('Validation failed', 400, {
        code: 'VALIDATION_FAILED',
        details: { fieldErrors },
      });
    }

    return errorToResponse(error, 'Failed to create project server');
  }
}
