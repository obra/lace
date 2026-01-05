// ABOUTME: Thin API layer that uses core ThreadManager for approval responses
// ABOUTME: Web-specific route that delegates to supervisor-backed approval system

import { z } from 'zod';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { isAgentSessionId } from '@lace/web/lib/validation/session-id-validation';
import {
  getSupervisor,
  listPendingPermissions,
  resolvePendingPermission,
} from '@lace/web/lib/server/supervisor-service';
import type { Route } from './+types/api.threads.$threadId.approvals.$toolCallId';

// Validation schemas
const ParamsSchema = z.object({
  threadId: z.string().min(1),
  toolCallId: z.string().min(1),
});

const BodySchema = z.object({
  decision: z.enum(['allow_once', 'allow_session', 'deny'], {
    errorMap: () => ({ message: 'Decision must be "allow_once", "allow_session", or "deny"' }),
  }),
});

export async function action({ request, params }: Route.ActionArgs) {
  switch (request.method) {
    case 'POST':
      break;
    default:
      return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    // Validate parameters
    const paramsResult = ParamsSchema.safeParse(params);
    if (!paramsResult.success) {
      return createErrorResponse('Invalid parameters', 400, {
        code: 'VALIDATION_FAILED',
        details: paramsResult.error.format(),
      });
    }

    const { threadId, toolCallId: encodedToolCallId } = paramsResult.data;

    if (!isAgentSessionId(threadId)) {
      return createErrorResponse('Invalid thread ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    // Decode the URL-encoded tool call ID
    const toolCallId = decodeURIComponent(encodedToolCallId);

    // Parse and validate request body
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch (_error) {
      return createErrorResponse('Invalid JSON in request body', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const bodyResult = BodySchema.safeParse(requestBody);
    if (!bodyResult.success) {
      return createErrorResponse('Invalid request body', 400, {
        code: 'VALIDATION_FAILED',
        details: bodyResult.error.format(),
      });
    }

    const { decision } = bodyResult.data;

    const supervisor = await getSupervisor();
    const workspace = (await supervisor.listWorkspaceSessions()).find((ws) =>
      ws.agents.some((a) => a.sessionId === threadId)
    );
    if (!workspace) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const pending = (await listPendingPermissions(workspace.workspaceSessionId)).find(
      (p) => p.toolCallId === toolCallId
    );
    if (!pending || pending.agentSessionId !== threadId) {
      return createErrorResponse('Tool call not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const mappedDecision = decision === 'deny' ? 'deny' : 'allow';
    const resolved = await resolvePendingPermission({
      workspaceSessionId: workspace.workspaceSessionId,
      toolCallId,
      decision: mappedDecision,
    });
    if (!resolved) {
      return createErrorResponse('Tool call not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    return createSuperjsonResponse({ success: true });
  } catch (_error) {
    return createErrorResponse('Internal server error', 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
