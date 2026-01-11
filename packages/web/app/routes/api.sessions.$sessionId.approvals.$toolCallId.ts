// ABOUTME: Session-level approval decision endpoint
// ABOUTME: Routes approval decisions to the correct agent that created the tool call

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import {
  submitApprovalDecision,
  ApprovalDecisionSchema,
} from '@lace/web/lib/server/approval-route-handlers';
import {
  requireSessionId,
  requireParam,
  errorToResponse,
} from '@lace/web/lib/server/route-helpers';
import type { Route } from './+types/api.sessions.$sessionId.approvals.$toolCallId';

export async function action({ request, params }: Route.ActionArgs) {
  try {
    const workspaceSessionId = requireSessionId(params);
    const toolCallId = requireParam(params, 'toolCallId');

    // Parse and validate request body
    const body = (await request.json()) as unknown;
    const bodyResult = ApprovalDecisionSchema.safeParse(body);
    if (!bodyResult.success) {
      return createErrorResponse('Invalid request body', 400, {
        code: 'VALIDATION_ERROR',
        details: bodyResult.error.format(),
      });
    }

    const result = await submitApprovalDecision(
      { scope: 'session', workspaceSessionId },
      toolCallId,
      bodyResult.data.decision
    );

    return createSuperjsonResponse(result);
  } catch (error) {
    return errorToResponse(error, 'Failed to process approval decision');
  }
}
