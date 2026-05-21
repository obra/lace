// ABOUTME: Tests project MCP payload conversion for agent session creation
// ABOUTME: Verifies Task 14 MCP metadata is not stripped before reaching the agent

import { describe, expect, it } from 'vitest';
import { mcpServersForProject } from './project-mcp-servers';
import type { Project } from './project';

describe('mcpServersForProject', () => {
  it('preserves transport, placement, and secret environment references', () => {
    const project = {
      getMCPServers: () => ({
        web: {
          command: 'server',
          transport: 'http',
          placement: 'host',
          secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
          enabled: true,
          tools: {},
        },
      }),
    } as unknown as Project;

    expect(mcpServersForProject(project)).toEqual([
      {
        name: 'web',
        command: 'server',
        transport: 'http',
        placement: 'host',
        secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
        enabled: true,
        tools: {},
      },
    ]);
  });
});
