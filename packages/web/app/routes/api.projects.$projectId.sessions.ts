// ABOUTME: Session API endpoints under projects hierarchy - GET sessions by project, POST new session
// ABOUTME: Uses Project class methods for session management with proper project-session relationships

import { Project, Session, ProviderRegistry } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { generateSessionName } from '@/lib/server/session-naming-helper';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { asThreadId } from '@/types/core';
import { z } from 'zod';
import type { Route } from './+types/api.projects.$projectId.sessions';

const CreateSessionSchema = z.object({
  name: z.string().min(1).optional(), // Optional for both flows
  initialMessage: z.string().min(1).optional(), // Optional - new simplified flow
  description: z.string().optional(),
  providerInstanceId: z.string().min(1, 'Provider instance ID is required'),
  modelId: z.string().min(1, 'Model ID is required'),
  configuration: z.record(z.unknown()).optional(),
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { projectId } = params as { projectId: string };
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

    return createSuperjsonResponse(sessions);
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch sessions',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { projectId } = params as { projectId: string };
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = CreateSessionSchema.parse(body);

    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Clear provider cache to ensure fresh credentials are loaded

    // Determine session name - either provided or generated from initialMessage
    let sessionName: string;
    if (validatedData.name) {
      sessionName = validatedData.name;
    } else if (validatedData.initialMessage) {
      // Use full initialMessage as temporary name (will be replaced by AI)
      sessionName = validatedData.initialMessage.trim();
    } else {
      sessionName = 'New Session';
    }

    // Create session using Session.create with project inheritance
    const session = Session.create({
      name: sessionName,
      description: validatedData.description,
      projectId: projectId,
      configuration: {
        ...validatedData.configuration,
        providerInstanceId: validatedData.providerInstanceId,
        modelId: validatedData.modelId,
        initialMessage: validatedData.initialMessage, // Store for pre-filling
      },
    });

    // Convert to API format
    const sessionInfo = session.getInfo();
    const sessionData = {
      id: session.getId(),
      name: sessionInfo?.name || sessionName,
      createdAt: sessionInfo?.createdAt || new Date(),
    };

    // If we have initialMessage, spawn background helper to generate better name
    if (validatedData.initialMessage) {
      void spawnSessionNamingHelper(
        session.getId(),
        projectId,
        project.getName(),
        validatedData.initialMessage,
        {
          providerInstanceId: validatedData.providerInstanceId,
          modelId: validatedData.modelId,
        }
      );
    }

    return createSuperjsonResponse(sessionData, { status: 201 });
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

/**
 * Spawn background helper to generate session name and emit SESSION_UPDATED event
 */
async function spawnSessionNamingHelper(
  sessionId: string,
  projectId: string,
  projectName: string,
  initialMessage: string,
  fallbackModel: { providerInstanceId: string; modelId: string }
): Promise<void> {
  try {
    // Create provider instance for fallback
    const registry = ProviderRegistry.getInstance();
    const fallbackProvider = await registry.createProviderFromInstanceAndModel(
      fallbackModel.providerInstanceId,
      fallbackModel.modelId
    );

    // Generate new session name using helper agent with configured provider
    const generatedName = await generateSessionName(projectName, initialMessage, {
      provider: fallbackProvider,
      modelId: fallbackModel.modelId,
    });

    // Update session name using the generalized update method
    Session.updateSession(sessionId, {
      name: generatedName,
    });

    // Emit SESSION_UPDATED event via SSE
    const eventManager = EventStreamManager.getInstance();
    eventManager.broadcast({
      type: 'SESSION_UPDATED',
      data: {
        name: generatedName,
      },
      context: {
        sessionId,
        projectId,
      },
      transient: true,
    });
  } catch (error) {
    // Log error but don't fail the session creation
    console.error('Failed to generate session name:', error);
  }
}
