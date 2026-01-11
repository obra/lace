// ABOUTME: Thread-level pending approvals API
// ABOUTME: Returns pending approvals for a specific agent/thread only

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { getPendingApprovals } from '@lace/web/lib/server/approval-route-handlers';
import {
  requireThreadId,
  errorToResponse,
} from '@lace/web/lib/server/route-helpers';
import type { Route } from './+types/api.threads.$threadId.approvals.pending';

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const threadId = requireThreadId(params);

    const approvals = await getPendingApprovals({
      scope: 'thread',
      threadId,
    });

    return createSuperjsonResponse(approvals);
  } catch (error) {
    return errorToResponse(error, 'Failed to get pending approvals');
  }
}
