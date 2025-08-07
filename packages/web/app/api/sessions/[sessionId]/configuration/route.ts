// ABOUTME: REST API endpoints for session configuration - GET, PUT for configuration management
// ABOUTME: Handles session configuration retrieval and updates with validation and inheritance

import { NextRequest } from 'next/server';
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

const ConfigurationSchema = z.object({
  providerInstanceId: z.string(),
  modelId: z.string(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId: sessionIdParam } = await params;

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
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId: sessionIdParam } = await params;

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

    return createSuperjsonResponse({ configuration });
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
