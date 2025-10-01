// ABOUTME: API endpoint for session workspace information
// ABOUTME: Returns workspace mode and detailed workspace info

import { Session } from '@/lib/server/lace-imports';
import type { WorkspaceInfo } from '@lace/core/workspace/workspace-container-manager';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { Route } from './+types/api.sessions.$sessionId.workspace';

export async function loader({ params }: Route.LoaderArgs) {
  const { sessionId } = params;

  if (!sessionId) {
    return createErrorResponse('Session ID required', 400, { code: 'VALIDATION_FAILED' });
  }

  try {
    const session = await Session.getById(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Wait for workspace initialization if in progress
    await session.waitForWorkspace();

    // Get workspace mode from effective configuration
    const config = session.getEffectiveConfiguration();
    const mode = (config.workspaceMode as 'container' | 'local') || 'local';

    // Get workspace info (may be undefined if not initialized)
    const info = session.getWorkspaceInfo();

    return createSuperjsonResponse({ mode, info: info || null });
  } catch (error) {
    console.error('Failed to fetch workspace info:', error);
    return createErrorResponse('Failed to fetch workspace information', 500, {
      code: 'INTERNAL_ERROR',
    });
  }
}
