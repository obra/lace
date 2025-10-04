// ABOUTME: Tests for global MCP server list API
// ABOUTME: Validates server list retrieval and error handling

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader } from '@lace/web/app/routes/api.mcp.servers';
import { parseResponse } from '@lace/web/lib/serialization';
import { createLoaderArgs } from '@lace/web/test-utils/route-test-helpers';

interface ServerListResponse {
  servers: Array<{
    id: string;
    command: string;
    args?: string[];
    enabled: boolean;
    tools: Record<string, string>;
  }>;
}

// Mock the MCPConfigLoader
vi.mock('@lace/web/lib/server/lace-imports', async () => {
  const actual = await vi.importActual('@lace/web/lib/server/lace-imports');
  return {
    ...actual,
    MCPConfigLoader: {
      loadGlobalConfig: vi.fn(),
    },
  };
});

describe('Global MCP Server List API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return global server configurations', async () => {
    const { MCPConfigLoader } = vi.mocked(await import('@lace/web/lib/server/lace-imports'));
    MCPConfigLoader.loadGlobalConfig = vi.fn().mockReturnValue({
      servers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          enabled: true,
          tools: { read_file: 'allow' },
        },
      },
    });

    const request = new Request('http://localhost/api/mcp/servers');
    const response = await loader(createLoaderArgs(request, {}));
    const data = await parseResponse<ServerListResponse>(response);

    expect(response.status).toBe(200);
    expect(data.servers).toHaveLength(1);
    expect(data.servers[0]).toMatchObject({
      id: 'filesystem',
      command: 'npx',
      enabled: true,
    });
  });

  it('should return empty list when no global config exists', async () => {
    const { MCPConfigLoader } = vi.mocked(await import('@lace/web/lib/server/lace-imports'));
    MCPConfigLoader.loadGlobalConfig = vi.fn().mockReturnValue(null);

    const request = new Request('http://localhost/api/mcp/servers');
    const response = await loader(createLoaderArgs(request, {}));
    const data = await parseResponse<ServerListResponse>(response);

    expect(response.status).toBe(200);
    expect(data.servers).toEqual([]);
  });

  it('should handle configuration loading errors', async () => {
    const { MCPConfigLoader } = vi.mocked(await import('@lace/web/lib/server/lace-imports'));
    MCPConfigLoader.loadGlobalConfig = vi.fn().mockImplementation(() => {
      throw new Error('Config file corrupted');
    });

    const request = new Request('http://localhost/api/mcp/servers');
    const response = await loader(createLoaderArgs(request, {}));

    expect(response.status).toBe(500);
  });
});
