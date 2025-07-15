// ABOUTME: API endpoint for submitting tool approval decisions
// ABOUTME: Resolves pending approval requests with user decisions

import { NextRequest, NextResponse } from 'next/server';
import { getApprovalManager } from '@/lib/server/approval-manager';
import { ToolApprovalResponse, ApiErrorResponse } from '@/types/api';
import { ApprovalDecision } from '@/types/api';
import { ApprovalDecision as LaceApprovalDecision } from '~/tools/approval-types';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
): Promise<NextResponse> {
  try {
    const { requestId } = await params;
    const body = (await request.json()) as ToolApprovalResponse;

    // Validate decision matches ApprovalDecision enum
    const validDecisions = [ApprovalDecision.ALLOW_ONCE, ApprovalDecision.ALLOW_SESSION, ApprovalDecision.DENY];

    if (!validDecisions.includes(body.decision)) {
      const errorResponse: ApiErrorResponse = { 
        error: 'Invalid decision. Must be: allow_once, allow_session, or deny' 
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const approvalManager = getApprovalManager();
    // Convert API decision to Lace enum
    const laceDecision = body.decision as LaceApprovalDecision;
    const success = approvalManager.resolveApproval(requestId, laceDecision);

    if (!success) {
      const errorResponse: ApiErrorResponse = { 
        error: 'Approval request not found or expired' 
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    console.warn(`Approval decision for ${requestId}: ${body.decision}`);
    return NextResponse.json({ status: 'resolved', decision: body.decision });
  } catch (error: unknown) {
    console.error('Error in POST /api/approvals/[requestId]:', error);
    
    const errorMessage = isError(error) ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
