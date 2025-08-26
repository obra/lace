// ABOUTME: API endpoint for sending messages to a specific agent
// ABOUTME: Cleaner agent-focused API instead of thread-based messaging

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { createErrorResponse, createSuccessResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { logger } from '~/utils/logger';
import { EventStreamManager } from '@/lib/event-stream-manager';
import type { ErrorType, ErrorPhase } from '@/types/core';

// Helper to sanitize error text by redacting sensitive info and truncating
function sanitizeErrorText(text?: string): string {
  if (!text) return '';
  
  // Redact API keys and Bearer tokens
  let sanitized = text
    .replace(/sk-[a-zA-Z0-9-_]{20,}/g, 'sk-***REDACTED***')
    .replace(/Bearer\s+[a-zA-Z0-9-_+=\/]{20,}/g, 'Bearer ***REDACTED***')
    .replace(/Authorization:\s*Bearer\s+[a-zA-Z0-9-_+=\/]{20,}/g, 'Authorization: Bearer ***REDACTED***');
  
  // Truncate very long text
  if (sanitized.length > 10000) {
    sanitized = sanitized.substring(0, 10000) + '... (truncated)';
  }
  
  return sanitized;
}

// Helper to safely get agent provider context
function getAgentProviderContext(agent: unknown) {
  try {
    // Type guard for agent with required methods
    if (
      agent && 
      typeof agent === 'object' && 
      'getInfo' in agent && 
      typeof agent.getInfo === 'function'
    ) {
      const info = (agent.getInfo as () => { providerInstanceId?: string; modelId?: string })();
      const providerName = 
        agent && 
        typeof agent === 'object' && 
        'providerInstance' in agent &&
        agent.providerInstance &&
        typeof agent.providerInstance === 'object' &&
        'providerName' in agent.providerInstance
          ? String(agent.providerInstance.providerName)
          : 'unknown';

      return {
        providerInstanceId: info.providerInstanceId || 'unknown',
        modelId: info.modelId || 'unknown',
        providerName,
      };
    }
  } catch {
    // Fall through to default
  }
  
  return {
    providerInstanceId: 'unknown',
    modelId: 'unknown',
    providerName: 'unknown',
  };
}

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

export async function POST(
  request: NextRequest,
  { params }: { params: { agentId: string } }
): Promise<NextResponse> {
  try {
    const { agentId: agentIdParam } = params;

    // Validate agent ID format
    if (!isValidThreadId(agentIdParam)) {
      return createErrorResponse('Invalid agent ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    const agentId = asThreadId(agentIdParam);

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return createErrorResponse('Invalid JSON body', 400, { code: 'VALIDATION_FAILED' });
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
      sessionId = asThreadId(agentId.split('.')[0]!);
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

      // Only broadcast for initialization/validation failures to avoid duplicate events
      if (errorClassification.phase === 'initialization' || errorClassification.phase === 'conversation_processing') {
        const providerContext = getAgentProviderContext(agent);
        const eventStreamManager = EventStreamManager.getInstance();
        eventStreamManager.broadcast({
          type: 'AGENT_ERROR',
          threadId: agentId,
          timestamp: new Date(),
          data: {
            errorType: errorClassification.errorType,
            message: sanitizeErrorText(error instanceof Error ? error.message : String(error)),
            stack: sanitizeErrorText(error instanceof Error ? error.stack : undefined),
            context: {
              phase: errorClassification.phase,
              providerInstanceId: providerContext.providerInstanceId,
              modelId: providerContext.modelId,
              providerName: providerContext.providerName,
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
      }
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
