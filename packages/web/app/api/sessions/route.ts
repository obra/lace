// ABOUTME: Session management API endpoints for creating and listing sessions
// ABOUTME: Sessions are parent threads that contain multiple agent threads

import { NextRequest } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function GET(_request: NextRequest) {
  try {
    const sessionService = getSessionService();
    const sessions = await sessionService.listSessions();

    return createSuperjsonResponse({ sessions });
  } catch (error: unknown) {
    console.error('Error in GET /api/sessions:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

// POST method removed - all sessions must be created through projects
// Use POST /api/projects/{projectId}/sessions instead
