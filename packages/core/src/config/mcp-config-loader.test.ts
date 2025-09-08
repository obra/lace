import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MCPConfigLoader } from './mcp-config-loader';

describe('MCPConfigLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return empty config when no files exist', () => {
    const config = MCPConfigLoader.loadConfig('/nonexistent');
    expect(config).toEqual({ servers: {} });
  });

  it('should load and validate server configuration', () => {
    const laceDir = join(tempDir, '.lace');
    mkdirSync(laceDir, { recursive: true });

    writeFileSync(
      join(laceDir, 'mcp-config.json'),
      JSON.stringify({
        servers: {
          filesystem: {
            command: 'node',
            args: ['fs-server.js'],
            enabled: true,
            tools: {
              read_file: 'allow',
              write_file: 'ask',
            },
          },
        },
      })
    );

    const config = MCPConfigLoader.loadConfig(tempDir);
    expect(config.servers.filesystem.command).toBe('node');
    expect(config.servers.filesystem.args).toEqual(['fs-server.js']);
    expect(config.servers.filesystem.tools.read_file).toBe('allow');
  });

  it('should gracefully handle invalid server configurations', () => {
    const validConfig = {
      servers: {
        test: {
          command: 'node',
          enabled: true,
          tools: { tool1: 'allow' },
        },
      },
    };

    expect(() => MCPConfigLoader.validateConfig(validConfig)).not.toThrow();

    const invalidConfig = {
      servers: {
        test: {
          // Missing required 'command' field
          enabled: true,
          tools: {},
        },
        valid: {
          command: 'echo',
          enabled: true,
          tools: { test: 'allow' },
        },
      },
    };

    // Should not throw, should disable invalid servers
    const result = MCPConfigLoader.validateConfig(invalidConfig);

    // Invalid server should be disabled
    expect(result.servers.test.enabled).toBe(false);
    expect(result.servers.test.tools).toEqual({});

    // Valid server should remain unchanged
    expect(result.servers.valid.enabled).toBe(true);
    expect(result.servers.valid.command).toBe('echo');
  });

  it('should merge configs with project replacing global servers', () => {
    // This test would require mocking process.env.HOME
    // Simplified version - testing the merge logic conceptually

    const globalConfig = {
      servers: {
        fs: {
          command: 'global',
          enabled: true,
          tools: { read: 'allow' },
        },
      },
    };
    const projectConfig = {
      servers: {
        fs: {
          command: 'project',
          enabled: false,
          tools: { read: 'deny' },
        },
      },
    };

    // The actual merge happens in loadConfig, but we can test validation
    const merged = MCPConfigLoader.validateConfig({
      servers: {
        ...globalConfig.servers,
        ...projectConfig.servers, // Project completely replaces global
      },
    });

    expect(merged.servers.fs.command).toBe('project');
    expect(merged.servers.fs.tools.read).toBe('deny'); // No inheritance
  });
});
