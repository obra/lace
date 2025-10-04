// ABOUTME: API endpoint for session workspace information
// ABOUTME: Returns workspace mode and detailed workspace info

import { Session } from '@lace/web/lib/server/lace-imports';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { asThreadId } from '@lace/web/types/core';
import { logger } from '@lace/core/utils/logger';

interface LoaderParams {
  sessionId?: string;
}

export async function loader({ params }: { params: LoaderParams }) {
  const { sessionId } = params;

  if (!sessionId) {
    return createErrorResponse('Session ID required', 400, { code: 'VALIDATION_FAILED' });
  }

  try {
    // Validate session ID format before using asThreadId
    let threadId;
    try {
      threadId = asThreadId(sessionId);
    } catch {
      // Invalid format is treated as "not found" rather than error
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const session = await Session.getById(threadId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Wait for workspace initialization if in progress
    await session.waitForWorkspace();

    // Get workspace mode from effective configuration
    const config = session.getEffectiveConfiguration();
    // Default to 'worktree' (matches DEFAULT_WORKSPACE_MODE in core)
    const mode = (config.workspaceMode as 'container' | 'worktree' | 'local') || 'worktree';

    // Get workspace info (may be undefined if not initialized)
    const info = session.getWorkspaceInfo();

    return createSuperjsonResponse({ mode, info: info || null });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch workspace info', { error, sessionId, errorMessage });
    return createErrorResponse('Failed to fetch workspace information', 500, {
      code: 'INTERNAL_ERROR',
    });
  }
}
