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
import { EventStreamManager } from '@/lib/event-stream-manager';
import type { ErrorType, ErrorPhase } from '@/types/core';

// Request validation schema
const messageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
});


// Utility function to classify agent errors for better categorization
function classifyAgentError(error: unknown): { errorType: ErrorType; phase: ErrorPhase; isRetryable: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // Network/connection errors (timeout, connection issues)
  if (message.includes('ECONNREFUSED') || message.includes('ECONNRESET') || message.includes('ETIMEDOUT')) {
    return { errorType: 'timeout', phase: 'provider_response', isRetryable: true };
  }

  // Authentication errors (provider issues)
  if (message.includes('401') || message.includes('unauthorized') || message.includes('invalid_key')) {
    return { errorType: 'provider_failure', phase: 'initialization', isRetryable: false };
  }

  // Rate limiting (provider issues)
  if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
    return { errorType: 'provider_failure', phase: 'provider_response', isRetryable: true };
  }

  // Validation errors (processing issues)
  if (message.includes('validation') || message.includes('invalid') || message.includes('malformed')) {
    return { errorType: 'processing_error', phase: 'conversation_processing', isRetryable: false };
  }

  // Tool execution errors
  if (message.includes('tool') && (message.includes('failed') || message.includes('error'))) {
    return { errorType: 'tool_execution', phase: 'tool_execution', isRetryable: true };
  }

  // Provider/model errors
  if (message.includes('model') || message.includes('provider') || message.includes('backend')) {
    return { errorType: 'provider_failure', phase: 'provider_response', isRetryable: true };
  }

  // Streaming errors
  if (message.includes('stream') || message.includes('streaming')) {
    return { errorType: 'streaming_error', phase: 'provider_response', isRetryable: true };
  }

  // Check stack trace for more context
  if (stack) {
    if (stack.includes('fetch') || stack.includes('http')) {
      return { errorType: 'timeout', phase: 'provider_response', isRetryable: true };
    }
    if (stack.includes('auth') || stack.includes('token')) {
      return { errorType: 'provider_failure', phase: 'initialization', isRetryable: false };
    }
  }

  // Default classification for unknown errors
  return { errorType: 'provider_failure', phase: 'initialization', isRetryable: true };
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
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
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return createErrorResponse('Unsupported Media Type', 415, {
        code: 'UNSUPPORTED_MEDIA_TYPE',
      });
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
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

      // Use classifyAgentError utility for better error categorization
      const errorClassification = classifyAgentError(error);

      // Emit API-level error event for initialization/validation failures
      const eventStreamManager = EventStreamManager.getInstance();
      eventStreamManager.broadcast({
        type: 'AGENT_ERROR',
        threadId: agentId,
        timestamp: new Date(),
        data: {
          errorType: errorClassification.errorType,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          context: {
            phase: errorClassification.phase,
            // Get provider context from agent
            providerInstanceId: agent.getInfo().providerInstanceId,
            modelId: agent.getInfo().modelId,
            providerName: agent.providerInstance?.providerName,
          },
          isRetryable: errorClassification.isRetryable,
          retryCount: 0,
        },
        transient: true,
        context: {
          projectId: session.getProjectId(),
          sessionId: sessionId,
          agentId: agentId,
        },
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
