// ABOUTME: Session-level approval decision endpoint
// ABOUTME: Routes approval decisions to the correct agent that created the tool call

import { z } from 'zod';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getSupervisor, resolvePendingPermission } from '@lace/web/lib/server/supervisor-service';
import { WorkspaceSessionIdSchema } from '@lace/web/lib/validation/workspace-session-id-validation';
import type { Route } from './+types/api.sessions.$sessionId.approvals.$toolCallId';

// Validation schemas
const ParamsSchema = z.object({
  sessionId: z.string().min(1),
  toolCallId: z.string().min(1, 'Tool call ID cannot be empty'),
});

const BodySchema = z.object({
  decision: z.enum(['allow_once', 'allow_session', 'deny'], {
    errorMap: () => ({ message: 'Decision must be "allow_once", "allow_session", or "deny"' }),
  }),
});

export async function action({ request, params }: Route.ActionArgs) {
  try {
    // Validate parameters
    const paramsResult = ParamsSchema.safeParse(params);
    if (!paramsResult.success) {
      return createErrorResponse('Invalid parameters', 400, {
        code: 'VALIDATION_ERROR',
        details: paramsResult.error.format(),
      });
    }

    const { sessionId, toolCallId } = paramsResult.data;
    const parsedWorkspaceId = WorkspaceSessionIdSchema.safeParse(sessionId);
    if (!parsedWorkspaceId.success) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }
    const workspaceSessionId = parsedWorkspaceId.data;

    // Validate request body
    const body = (await request.json()) as unknown;
    const bodyResult = BodySchema.safeParse(body);
    if (!bodyResult.success) {
      return createErrorResponse('Invalid request body', 400, {
        code: 'VALIDATION_ERROR',
        details: bodyResult.error.format(),
      });
    }

    const { decision } = bodyResult.data;

    const supervisor = getSupervisor();
    const record = supervisor.getWorkspaceSession(workspaceSessionId);
    if (!record) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const mappedDecision = decision === 'deny' ? 'deny' : 'allow';
    const decodedToolCallId = decodeURIComponent(toolCallId);
    const resolved = resolvePendingPermission({
      workspaceSessionId,
      toolCallId: decodedToolCallId,
      decision: mappedDecision,
    });

    if (!resolved) {
      return createErrorResponse('Tool call not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    return createSuperjsonResponse({ success: true, toolCallId: decodedToolCallId, decision });
  } catch (_error) {
    return createErrorResponse('Failed to process approval decision', 500, {
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
}
