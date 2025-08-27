// ABOUTME: API endpoint for sending messages to a specific agent
// ABOUTME: Cleaner agent-focused API instead of thread-based messaging

import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { createErrorResponse, createSuccessResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { logger } from '~/utils/logger';
import type { Route } from './+types/api.agents.$agentId.message';

// Request validation schema
const messageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
});

export async function action({ request, params }: Route.ActionArgs) {
  if ((request as Request).method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { agentId: agentIdParam } = params as { agentId: string };

    // Validate agent ID format
    if (!isValidThreadId(agentIdParam as string)) {
      return createErrorResponse('Invalid agent ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    const agentId = asThreadId(agentIdParam);

    // Validate content type
    const req = request as Request;
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return createErrorResponse('Unsupported Media Type', 415, {
        code: 'UNSUPPORTED_MEDIA_TYPE',
      });
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return createErrorResponse('Invalid JSON', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const validation = messageSchema.safeParse(body);

    if (!validation.success) {
      return createErrorResponse('Invalid request body', 400, {
        code: 'VALIDATION_FAILED',
        details: validation.error.errors,
      });
    }

    // Get session service and find the agent
    const sessionService = getSessionService();

    // For coordinator agents, agentId = sessionId
    // For delegate agents, agentId = sessionId.number
    let sessionId = agentId;
    if (agentId.includes('.')) {
      // Extract session ID from delegate agent ID (e.g., "session.1" -> "session")
      const sessionIdStr = agentId.split('.')[0];
      if (!sessionIdStr || !isValidThreadId(sessionIdStr)) {
        return createErrorResponse('Invalid session ID derived from agent ID', 400, {
          code: 'VALIDATION_FAILED',
        });
      }
      sessionId = asThreadId(sessionIdStr);
    }

    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const agent = session.getAgent(agentId);
    if (!agent) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Note: USER_MESSAGE event will be added to thread and broadcast by agent.sendMessage()
    // No need to duplicate the event here

    // Generate message ID
    const messageId = randomUUID();

    // Process message asynchronously
    void agent.sendMessage(validation.data.message).catch((error: unknown) => {
      // Error will be emitted by agent via its error event handlers
      logger.error('Agent message processing error', {
        agentId,
        sessionId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return createSuccessResponse(
      { messageId, agentId, status: 'accepted' },
      202 // Accepted - processing asynchronously
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    logger.error('Agent message endpoint error', { error: errorMessage });
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
