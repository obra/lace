// ABOUTME: API endpoint for agent context breakdown
// ABOUTME: Not supported for supervisor-backed agent sessions yet (requires token accounting in lace-agent)

import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import type { Route } from './+types/api.agents.$agentId.context';

export async function loader({ request: _request, params: _params }: Route.LoaderArgs) {
  return createErrorResponse(
    'Context breakdown is not supported for supervisor-backed agents',
    501,
    {
      code: 'NOT_SUPPORTED',
    }
  );
}
