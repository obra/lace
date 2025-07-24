// ABOUTME: Recovery API that uses core ThreadManager query methods
// ABOUTME: Thin web layer over core approval system

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';

export async function GET(
  request: NextRequest,
  { params }: { params: { threadId: string } }
): Promise<NextResponse> {
  try {
    const { threadId } = params;
    
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
    
    // Use core method to get pending approvals
    const pendingApprovals = agent.threadManager.getPendingApprovals(threadId);
    
    return NextResponse.json({ pendingApprovals });
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to get pending approvals' }, { status: 500 });
  }
}