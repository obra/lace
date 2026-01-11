// ABOUTME: Thread-level approval decision endpoint
// ABOUTME: Routes approval decisions for a specific agent/thread

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import {
  submitApprovalDecision,
  ApprovalDecisionSchema,
} from '@lace/web/lib/server/approval-route-handlers';
import {
  requireThreadId,
  requireParam,
  errorToResponse,
  throwMethodNotAllowed,
} from '@lace/web/lib/server/route-helpers';
import type { Route } from './+types/api.threads.$threadId.approvals.$toolCallId';

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return throwMethodNotAllowed();
  }

  try {
    const threadId = requireThreadId(params);
    const toolCallId = requireParam(params, 'toolCallId');

    // Parse and validate request body
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      return createErrorResponse('Invalid JSON in request body', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const bodyResult = ApprovalDecisionSchema.safeParse(requestBody);
    if (!bodyResult.success) {
      return createErrorResponse('Invalid request body', 400, {
        code: 'VALIDATION_FAILED',
        details: bodyResult.error.format(),
      });
    }

    const result = await submitApprovalDecision(
      { scope: 'thread', threadId },
      toolCallId,
      bodyResult.data.decision
    );

    return createSuperjsonResponse(result);
  } catch (error) {
    return errorToResponse(error, 'Internal server error');
  }
}
