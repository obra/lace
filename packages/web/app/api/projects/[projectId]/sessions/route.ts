// ABOUTME: Session API endpoints under projects hierarchy - GET sessions by project, POST new session
// ABOUTME: Uses Project class methods for session management with proper project-session relationships

import { NextRequest } from 'next/server';
import { Project, Session } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';

const CreateSessionSchema = z.object({
  name: z.string().min(1, 'Session name is required'),
  description: z.string().optional(),
  providerInstanceId: z.string().min(1, 'Provider instance ID is required'),
  modelId: z.string().min(1, 'Model ID is required'),
  configuration: z.record(z.unknown()).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const sessionData = project.getSessions();

    // Convert SessionData to Session format with agent count for list efficiency
    const sessions = sessionData.map((data) => ({
      id: data.id,
      name: data.name,
      createdAt: data.createdAt,
      agentCount: data.agentCount,
      // Full agent details will be populated when individual session is selected
    }));

    return createSuperjsonResponse({ sessions });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch sessions',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = CreateSessionSchema.parse(body);

    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Clear provider cache to ensure fresh credentials are loaded
    Session.clearProviderCache();

    // Create session using Session.create with project inheritance
    const session = Session.create({
      name: validatedData.name,
      description: validatedData.description,
      projectId,
      configuration: {
        providerInstanceId: validatedData.providerInstanceId,
        modelId: validatedData.modelId,
        ...validatedData.configuration,
      },
    });

    // Convert to API format
    const sessionInfo = session.getInfo();
    const sessionData = {
      id: session.getId(),
      name: sessionInfo?.name || validatedData.name,
      createdAt: sessionInfo?.createdAt || new Date(),
    };

    return createSuperjsonResponse({ session: sessionData }, { status: 201 });
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
      error instanceof Error ? error.message : 'Failed to create session',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
