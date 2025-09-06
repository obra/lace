// ABOUTME: Individual project MCP server management following established project API patterns
// ABOUTME: Handles CRUD operations for project-specific MCP server configurations

import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';

const RouteParamsSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  serverId: z.string().min(1, 'Server ID is required'),
});

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
    const { projectId, serverId } = RouteParamsSchema.parse(
      params as { projectId: string; serverId: string }
    );

    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404);
    }

    const serverConfig = project.getMCPServer(serverId);
    if (!serverConfig) {
      return createErrorResponse(`MCP server '${serverId}' not found`, 404);
    }

    return createSuperjsonResponse({
      id: serverId,
      ...serverConfig,
    });
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

    console.error('Failed to get project MCP server:', error);
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
    const { projectId, serverId } = RouteParamsSchema.parse(
      params as { projectId: string; serverId: string }
    );

    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404);
    }

    if (request.method === 'PUT') {
      // Update existing project MCP server
      const updates = UpdateServerSchema.parse(await request.json());

      const currentServer = project.getMCPServer(serverId);
      if (!currentServer) {
        return createErrorResponse(`MCP server '${serverId}' not found`, 404);
      }

      // Merge updates with current configuration
      const updatedServer = { ...currentServer, ...updates };
      project.updateMCPServer(serverId, updatedServer);

      return createSuperjsonResponse({
        message: `Project MCP server '${serverId}' updated successfully`,
        server: { id: serverId, ...updatedServer },
      });
    } else if (request.method === 'POST') {
      // Create new project MCP server
      const serverConfig = CreateServerSchema.parse(await request.json());

      // Check for duplicates
      const existingServer = project.getMCPServer(serverId);
      if (existingServer) {
        return createErrorResponse(`Project MCP server '${serverId}' already exists`, 409);
      }

      // Add new server
      project.addMCPServer(serverId, serverConfig);

      return createSuperjsonResponse(
        {
          message: `Project MCP server '${serverId}' created successfully`,
          server: { id: serverId, ...serverConfig },
        },
        { status: 201 }
      );
    } else if (request.method === 'DELETE') {
      // Delete project MCP server
      const existingServer = project.getMCPServer(serverId);
      if (!existingServer) {
        return createErrorResponse(`MCP server '${serverId}' not found`, 404);
      }

      project.deleteMCPServer(serverId);

      return createSuperjsonResponse({
        message: `Project MCP server '${serverId}' deleted successfully`,
      });
    }

    return createErrorResponse('Method not allowed', 405);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, { details: error.errors });
    }

    console.error('Failed to manage project MCP server:', error);
    return createErrorResponse('Server management failed', 500);
  }
}
