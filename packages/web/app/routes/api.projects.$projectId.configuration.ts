// ABOUTME: REST API endpoints for project configuration - GET, PUT for configuration management
// ABOUTME: Handles project configuration retrieval and updates with validation and error handling

import { Project } from '@lace/web/lib/server/projects/project';
import { ToolPolicyResolver } from '@lace/web/lib/tool-policy-resolver';
import type { ToolPolicy } from '@lace/web/types/core';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { z } from 'zod';
import type { Route } from './+types/api.projects.$projectId.configuration';

const ConfigurationSchema = z.object({
  providerInstanceId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'ask', 'deny', 'disable'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional(),
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const project = Project.getById((params as { projectId: string }).projectId);

    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const configuration = project.getConfiguration();

    const supervisor = await getSupervisor();
    const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();
    const { tools } = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/tools/list',
    })) as { tools: Array<{ name: string }> };
    const availableTools = tools.map((t) => t.name);

    // Resolve tool policy hierarchy for progressive restriction
    // TODO: Get global policies for full hierarchy
    const toolPolicyHierarchy = {
      global: undefined, // TODO: Load actual global policies
      project: configuration.toolPolicies as Record<string, ToolPolicy> | undefined,
    };

    const resolvedTools = ToolPolicyResolver.resolveProjectToolPolicies(
      availableTools,
      toolPolicyHierarchy
    );

    return createSuperjsonResponse({
      configuration: {
        ...configuration,
        availableTools,
        tools: resolvedTools,
      },
    });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'PUT') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = ConfigurationSchema.parse(body);

    const project = Project.getById((params as { projectId: string }).projectId);

    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Validate provider instance if provided
    if (validatedData.providerInstanceId) {
      const supervisor = await getSupervisor();
      const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();
      const { connections } = (await supervisor.agentRequest({
        workspaceSessionId,
        sessionId: agentSessionId,
        method: 'ent/connections/list',
      })) as { connections: Array<{ connectionId: string; name: string }> };

      if (!connections.some((c) => c.connectionId === validatedData.providerInstanceId)) {
        return createErrorResponse('Provider instance not found', 400, {
          code: 'VALIDATION_FAILED',
          details: {
            availableInstances: connections.map((c) => ({
              id: c.connectionId,
              name: c.name,
            })),
          },
        });
      }
    }

    // Validate progressive restriction if toolPolicies are being updated
    if (validatedData.toolPolicies) {
      // TODO: Add global policy validation when global configuration is available
      // For now, project level has no restrictions (can set any policy)
    }

    project.updateConfiguration(validatedData as Record<string, unknown>);

    const configuration = project.getConfiguration();

    const supervisor = await getSupervisor();
    const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();
    const { tools } = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/tools/list',
    })) as { tools: Array<{ name: string }> };
    const availableTools = tools.map((t) => t.name);

    return createSuperjsonResponse({
      configuration: {
        ...configuration,
        availableTools,
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      // Provide detailed field-level validation errors
      const fieldErrors: Record<string, string> = {};
      error.errors.forEach((err) => {
        const field = err.path.join('.');
        fieldErrors[field] = err.message;
      });

      const errorMessage = Object.entries(fieldErrors)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join(', ');

      return createErrorResponse(`Validation failed: ${errorMessage}`, 400, {
        code: 'VALIDATION_FAILED',
        details: {
          errors: error.errors,
          fieldErrors,
          summary: errorMessage,
        },
      });
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to update configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
