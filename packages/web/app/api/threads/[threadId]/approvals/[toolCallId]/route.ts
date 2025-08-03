// ABOUTME: Thin API layer that uses core ThreadManager for approval responses
// ABOUTME: Web-specific route that delegates to core event system

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId, ApprovalDecision } from '@/types/core';
import { ThreadIdSchema, ToolCallIdSchema } from '@/lib/validation/schemas';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';

// Validation schemas
const ParamsSchema = z.object({
  threadId: ThreadIdSchema,
  toolCallId: ToolCallIdSchema,
});

const BodySchema = z.object({
  decision: z.enum(['allow_once', 'allow_session', 'deny'], {
    errorMap: () => ({ message: 'Decision must be "allow_once", "allow_session", or "deny"' }),
  }),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string; toolCallId: string }> }
): Promise<NextResponse> {
  try {
    // Validate parameters
    const paramsResult = ParamsSchema.safeParse(await params);
    if (!paramsResult.success) {
      return createErrorResponse('Invalid parameters', 400, {
        code: 'VALIDATION_FAILED',
        details: paramsResult.error.format(),
      });
    }

    const { threadId, toolCallId } = paramsResult.data;

    // Parse and validate request body
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch (_error) {
      return createErrorResponse('Invalid JSON in request body', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const bodyResult = BodySchema.safeParse(requestBody);
    if (!bodyResult.success) {
      return createErrorResponse('Invalid request body', 400, {
        code: 'VALIDATION_FAILED',
        details: bodyResult.error.format(),
      });
    }

    const { decision } = bodyResult.data;

    // Get session first, then agent (following existing pattern)
    const sessionService = getSessionService();

    // Determine session ID (parent thread for agents, or self for sessions)
    const sessionIdStr: string = threadId.includes('.')
      ? (threadId.split('.')[0] ?? threadId)
      : threadId;

    const session = await sessionService.getSession(asThreadId(sessionIdStr));
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const agent = session.getAgent(asThreadId(threadId));
    if (!agent) {
      return createErrorResponse('Agent not found for thread', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Use Agent interface - no direct ThreadManager access
    // Convert string literal to ApprovalDecision enum
    const approvalDecision = decision as ApprovalDecision;
    await agent.handleApprovalResponse(toolCallId, approvalDecision);

    return createSuperjsonResponse({ success: true });
  } catch (_error) {
    return createErrorResponse('Internal server error', 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
