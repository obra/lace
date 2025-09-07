// ABOUTME: Tests for MCP configuration type definitions and validation
// ABOUTME: Ensures type safety and backward compatibility for MCP server configurations

import { describe, it, expect } from 'vitest';
import type { MCPServerConfig, DiscoveredTool } from './mcp-types';

describe('MCPServerConfig Discovery Fields', () => {
  it('should accept discovery cache fields', () => {
    const configWithDiscovery: MCPServerConfig = {
      command: 'npx',
      args: ['test-server'],
      enabled: true,
      tools: { test_tool: 'allow-once' },
      // NEW fields
      discoveredTools: [{ name: 'test_tool', description: 'Test tool' }],
      discoveryStatus: 'success',
      lastDiscovery: '2023-01-01T00:00:00Z',
    };

    // This should compile without TypeScript errors
    expect(configWithDiscovery.discoveredTools).toBeDefined();
    expect(configWithDiscovery.discoveryStatus).toBe('success');
    expect(configWithDiscovery.lastDiscovery).toBe('2023-01-01T00:00:00Z');
  });

  it('should work without discovery fields (backward compatibility)', () => {
    const minimalConfig: MCPServerConfig = {
      command: 'npx',
      enabled: true,
      tools: {},
    };

    expect(minimalConfig.discoveredTools).toBeUndefined();
    expect(minimalConfig.discoveryStatus).toBeUndefined();
    expect(minimalConfig.lastDiscovery).toBeUndefined();
  });

  it('should accept all discovery status values', () => {
    const statuses = ['never', 'discovering', 'success', 'failed'] as const;

    statuses.forEach((status) => {
      const config: MCPServerConfig = {
        command: 'test',
        enabled: true,
        tools: {},
        discoveryStatus: status,
      };

      expect(config.discoveryStatus).toBe(status);
    });
  });

  it('should accept discovery error field', () => {
    const config: MCPServerConfig = {
      command: 'test',
      enabled: true,
      tools: {},
      discoveryStatus: 'failed',
      discoveryError: 'Connection timeout',
    };

    expect(config.discoveryError).toBe('Connection timeout');
  });
});

describe('DiscoveredTool interface', () => {
  it('should require name field', () => {
    const tool: DiscoveredTool = {
      name: 'test_tool',
    };

    expect(tool.name).toBe('test_tool');
    expect(tool.description).toBeUndefined();
  });

  it('should accept optional description field', () => {
    const tool: DiscoveredTool = {
      name: 'test_tool',
      description: 'A test tool',
    };

    expect(tool.name).toBe('test_tool');
    expect(tool.description).toBe('A test tool');
  });
});
