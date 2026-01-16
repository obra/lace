// ABOUTME: Session-wide approval aggregation API for integrated WebUI approval experience
// ABOUTME: Collects pending approvals from ALL agents in a session and presents unified view

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { getPendingApprovals } from '@lace/web/lib/server/approval-route-handlers';
import { requireSessionId, errorToResponse } from '@lace/web/lib/server/route-helpers';
import type { Route } from './+types/api.sessions.$sessionId.approvals.pending';

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const workspaceSessionId = requireSessionId(params);

    const approvals = await getPendingApprovals({
      scope: 'session',
      workspaceSessionId,
    });

    return createSuperjsonResponse(approvals);
  } catch (error) {
    return errorToResponse(error, 'Failed to get pending approvals');
  }
}
