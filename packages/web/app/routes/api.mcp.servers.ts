// ABOUTME: Global MCP server management API for listing and creating servers
// ABOUTME: Thin wrapper around shared MCP route handlers for global context

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { z } from 'zod';
import {
  listMcpServers,
  createMcpServer,
  CreateServerSchema,
  type McpRouteContext,
} from '@lace/web/lib/server/mcp-route-handlers';
import { errorToResponse, throwMethodNotAllowed } from '@lace/web/lib/server/route-helpers';

// Global context: no projectId
const GLOBAL_CONTEXT: McpRouteContext = {};

export async function loader({
  request: _request,
}: {
  request: Request;
  params: unknown;
  context: unknown;
}) {
  try {
    const servers = await listMcpServers(GLOBAL_CONTEXT);
    return createSuperjsonResponse({ servers });
  } catch (error) {
    return errorToResponse(error, 'Failed to load global MCP configuration');
  }
}

export async function action({ request }: { request: Request; params: unknown; context: unknown }) {
  try {
    if (request.method !== 'POST') {
      throwMethodNotAllowed();
    }

    const body = (await request.json()) as unknown;
    const validatedData = CreateServerSchema.parse(body);

    const { id, ...serverConfig } = validatedData;

    const server = await createMcpServer(GLOBAL_CONTEXT, id, serverConfig);

    return createSuperjsonResponse(
      {
        message: 'Server created successfully',
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

    return errorToResponse(error, 'Failed to create server');
  }
}
