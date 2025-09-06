// ABOUTME: Individual global MCP server management API with CRUD operations
// ABOUTME: Handles GET, PUT, DELETE for specific global MCP servers

import { MCPConfigLoader } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';

const ServerIdSchema = z.string().min(1, 'Server ID is required');

const UpdateServerSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  enabled: z.boolean().optional(),
  tools: z
    .record(
      z.string(),
      z.enum([
        'disable',
        'deny',
        'require-approval',
        'allow-once',
        'allow-session',
        'allow-project',
        'allow-always',
      ])
    )
    .optional(),
});

const CreateServerSchema = z.object({
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  enabled: z.boolean().default(true),
  tools: z
    .record(
      z.string(),
      z.enum([
        'disable',
        'deny',
        'require-approval',
        'allow-once',
        'allow-session',
        'allow-project',
        'allow-always',
      ])
    )
    .default({}),
});

export async function loader({ params }: { params: unknown; context: unknown; request: Request }) {
  try {
    const serverId = ServerIdSchema.parse((params as { serverId: string }).serverId);

    const globalConfig = MCPConfigLoader.loadGlobalConfig();
    const serverConfig = globalConfig?.servers[serverId];

    if (!serverConfig) {
      return createErrorResponse(`Global MCP server '${serverId}' not found`, 404);
    }

    return createSuperjsonResponse({
      id: serverId,
      ...serverConfig,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid server ID', 400, { details: error.errors });
    }

    console.error('Failed to get global MCP server:', error);
    return createErrorResponse('Failed to load server configuration', 500);
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
    const serverId = ServerIdSchema.parse((params as { serverId: string }).serverId);

    if (request.method === 'PUT') {
      // Update existing global server
      const updates = UpdateServerSchema.parse(await request.json());

      const globalConfig = MCPConfigLoader.loadGlobalConfig() || { servers: {} };
      const currentServer = globalConfig.servers[serverId];

      if (!currentServer) {
        return createErrorResponse(`Global MCP server '${serverId}' not found`, 404);
      }

      // Merge updates with current configuration
      const updatedServer = { ...currentServer, ...updates };
      const updatedConfig = {
        ...globalConfig,
        servers: {
          ...globalConfig.servers,
          [serverId]: updatedServer,
        },
      };

      MCPConfigLoader.saveGlobalConfig(updatedConfig);

      return createSuperjsonResponse({
        message: `Global MCP server '${serverId}' updated successfully`,
        server: { id: serverId, ...updatedServer },
      });
    } else if (request.method === 'POST') {
      // Create new global server
      const serverConfig = CreateServerSchema.parse(await request.json());

      const globalConfig = MCPConfigLoader.loadGlobalConfig() || { servers: {} };

      // Check for duplicates
      if (globalConfig.servers[serverId]) {
        return createErrorResponse(`Global MCP server '${serverId}' already exists`, 409);
      }

      // Add new server
      const updatedConfig = {
        ...globalConfig,
        servers: {
          ...globalConfig.servers,
          [serverId]: serverConfig,
        },
      };

      MCPConfigLoader.saveGlobalConfig(updatedConfig);

      return createSuperjsonResponse(
        {
          message: `Global MCP server '${serverId}' created successfully`,
          server: { id: serverId, ...serverConfig },
        },
        { status: 201 }
      );
    } else if (request.method === 'DELETE') {
      // Delete global server
      const globalConfig = MCPConfigLoader.loadGlobalConfig();
      if (!globalConfig?.servers[serverId]) {
        return createErrorResponse(`Global MCP server '${serverId}' not found`, 404);
      }

      const updatedConfig = { ...globalConfig };
      delete updatedConfig.servers[serverId];

      MCPConfigLoader.saveGlobalConfig(updatedConfig);

      return createSuperjsonResponse({
        message: `Global MCP server '${serverId}' deleted successfully`,
      });
    }

    return createErrorResponse('Method not allowed', 405);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, { details: error.errors });
    }

    console.error('Failed to manage global MCP server:', error);
    return createErrorResponse('Server management failed', 500);
  }
}
