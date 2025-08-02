// ABOUTME: REST API endpoints for project configuration - GET, PUT for configuration management
// ABOUTME: Handles project configuration retrieval and updates with validation and error handling

import { NextRequest } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { z } from 'zod';

const ConfigurationSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'lmstudio', 'ollama']).optional(),
  model: z.string().optional(),
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
      return createSuperjsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    const configuration = project.getConfiguration();

    return createSuperjsonResponse({ configuration });
  } catch (error: unknown) {
    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to fetch configuration' },
      { status: 500 }
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
      return createSuperjsonResponse({ error: 'Project not found' }, { status: 404 });
    }

    project.updateConfiguration(validatedData);

    const configuration = project.getConfiguration();

    return createSuperjsonResponse({ configuration });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createSuperjsonResponse(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return createSuperjsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to update configuration' },
      { status: 500 }
    );
  }
}
