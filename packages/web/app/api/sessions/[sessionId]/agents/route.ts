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

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

// Type guard for CreateAgentRequest
function isCreateAgentRequest(body: unknown): body is CreateAgentRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    (!('name' in body) || typeof (body as { name: unknown }).name === 'string')
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

    // Allow empty names - spawnAgent will provide default

    // Get session and spawn agent directly
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Resolve provider instance to provider/model for backward compatibility
    let provider = body.provider || 'anthropic';
    let model = body.model || 'claude-3-5-haiku-20241022';

    if (body.providerInstanceId && body.model) {
      // New provider instance system
      const registry = new ProviderRegistry();
      await registry.initialize();
      
      try {
        const catalogProvider = registry.getCatalogProviders()
          .find(p => p.models.some(m => m.id === body.model));
        
        if (catalogProvider) {
          provider = catalogProvider.type; // Use catalog provider type
          model = body.model;
        }
      } catch (_error) {
        // Fallback to provided values if provider instance lookup fails
        provider = body.provider || 'anthropic';
        model = body.model || 'claude-3-5-haiku-20241022';
      }
    }

    const agent = await session.spawnAgent(body.name || '', provider, model);

    // Setup agent approvals using utility
    const { setupAgentApprovals } = await import('@/lib/server/agent-utils');
    setupAgentApprovals(agent, sessionId);

    // CRITICAL: Setup event handlers for real-time updates
    // Without this, newly spawned agents won't emit events to the UI until page refresh
    sessionService.setupAgentEventHandlers(agent, sessionId);

    // Convert to API format - use agent's improved API
    const agentResponse = {
      threadId: agent.threadId,
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      status: agent.status,
      createdAt: new Date(),
    };

    // Test SSE broadcast
    const { EventStreamManager } = await import('@/lib/event-stream-manager');
    const sseManager = EventStreamManager.getInstance();
    const testEvent = {
      type: 'LOCAL_SYSTEM_MESSAGE' as const,
      threadId: agentResponse.threadId as ThreadId,
      timestamp: new Date().toISOString(),
      data: { content: `Agent "${agentResponse.name}" spawned successfully` },
    };
    sseManager.broadcast({
      eventType: 'session',
      scope: { sessionId },
      data: testEvent,
    });

    return createSuperjsonResponse({ agent: agentResponse }, { status: 201 });
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
    return createSuperjsonResponse({
      agents: agents.map((agent) => ({
        threadId: agent.threadId,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        createdAt: new Date(),
      })),
    });
  } catch (_error: unknown) {
    return createErrorResponse('Internal server error', 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
