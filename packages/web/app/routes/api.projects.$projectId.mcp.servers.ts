// ABOUTME: Project-scoped MCP server list API following Lace project hierarchy patterns
// ABOUTME: Provides project MCP server configurations with inheritance from global config

import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import type { MCPServerConfig } from '@/types/core';

const ProjectIdSchema = z.string().min(1, 'Project ID is required');

const CreateProjectServerSchema = z.object({
  id: z.string().min(1, 'Server ID is required'),
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  enabled: z.boolean().default(true),
  tools: z.record(z.string(), z.string()).default({}),
});

export async function loader({ params }: { params: unknown; context: unknown; request: Request }) {
  try {
    const projectId = ProjectIdSchema.parse((params as { projectId: string }).projectId);

    // Verify project exists and user has access (existing pattern)
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Get effective MCP configuration (global + project merged)
    const mcpServers = project.getMCPServers();

    const servers = Object.entries(mcpServers).map(([serverId, serverConfig]) => ({
      id: serverId,
      ...serverConfig,
    }));

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

    console.error('Failed to load project MCP servers:', error);
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
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const projectId = ProjectIdSchema.parse((params as { projectId: string }).projectId);

    // Verify project exists
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const body = (await request.json()) as unknown;
    const validatedData = CreateProjectServerSchema.parse(body);

    const { id: serverId, ...serverConfig } = validatedData;

    // Check for duplicate server ID in project
    const existingServers = project.getMCPServers();
    if (existingServers[serverId]) {
      return createErrorResponse(`Server '${serverId}' already exists in project`, 400, {
        code: 'DUPLICATE_SERVER',
      });
    }

    // Add server to project using the existing method
    await project.addMCPServer(serverId, serverConfig as MCPServerConfig);

    return createSuperjsonResponse(
      {
        message: 'Project MCP server created successfully',
        server: { id: serverId, ...serverConfig },
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

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to create project server',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
