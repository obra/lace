// ABOUTME: Recovery API that uses core ThreadManager query methods
// ABOUTME: Thin web layer over core approval system

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
): Promise<NextResponse> {
  try {
    const { threadId } = await params;
    
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
    const rawPendingApprovals = agent.threadManager.getPendingApprovals(threadId);
    
    // Reconstruct ToolApprovalRequestData for each pending approval
    const pendingApprovals = rawPendingApprovals.map((approval) => {
      const toolCall = approval.toolCall as { name: string; arguments: unknown };
      
      // Try to get tool from executor to determine metadata (may not be available in all contexts)
      let tool;
      try {
        tool = agent.toolExecutor.getTool?.(toolCall.name);
      } catch {
        // Tool not available, use defaults
        tool = null;
      }
      
      const isReadOnly = tool?.annotations?.readOnlyHint ?? false;
      
      // Determine risk level based on tool annotations
      let riskLevel: 'safe' | 'moderate' | 'destructive' = 'moderate';
      if (tool?.annotations?.readOnlyHint) {
        riskLevel = 'safe';
      } else if (tool?.annotations?.destructiveHint) {
        riskLevel = 'destructive';
      }
      
      const requestData = {
        requestId: approval.toolCallId,
        toolName: toolCall.name,
        input: toolCall.arguments,
        isReadOnly,
        toolDescription: tool?.description,
        toolAnnotations: tool?.annotations,
        riskLevel,
      };
      
      return {
        toolCallId: approval.toolCallId,
        toolCall: approval.toolCall,
        requestedAt: approval.requestedAt,
        requestData,
      };
    });
    
    return NextResponse.json({ pendingApprovals });
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to get pending approvals' }, { status: 500 });
  }
}