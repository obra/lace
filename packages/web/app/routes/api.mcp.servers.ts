// ABOUTME: Global MCP server list API for discovering available servers
// ABOUTME: Provides read-only list of global MCP server configurations

import { MCPConfigLoader } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';

export async function loader({ request }: { request: Request; params: unknown; context: unknown }) {
  try {
    // Load global MCP configuration only (no project context)
    const globalConfig = MCPConfigLoader.loadGlobalConfig();

    // Return server list with just configuration (no runtime status)
    const servers = Object.entries(globalConfig?.servers || {}).map(([serverId, serverConfig]) => ({
      id: serverId,
      ...serverConfig,
    }));

    return createSuperjsonResponse({ servers });
  } catch (error) {
    console.error('Failed to load global MCP configuration:', error);
    return createErrorResponse('Failed to load global MCP configuration', 500);
  }
}
