// ABOUTME: Session detail API endpoint for getting specific session information
// ABOUTME: Returns session metadata and list of agents within the session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId } from '@/types/core';
import { isValidThreadId as isClientValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';

// Type guard for ThreadId using client-safe validation
function isValidThreadId(sessionId: string): sessionId is ThreadId {
  return isClientValidThreadId(sessionId);
}

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;

    if (!isValidThreadId(sessionIdParam)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const sessionId = sessionIdParam;

    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Convert Session instance to metadata for JSON response
    const sessionInfo = session.getInfo();
    const agents = session.getAgents();

    const sessionData = {
      id: session.getId(),
      name: sessionInfo?.name ?? 'Unknown',
      createdAt: sessionInfo?.createdAt.toISOString() ?? new Date().toISOString(),
      agents: agents.map((agent) => ({
        threadId: agent.threadId,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        createdAt: (agent as { createdAt?: string }).createdAt ?? new Date().toISOString(),
      })),
    };

    return createSuperjsonResponse({ session: sessionData });
  } catch (error: unknown) {
    console.error('Error in GET /api/sessions/[sessionId]:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

// Schema for validating session update requests
const UpdateSessionSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived', 'completed']).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;

    if (!isValidThreadId(sessionIdParam)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const sessionId = sessionIdParam;

    // Check if session exists
    const existingSession = await sessionService.getSession(sessionId);
    if (!existingSession) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Parse and validate request body
    const bodyRaw: unknown = await request.json();
    const bodyResult = UpdateSessionSchema.safeParse(bodyRaw);

    if (!bodyResult.success) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: bodyResult.error.errors,
      });
    }

    const updates = bodyResult.data;

    // Update session metadata using SessionService
    sessionService.updateSession(sessionId, {
      ...updates,
      updatedAt: new Date(),
    });

    // Clear the active sessions cache so the session gets reloaded from database with updated info
    sessionService.clearActiveSessions();

    // Get updated session data
    const updatedSession = await sessionService.getSession(sessionId);
    if (!updatedSession) {
      return createErrorResponse('Session not found after update', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    // Get updated session data directly from database to ensure we have the latest values
    const { Session } = await import('@/lib/server/lace-imports');
    const updatedSessionData = Session.getSession(sessionId);
    if (!updatedSessionData) {
      return createErrorResponse('Session not found after update', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    // Convert to API response format
    const agents = updatedSession.getAgents();

    const sessionData = {
      id: updatedSession.getId(),
      name: (updatedSessionData as { name: string }).name,
      description: (updatedSessionData as { description?: string }).description,
      status: (updatedSessionData as { status?: string }).status,
      createdAt: (updatedSessionData as { createdAt: Date }).createdAt.toISOString(),
      agents: agents.map((agent) => ({
        threadId: agent.threadId,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        createdAt: (agent as { createdAt?: string }).createdAt ?? new Date().toISOString(),
      })),
    };

    return createSuperjsonResponse({ session: sessionData });
  } catch (error: unknown) {
    console.error('Error in PATCH /api/sessions/[sessionId]:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
