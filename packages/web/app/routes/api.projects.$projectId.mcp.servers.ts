// ABOUTME: Project-scoped MCP server list API following Lace project hierarchy patterns
// ABOUTME: Provides project MCP server configurations with inheritance from global config

import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';

const ProjectIdSchema = z.string().min(1, 'Project ID is required');

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
