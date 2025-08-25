// ABOUTME: Agent spawning API endpoints for creating and listing agents within a session
// ABOUTME: Agents are child threads (sessionId.N) that run within a session

import { getSessionService } from '@/lib/server/session-service';
import { CreateAgentRequest } from '@/types/api';
import { asThreadId, ThreadId } from '@/types/core';
import { isValidThreadId as isClientValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { setupAgentApprovals } from '@/lib/server/agent-utils';
import { EventStreamManager } from '@/lib/event-stream-manager';
import type { Agent } from '@/lib/server/lace-imports';
import type { Route } from './+types/api.sessions.$sessionId.agents';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

// Type guard for CreateAgentRequest
function isCreateAgentRequest(body: unknown): body is CreateAgentRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    (!('name' in body) || typeof (body as { name: unknown }).name === 'string') &&
    'providerInstanceId' in body &&
    typeof (body as { providerInstanceId: unknown }).providerInstanceId === 'string' &&
    'modelId' in body &&
    typeof (body as { modelId: unknown }).modelId === 'string'
  );
}

// Type guard for ThreadId using client-safe validation
function isValidThreadId(sessionId: string): boolean {
  return isClientValidThreadId(sessionId);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = params;

    if (!isValidThreadId(sessionIdParam)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const sessionId = asThreadId(sessionIdParam);

    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Get agents from Session instance
    const agents = session.getAgents();
    return createSuperjsonResponse(agents);
  } catch (_error: unknown) {
    return createErrorResponse('Internal server error', 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = params;

    if (!isValidThreadId(sessionIdParam)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const sessionId = asThreadId(sessionIdParam);

    // Parse and validate request body
    const bodyData: unknown = await request.json();

    if (!isCreateAgentRequest(bodyData)) {
      return createErrorResponse('Invalid request body', 400, { code: 'VALIDATION_FAILED' });
    }

    const body: CreateAgentRequest = bodyData;

    // Get session and spawn agent directly
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Spawn agent - agent will validate and create its own provider during initialization
    let agent: Agent;
    try {
      agent = session.spawnAgent({
        name: body.name || '',
        providerInstanceId: body.providerInstanceId,
        modelId: body.modelId,
      });
    } catch (error) {
      // Log full error for server debugging while keeping client response sanitized
      console.error('Failed to spawn agent:', error);
      return createErrorResponse(
        `Failed to spawn agent: ${isError(error) ? error.message : 'Unknown error'}`,
        400,
        { code: 'VALIDATION_FAILED' }
      );
    }

    // Setup agent approvals using utility
    setupAgentApprovals(agent, sessionId);

    // CRITICAL: Setup event handlers for real-time updates
    // Without this, newly spawned agents won't emit events to the UI until page refresh
    await sessionService.setupAgentEventHandlers(agent);

    // Convert to API format - use agent's improved API
    const metadata = agent.getThreadMetadata();
    const tokenUsage = agent.getTokenUsage();

    const agentResponse = {
      threadId: agent.threadId,
      name: agent.name,
      providerInstanceId: body.providerInstanceId,
      modelId: body.modelId,
      status: agent.status,
      createdAt: (metadata?.createdAt as Date) || undefined,
      tokenUsage,
    };

    // Test SSE broadcast
    const sseManager = EventStreamManager.getInstance();
    const testEvent = {
      type: 'LOCAL_SYSTEM_MESSAGE' as const,
      threadId: agentResponse.threadId as ThreadId,
      timestamp: new Date(),
      data: `Agent "${agentResponse.name}" spawned successfully`,
      context: {
        sessionId,
        projectId: undefined,
        taskId: undefined,
        agentId: undefined,
      },
    };
    sseManager.broadcast(testEvent);

    return createSuperjsonResponse(agentResponse, {
      status: 201,
      headers: {
        Location: `/api/agents/${agent.threadId}`,
      },
    });
  } catch (error: unknown) {
    if (isError(error) && error.message === 'Session not found') {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    return createErrorResponse('Internal server error', 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
