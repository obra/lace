// ABOUTME: Thin API layer that uses core ThreadManager for approval responses
// ABOUTME: Web-specific route that delegates to core event system

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';

export async function POST(
  request: NextRequest,
  { params }: { params: { threadId: string; toolCallId: string } }
): Promise<NextResponse> {
  try {
    const { threadId, toolCallId } = params;
    
    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    
    const { decision } = body;
    
    if (!decision) {
      return NextResponse.json({ error: 'Missing decision in request body' }, { status: 400 });
    }
    
    // Delegate to core ThreadManager (no web-specific logic)
    const sessionService = getSessionService();
    const agent = sessionService.getAgent(threadId);
    
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found for thread' }, { status: 404 });
    }
    
    // Use core ThreadManager to create approval response event
    agent.threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId,
      decision
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}