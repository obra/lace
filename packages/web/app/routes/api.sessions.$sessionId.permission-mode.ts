// ABOUTME: API endpoint for updating session permission override mode
// ABOUTME: Allows switching between normal, YOLO, and read-only modes

import { Session } from '@lace/core/sessions/session';
import { z } from 'zod';
import { logger } from '@lace/core/utils/logger';
import { asThreadId } from '@lace/core/threads/types';
import { createErrorResponse, createSuccessResponse } from '@/lib/server/api-utils';
import type { Route } from './+types/api.sessions.$sessionId.permission-mode';

const PermissionModeSchema = z.object({
  mode: z.enum(['normal', 'yolo', 'read-only']),
});

export async function action({ params, request }: Route.ActionArgs) {
  const { sessionId } = params as { sessionId: string };

  if (!sessionId) {
    return createErrorResponse('Session ID required', 400, { code: 'VALIDATION_FAILED' });
  }

  if (request.method !== 'PATCH') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = (await request.json()) as unknown;
    const { mode } = PermissionModeSchema.parse(body);

    const session = await Session.getById(asThreadId(sessionId));
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    session.setPermissionOverrideMode(mode);

    return createSuccessResponse({
      success: true,
      mode,
      sessionId,
    });
  } catch (error: unknown) {
    logger.error('Failed to update permission mode', { error, sessionId });
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to update permission mode',
      500,
      { code: 'INTERNAL_SERVER_ERROR', error }
    );
  }
}
