// ABOUTME: Real MCP server integration test using actual filesystem server process
// ABOUTME: Proves MCP integration works with real server, not just mocks

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { ToolExecutor } from '~/tools/executor';
import { MCPConfigLoader } from './config-loader';
import type { ToolCall } from '~/tools/types';

describe('Real MCP Server Integration', () => {
  let tempDir: string;
  let testDataDir: string;
  let toolExecutor: ToolExecutor;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-real-test-'));

    // Create a test data directory for the filesystem server to access
    testDataDir = join(tempDir, 'test-data');
    mkdirSync(testDataDir, { recursive: true });

    // Create a test file
    writeFileSync(join(testDataDir, 'test.txt'), 'Hello from real MCP server!');

    // Create test MCP configuration using real filesystem server
    const laceDir = join(tempDir, '.lace');
    mkdirSync(laceDir, { recursive: true });

    const testConfig = {
      servers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', testDataDir],
          cwd: testDataDir, // Set working directory to the allowed directory
          enabled: true,
          tools: {
            read_text_file: 'allow-always',
            list_directory: 'allow-always',
            list_allowed_directories: 'allow-always',
          },
        },
      },
    };

    writeFileSync(join(laceDir, 'mcp-config.json'), JSON.stringify(testConfig, null, 2));

    // Change to temp directory so config loader finds it
    process.chdir(tempDir);

    // Create tool executor
    toolExecutor = new ToolExecutor();
  });

  afterEach(async () => {
    // Restore working directory BEFORE cleanup
    process.chdir(originalCwd);

    // Shutdown executor (this should stop MCP servers)
    await toolExecutor.shutdown();

    // Remove temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should work with real filesystem MCP server', async () => {
    // Wait longer for real server initialization
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Step 1: Verify filesystem MCP tools are discovered
    const availableToolNames = toolExecutor.getAvailableToolNames();
    // Should contain filesystem tools
    expect(availableToolNames).toContain('filesystem/read_text_file');
    expect(availableToolNames).toContain('filesystem/list_directory');

    // Step 2: Test real tool execution - read the test file we created
    const readToolCall: ToolCall = {
      id: 'read-test-1',
      name: 'filesystem/read_text_file',
      arguments: { path: 'test.txt' }, // Relative to the server's allowed directory
    };

    const readResult = await toolExecutor.executeTool(readToolCall, {
      signal: new AbortController().signal,
    });

    // Should successfully read the real file
    expect(readResult.status).toBe('completed');
    expect(readResult.content[0].text).toContain('Hello from real MCP server!');

    // Step 4: Test directory listing
    const listToolCall: ToolCall = {
      id: 'list-test-1',
      name: 'filesystem/list_directory',
      arguments: { path: '.' }, // List the root allowed directory
    };

    const listResult = await toolExecutor.executeTool(listToolCall, {
      signal: new AbortController().signal,
    });

    expect(listResult.status).toBe('completed');
    expect(listResult.content[0].text).toContain('test.txt');
  }, 10000); // Longer timeout for real server startup

  it('should handle real server startup failures gracefully', async () => {
    // Create config with invalid command
    const invalidConfig = {
      servers: {
        'invalid-server': {
          command: 'nonexistent-command-12345',
          args: ['--invalid'],
          enabled: true,
          tools: {
            fake_tool: 'allow-always',
          },
        },
      },
    };

    const laceDir = join(tempDir, '.lace');
    writeFileSync(join(laceDir, 'mcp-config.json'), JSON.stringify(invalidConfig));

    // Create new executor
    await toolExecutor.shutdown();
    toolExecutor = new ToolExecutor();

    // Wait for initialization attempt
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Invalid server tools should not appear
    const availableTools = toolExecutor.getAvailableToolNames();
    expect(availableTools).not.toContain('invalid-server/fake_tool');

    // System should continue working (not crash)
    expect(toolExecutor).toBeDefined();
  }, 5000);
});
