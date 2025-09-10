// ABOUTME: Global MCP server management API for listing and creating servers
// ABOUTME: Provides CRUD operations for global MCP server configurations

import { MCPConfigLoader, ToolCatalog } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import type { MCPServerConfig } from '@/types/core';

const CreateServerSchema = z.object({
  id: z.string().min(1, 'Server ID is required'),
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
  tools: z.record(z.string(), z.string()).default({}),
});

export async function loader({
  request: _request,
}: {
  request: Request;
  params: unknown;
  context: unknown;
}) {
  try {
    // Load global MCP configuration only (no project context)
    const globalConfig = MCPConfigLoader.loadGlobalConfig();

    // Return server list with just configuration (no runtime status)
    const servers = Object.entries(globalConfig?.servers || {}).map(([serverId, serverConfig]) => ({
      id: serverId,
      ...serverConfig,
    }));

    return createSuperjsonResponse({ servers });
  } catch (error) {
    console.error('Failed to load global MCP configuration:', error);
    return createErrorResponse('Failed to load global MCP configuration', 500);
  }
}

export async function action({ request }: { request: Request; params: unknown; context: unknown }) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = (await request.json()) as unknown;
    const validatedData = CreateServerSchema.parse(body);

    const { id, ...serverConfig } = validatedData;

    // Check for duplicate server ID
    const existingConfig = MCPConfigLoader.loadGlobalConfig();
    if (existingConfig?.servers[id]) {
      return createErrorResponse(`Server '${id}' already exists`, 400, {
        code: 'DUPLICATE_SERVER',
      });
    }

    // Save the new server to global configuration
    MCPConfigLoader.updateServerConfig(id, serverConfig as MCPServerConfig);

    // Start async tool discovery (non-blocking)
    await ToolCatalog.discoverAndCacheTools(id, serverConfig as MCPServerConfig);

    return createSuperjsonResponse({
      message: 'Server created successfully',
      server: { id, ...serverConfig },
    });
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

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to create server',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
