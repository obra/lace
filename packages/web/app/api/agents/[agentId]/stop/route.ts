// ABOUTME: Stop endpoint for halting agent processing while keeping agent alive
// ABOUTME: Calls agent.abort() to stop current generation but preserves agent state

import { NextRequest } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    if (!isValidThreadId(agentId)) {
      return createErrorResponse('Invalid agent ID format', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const agentThreadId = asThreadId(agentId);

    // Extract sessionId from agentId (agents are child threads like sessionId.1)
    const sessionIdStr = agentThreadId.split('.')[0];
    if (!sessionIdStr || !isValidThreadId(sessionIdStr)) {
      return createErrorResponse('Invalid session ID derived from agent ID', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const sessionId = asThreadId(sessionIdStr);

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    const agent = session.getAgent(agentThreadId);

    if (!agent) {
      return createErrorResponse('Agent not found', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // Attempt to stop the agent's current processing
    const stopped = agent.abort();

    return createSuperjsonResponse({
      success: true,
      stopped,
      agentId: agentThreadId,
      message: stopped
        ? 'Agent processing stopped successfully'
        : 'Agent was not currently processing',
    });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}