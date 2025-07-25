// ABOUTME: Thin API layer that uses core ThreadManager for approval responses
// ABOUTME: Web-specific route that delegates to core event system

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string; toolCallId: string }> }
): Promise<NextResponse> {
  try {
    const { threadId, toolCallId } = await params;
    
    // Parse request body
    let body: { decision?: string };
    try {
      body = await request.json() as { decision?: string };
    } catch (_error) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    
    const { decision } = body;
    
    if (!decision) {
      return NextResponse.json({ error: 'Missing decision in request body' }, { status: 400 });
    }
    
    // Get session first, then agent (following existing pattern)
    const sessionService = getSessionService();
    
    // Determine session ID (parent thread for agents, or self for sessions)
    const sessionIdStr: string = threadId.includes('.')
      ? (threadId.split('.')[0] ?? threadId)
      : threadId;
    
    const session = await sessionService.getSession(sessionIdStr);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    
    const agent = session.getAgent(threadId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found for thread' }, { status: 404 });
    }
    
    // Create approval response event and emit it so EventApprovalCallback receives it
    const event = agent.threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId,
      decision
    });
    
    // Emit the event so the EventApprovalCallback can receive it and continue tool execution
    agent.emit('thread_event_added', { event, threadId });
    
    return NextResponse.json({ success: true });
  } catch (_error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}