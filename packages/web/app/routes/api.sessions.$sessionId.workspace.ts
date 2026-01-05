// ABOUTME: API endpoint for session workspace information
// ABOUTME: Returns workspace mode and detailed workspace info

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { logger } from '@lace/core/utils/logger';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { isWorkspaceSessionId } from '@lace/web/lib/validation/session-id-validation';
import type { WorkspaceInfo } from '@lace/agent/workspace/workspace-container-manager';

interface LoaderParams {
  sessionId?: string;
}

export async function loader({ params }: { params: LoaderParams }) {
  const { sessionId } = params;

  if (!sessionId) {
    return createErrorResponse('Session ID required', 400, { code: 'VALIDATION_FAILED' });
  }

  try {
    if (!isWorkspaceSessionId(sessionId)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const supervisor = await getSupervisor();
    const record = await supervisor.getWorkspaceSession(sessionId);
    if (!record) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const info: WorkspaceInfo = {
      sessionId: record.workspaceSessionId,
      projectDir: record.workDir,
      clonePath: record.workDir,
      containerId: '',
      state: 'running',
    };

    return createSuperjsonResponse({ mode: 'local', info });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch workspace info', { error, sessionId, errorMessage });
    return createErrorResponse('Failed to fetch workspace information', 500, {
      code: 'INTERNAL_ERROR',
    });
  }
}
