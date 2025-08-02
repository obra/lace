// ABOUTME: Thin API layer that uses core ThreadManager for approval responses
// ABOUTME: Web-specific route that delegates to core event system

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId, ApprovalDecision } from '@/types/core';
import { ThreadIdSchema, ToolCallIdSchema } from '@/lib/validation/schemas';

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
      return NextResponse.json(
        {
          error: 'Invalid parameters',
          details: paramsResult.error.format(),
        },
        { status: 400 }
      );
    }

    const { threadId, toolCallId } = paramsResult.data;

    // Parse and validate request body
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch (_error) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const bodyResult = BodySchema.safeParse(requestBody);
    if (!bodyResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: bodyResult.error.format(),
        },
        { status: 400 }
      );
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
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const agent = session.getAgent(asThreadId(threadId));
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found for thread' }, { status: 404 });
    }

    // Use Agent interface - no direct ThreadManager access
    // Convert string literal to ApprovalDecision enum
    const approvalDecision = decision as ApprovalDecision;
    await agent.handleApprovalResponse(toolCallId, approvalDecision);

    return NextResponse.json({ success: true });
  } catch (_error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
