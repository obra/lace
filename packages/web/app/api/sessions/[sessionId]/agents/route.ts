// ABOUTME: Agent spawning API endpoints for creating and listing agents within a session
// ABOUTME: Agents are child threads (sessionId.N) that run within a session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ProviderRegistry } from '@/lib/server/lace-imports';
import { CreateAgentRequest } from '@/types/api';
import { asThreadId, ThreadId } from '@/types/core';
import { isValidThreadId as isClientValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { setupAgentApprovals } from '@/lib/server/agent-utils';
import { EventStreamManager } from '@/lib/event-stream-manager';

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;

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

    // Verify provider instance exists
    const registry = ProviderRegistry.getInstance();

    const [configuredInstances, catalogProviders] = await Promise.all([
      registry.getConfiguredInstances(),
      registry.getCatalogProviders(),
    ]);

    const instance = configuredInstances.find((inst) => inst.id === body.providerInstanceId);

    if (!instance) {
      return createErrorResponse(`Provider instance '${body.providerInstanceId}' not found`, 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const catalogProvider = catalogProviders.find((p) => p.id === instance.catalogProviderId);
    if (!catalogProvider) {
      return createErrorResponse(
        `Catalog provider '${instance.catalogProviderId}' not found`,
        400,
        { code: 'VALIDATION_FAILED' }
      );
    }

    // Spawn agent using provider instance configuration
    const agent = session.spawnAgent({
      name: body.name || '',
      providerInstanceId: body.providerInstanceId,
      modelId: body.modelId,
    });

    // Setup agent approvals using utility
    setupAgentApprovals(agent, sessionId);

    // CRITICAL: Setup event handlers for real-time updates
    // Without this, newly spawned agents won't emit events to the UI until page refresh
    sessionService.setupAgentEventHandlers(agent, sessionId);

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
