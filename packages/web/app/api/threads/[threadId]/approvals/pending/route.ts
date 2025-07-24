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
    
    // Delegate to core ThreadManager query method
    const sessionService = getSessionService(); 
    const agent = sessionService.getAgent(threadId);
    
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found for thread' }, { status: 404 });
    }
    
    // Use core method to get pending approvals
    const pendingApprovals = agent.threadManager.getPendingApprovals(threadId);
    
    return NextResponse.json({ pendingApprovals });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get pending approvals' }, { status: 500 });
  }
}