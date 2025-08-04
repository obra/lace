// ABOUTME: Session API endpoints under projects hierarchy - GET sessions by project, POST new session
// ABOUTME: Uses Project class methods for session management with proper project-session relationships

import { NextRequest } from 'next/server';
import { Project, ProviderRegistry } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';

const CreateSessionSchema = z.object({
  name: z.string().min(1, 'Session name is required'),
  description: z.string().optional(),
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

    // Use sessionService to create session, which handles both database and in-memory management
    const sessionService = getSessionService();
    let session;

    if (validatedData.configuration?.providerInstanceId && validatedData.configuration?.modelId) {
      // New provider instance system - pass instance ID and model ID directly
      session = await sessionService.createSession(
        validatedData.name,
        validatedData.configuration.providerInstanceId as string,
        validatedData.configuration.modelId as string,
        projectId
      );
    } else {
      // Old provider system for backward compatibility
      const provider = (validatedData.configuration?.provider as string) || 'anthropic';
      const model = (validatedData.configuration?.model as string) || 'claude-3-5-haiku-20241022';
      
      session = await sessionService.createSession(
        validatedData.name,
        provider,
        model,
        projectId
      );
    }

    return createSuperjsonResponse({ session }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to create session',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
