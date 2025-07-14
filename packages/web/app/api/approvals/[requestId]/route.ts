// ABOUTME: API endpoint for submitting tool approval decisions
// ABOUTME: Resolves pending approval requests with user decisions

import { NextRequest, NextResponse } from 'next/server';
import { getApprovalManager } from '@/lib/server/approval-manager';
import { ToolApprovalResponse } from '@/types/api';
import { ApprovalDecision } from '@/lib/server/lace-imports';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
): Promise<NextResponse> {
  try {
    const { requestId } = await params;
    const body: ToolApprovalResponse = await request.json();

    // Validate decision matches ApprovalDecision enum
    const validDecisions: ApprovalDecision[] = [
      ApprovalDecision.ALLOW_ONCE,
      ApprovalDecision.ALLOW_SESSION,
      ApprovalDecision.DENY,
    ];

    if (!validDecisions.includes(body.decision)) {
      return NextResponse.json(
        { error: 'Invalid decision. Must be: allow_once, allow_session, or deny' },
        { status: 400 }
      );
    }

    const approvalManager = getApprovalManager();
    const success = approvalManager.resolveApproval(requestId, body.decision);

    if (!success) {
      return NextResponse.json({ error: 'Approval request not found or expired' }, { status: 404 });
    }

    console.log(`Approval decision for ${requestId}: ${body.decision}`);
    return NextResponse.json({ status: 'resolved', decision: body.decision });
  } catch (error) {
    console.error('Error in POST /api/approvals/[requestId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
