// ABOUTME: Tests for MCP configuration type definitions and validation
// ABOUTME: Ensures type safety and backward compatibility for MCP server configurations

import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServerConfigSchema } from '@lace/ent-protocol';
import { mergeMcpServers } from '../rpc/session-config';
import { MCPConfigLoader } from './mcp-config-loader';
import type { MCPServerConfig, DiscoveredTool } from './mcp-types';

describe('MCPServerConfig Discovery Fields', () => {
  it('should accept discovery cache fields', () => {
    const configWithDiscovery: MCPServerConfig = {
      command: 'npx',
      args: ['test-server'],
      enabled: true,
      tools: { test_tool: 'ask' },
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

  it('should accept MCP placement and secret environment references', () => {
    const config: MCPServerConfig = {
      command: 'test',
      enabled: true,
      tools: {},
      placement: 'toolRuntime',
      secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
    };

    const hostConfig: MCPServerConfig = {
      command: 'test',
      enabled: true,
      tools: {},
      placement: 'host',
    };

    expect(config.placement).toBe('toolRuntime');
    expect(config.secretEnv?.API_KEY).toEqual({ namespace: 'project', name: 'api-key' });
    expect(hostConfig.placement).toBe('host');
  });

  it('should validate local MCP placement and secret environment references', () => {
    const parsed = MCPConfigLoader.validateConfigStructure({
      servers: {
        runtime: {
          command: 'test',
          enabled: true,
          tools: {},
          placement: 'toolRuntime',
          secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
        },
        host: {
          command: 'test',
          enabled: true,
          tools: {},
          placement: 'host',
        },
      },
    });

    expect(parsed.servers.runtime.placement).toBe('toolRuntime');
    expect(parsed.servers.runtime.secretEnv?.API_KEY).toEqual({
      namespace: 'project',
      name: 'api-key',
    });
    expect(parsed.servers.host.placement).toBe('host');
  });

  it('should validate protocol MCP placement and secret environment references', () => {
    const parsed = McpServerConfigSchema.parse({
      name: 'runtime',
      command: 'test',
      placement: 'toolRuntime',
      secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
    });

    expect(parsed.placement).toBe('toolRuntime');
    expect(parsed.secretEnv?.API_KEY).toEqual({ namespace: 'project', name: 'api-key' });
    expect(
      McpServerConfigSchema.parse({ name: 'host', command: 'test', placement: 'host' }).placement
    ).toBe('host');
  });

  it('should default merged MCP placement by transport', () => {
    const merged = mergeMcpServers(undefined, [
      { name: 'stdio-default', command: 'test' },
      { name: 'stdio-explicit', command: 'test', transport: 'stdio' },
      { name: 'http-default', command: 'test', transport: 'http' },
      { name: 'sse-default', command: 'test', transport: 'sse' },
    ]);

    expect(merged).toEqual([
      { name: 'stdio-default', command: 'test', placement: 'toolRuntime' },
      {
        name: 'stdio-explicit',
        command: 'test',
        transport: 'stdio',
        placement: 'toolRuntime',
      },
      { name: 'http-default', command: 'test', transport: 'http', placement: 'host' },
      { name: 'sse-default', command: 'test', transport: 'sse', placement: 'host' },
    ]);
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

describe('MCPConfigLoader placement defaults', () => {
  it('defaults global user config MCP placement to host', () => {
    const originalLaceDir = process.env.LACE_DIR;
    const laceDir = mkdtempSync(join(tmpdir(), 'lace-global-mcp-'));
    process.env.LACE_DIR = laceDir;

    try {
      writeFileSync(
        join(laceDir, 'mcp-config.json'),
        JSON.stringify({
          servers: {
            missingTransport: { command: 'missing', enabled: true, tools: {} },
            stdio: { command: 'stdio', transport: 'stdio', enabled: true, tools: {} },
            http: { command: 'http', transport: 'http', enabled: true, tools: {} },
            explicit: {
              command: 'explicit',
              transport: 'stdio',
              placement: 'toolRuntime',
              enabled: true,
              tools: {},
            },
          },
        })
      );

      expect(MCPConfigLoader.loadConfig().servers).toMatchObject({
        missingTransport: { placement: 'host' },
        stdio: { placement: 'host' },
        http: { placement: 'host' },
        explicit: { placement: 'toolRuntime' },
      });
    } finally {
      if (originalLaceDir === undefined) delete process.env.LACE_DIR;
      else process.env.LACE_DIR = originalLaceDir;
      rmSync(laceDir, { recursive: true, force: true });
    }
  });

  it('defaults project config stdio placement to toolRuntime and HTTP/SSE to host', () => {
    const originalLaceDir = process.env.LACE_DIR;
    const laceDir = mkdtempSync(join(tmpdir(), 'lace-global-mcp-'));
    const projectDir = mkdtempSync(join(tmpdir(), 'lace-project-mcp-'));
    process.env.LACE_DIR = laceDir;

    try {
      mkdirSync(join(projectDir, '.lace'), { recursive: true });
      writeFileSync(
        join(projectDir, '.lace', 'mcp-config.json'),
        JSON.stringify({
          servers: {
            missingTransport: { command: 'missing', enabled: true, tools: {} },
            stdio: { command: 'stdio', transport: 'stdio', enabled: true, tools: {} },
            http: { command: 'http', transport: 'http', enabled: true, tools: {} },
            sse: { command: 'sse', transport: 'sse', enabled: true, tools: {} },
            explicit: {
              command: 'explicit',
              placement: 'host',
              enabled: true,
              tools: {},
            },
          },
        })
      );

      expect(MCPConfigLoader.loadConfig(projectDir).servers).toMatchObject({
        missingTransport: { placement: 'toolRuntime' },
        stdio: { placement: 'toolRuntime' },
        http: { placement: 'host' },
        sse: { placement: 'host' },
        explicit: { placement: 'host' },
      });
    } finally {
      if (originalLaceDir === undefined) delete process.env.LACE_DIR;
      else process.env.LACE_DIR = originalLaceDir;
      rmSync(laceDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
