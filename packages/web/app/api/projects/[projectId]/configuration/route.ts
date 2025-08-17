// ABOUTME: REST API endpoints for project configuration - GET, PUT for configuration management
// ABOUTME: Handles project configuration retrieval and updates with validation and error handling

import { NextRequest } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';

const ConfigurationSchema = z.object({
  providerInstanceId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const resolvedParams = await params;
    const project = Project.getById(resolvedParams.projectId);

    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const configuration = project.getConfiguration();

    return createSuperjsonResponse({ configuration });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = ConfigurationSchema.parse(body);

    const resolvedParams = await params;
    const project = Project.getById(resolvedParams.projectId);

    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Validate provider instance if provided
    if (validatedData.providerInstanceId) {
      const { ProviderRegistry } = await import('@/lib/server/lace-imports');
      const registry = ProviderRegistry.getInstance();

      const configuredInstances = await registry.getConfiguredInstances();
      const instance = configuredInstances.find(
        (inst) => inst.id === validatedData.providerInstanceId
      );

      if (!instance) {
        return createErrorResponse('Provider instance not found', 400, {
          code: 'VALIDATION_FAILED',
          details: {
            availableInstances: configuredInstances.map((i) => ({
              id: i.id,
              name: (i as { name?: string; displayName: string }).name || i.displayName,
            })),
          },
        });
      }
    }

    project.updateConfiguration(validatedData);

    const configuration = project.getConfiguration();

    return createSuperjsonResponse({ configuration });
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
