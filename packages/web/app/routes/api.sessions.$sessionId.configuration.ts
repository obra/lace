// ABOUTME: REST API endpoints for session configuration - GET, PUT for configuration management
// ABOUTME: Handles session configuration retrieval and updates with validation and inheritance

import { getSessionService } from '@/lib/server/session-service';
import { ToolCatalog, Project } from '@/lib/server/lace-imports';
import { ToolPolicyResolver } from '../../lib/tool-policy-resolver';
import { ThreadId } from '@/types/core';
import { isValidThreadId as isClientValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import type { Route } from './+types/api.sessions.$sessionId.configuration';

// Type guard for ThreadId using client-safe validation
function isValidThreadId(sessionId: string): sessionId is ThreadId {
  return isClientValidThreadId(sessionId);
}

const ConfigurationSchema = z.object({
  providerInstanceId: z.string().optional(),
  modelId: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'ask', 'deny', 'disable'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional(),
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { sessionId: sessionIdParam } = params as { sessionId: string };

    if (!isValidThreadId(sessionIdParam)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const sessionId = sessionIdParam;
    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const configuration = session.getEffectiveConfiguration();

    // FAST: Get tools from cached discovery instead of creating expensive ToolExecutor
    const projectId = session.getProjectId();
    if (!projectId) {
      return createErrorResponse('Session has no associated project', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Associated project not found', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
    const availableTools = ToolCatalog.getAvailableTools(project);

    // Get project policies for hierarchy resolution
    const projectConfig = project.getConfiguration();

    // Resolve tool policy hierarchy for progressive restriction
    const toolPolicyHierarchy = {
      project: projectConfig.toolPolicies || {},
      session: configuration.toolPolicies || {},
    };

    const resolvedTools = ToolPolicyResolver.resolveSessionToolPolicies(
      availableTools,
      toolPolicyHierarchy
    );

    console.warn('[DEBUG] ToolPolicyResolver result:', JSON.stringify(resolvedTools, null, 2));

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
  switch (request.method) {
    case 'PUT':
      break;
    default:
      return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { sessionId: sessionIdParam } = params as { sessionId: string };

    if (!isValidThreadId(sessionIdParam)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const sessionId = sessionIdParam;
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = ConfigurationSchema.parse(body);

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Update session configuration directly
    session.updateConfiguration(validatedData);
    const configuration = session.getEffectiveConfiguration();

    // FAST: Get tools from cached discovery instead of creating expensive ToolExecutor
    const projectId = session.getProjectId();
    if (!projectId) {
      return createErrorResponse('Session has no associated project', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Associated project not found', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
    const availableTools = ToolCatalog.getAvailableTools(project);

    return createSuperjsonResponse({
      configuration: {
        ...configuration,
        availableTools,
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }

    if (error instanceof Error && error.message === 'Session not found') {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to update configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
