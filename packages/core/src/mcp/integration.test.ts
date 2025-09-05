// ABOUTME: End-to-end integration test for complete MCP functionality using ToolExecutor
// ABOUTME: Tests that MCP tools are properly integrated with existing tool approval system

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { ToolExecutor } from '~/tools/executor';
import { MCPConfigLoader } from './config-loader';
import { ApprovalDecision } from '~/tools/approval-types';
import type { ToolCall, ApprovalCallback } from '~/tools/types';

// Mock the MCP SDK to avoid spawning real processes
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'echo_test',
          description: 'Echo test tool for integration testing',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
        },
      ],
    }),
    callTool: vi.fn().mockImplementation(({ arguments: args }) =>
      Promise.resolve({
        content: [
          {
            type: 'text',
            text: `Echo: ${args.message}`,
          },
        ],
        isError: false,
      })
    ),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
    onerror: null,
    onclose: null,
  })),
}));

describe('MCP Integration E2E', () => {
  let tempDir: string;
  let toolExecutor: ToolExecutor;
  let mockApprovalCallback: ApprovalCallback;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-integration-test-'));

    // Create test MCP configuration
    const laceDir = join(tempDir, '.lace');
    mkdirSync(laceDir, { recursive: true });

    const testConfig = {
      servers: {
        'test-server': {
          command: 'node',
          args: ['test-server.js'],
          enabled: true,
          tools: {
            echo_test: 'allow-always',
          },
        },
      },
    };

    writeFileSync(join(laceDir, 'mcp-config.json'), JSON.stringify(testConfig, null, 2));

    // Change to temp directory so config loader finds it
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    // Setup mock approval callback
    mockApprovalCallback = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalDecision.ALLOW_ALWAYS),
    };

    // Create tool executor
    toolExecutor = new ToolExecutor();
    toolExecutor.setApprovalCallback(mockApprovalCallback);

    // Cleanup function to restore directory
    const cleanup = () => {
      process.chdir(originalCwd);
    };

    // Store cleanup for afterEach
    (toolExecutor as any)._testCleanup = cleanup;

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Run cleanup if it exists
    if ((toolExecutor as any)._testCleanup) {
      (toolExecutor as any)._testCleanup();
    }

    await toolExecutor.shutdown();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should complete full integration: config → server start → tool discovery → tool execution via ToolExecutor', async () => {
    // Step 1: Verify configuration can be loaded
    const config = MCPConfigLoader.loadConfig(tempDir);
    expect(config.servers['test-server']).toBeDefined();
    expect(config.servers['test-server'].enabled).toBe(true);
    expect(config.servers['test-server'].tools.echo_test).toBe('allow-always');

    // Step 2: Wait for MCP initialization to complete
    // Since MCP initialization is async in background, we need to wait
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Step 3: Verify MCP tool is available through ToolExecutor
    const availableToolNames = toolExecutor.getAvailableToolNames();

    // Should contain the MCP tool (with server prefix)
    const mcpToolName = 'test-server/echo_test';
    expect(availableToolNames).toContain(mcpToolName);

    // Step 4: Verify we can get the tool from ToolExecutor
    const mcpTool = toolExecutor.getTool(mcpToolName);
    expect(mcpTool).toBeDefined();
    expect(mcpTool!.name).toBe(mcpToolName);
    expect(mcpTool!.description).toBe('Echo test tool for integration testing');

    // Step 5: Test tool execution through ToolExecutor approval flow
    const toolCall: ToolCall = {
      id: 'test-call-1',
      name: mcpToolName,
      arguments: { message: 'Hello MCP Integration!' },
    };

    // Create minimal context for execution
    const context = {
      signal: new AbortController().signal,
    };

    // Step 6: Execute tool through ToolExecutor (this tests the full approval flow)
    const result = await toolExecutor.executeTool(toolCall, context);

    expect(result.status).toBe('completed');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe('Echo: Hello MCP Integration!');

    // For allow-always tools, approval callback should NOT be called (bypassed)
    expect(mockApprovalCallback.requestApproval).not.toHaveBeenCalled();
  });

  it('should respect MCP approval policies - DISABLE should not appear in available tools', async () => {
    // Create a config with a disabled tool
    const disabledConfig = {
      servers: {
        'test-server': {
          command: 'node',
          args: ['test-server.js'],
          enabled: true,
          tools: {
            echo_test: 'disable', // This tool should not appear in available tools
          },
        },
      },
    };

    const laceDir = join(tempDir, '.lace');
    writeFileSync(join(laceDir, 'mcp-config.json'), JSON.stringify(disabledConfig));

    // Create new executor to pick up the new config
    await toolExecutor.shutdown();
    toolExecutor = new ToolExecutor();
    toolExecutor.setApprovalCallback(mockApprovalCallback);

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Disabled tools should not appear in available tool names
    const availableToolNames = toolExecutor.getAvailableToolNames();
    expect(availableToolNames).not.toContain('test-server/echo_test');

    // Should also not be retrievable directly
    const disabledTool = toolExecutor.getTool('test-server/echo_test');
    expect(disabledTool).toBeUndefined();
  });

  it('should handle MCP tool execution failures gracefully', async () => {
    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Mock the SDK to return an error
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const mockClient = vi.mocked(Client).mock.results[0].value;
    mockClient.callTool.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: 'Tool execution failed',
        },
      ],
      isError: true,
    });

    const toolCall: ToolCall = {
      id: 'test-call-2',
      name: 'test-server/echo_test',
      arguments: { message: 'This will fail' },
    };

    const context = {
      signal: new AbortController().signal,
    };

    const result = await toolExecutor.executeTool(toolCall, context);

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('MCP tool error: Tool execution failed');
  });

  it('should handle different MCP approval levels correctly', async () => {
    // Create a config with require-approval (not allow-always)
    const requireApprovalConfig = {
      servers: {
        'test-server': {
          command: 'node',
          args: ['test-server.js'],
          enabled: true,
          tools: {
            echo_test: 'require-approval', // This will go through normal approval flow
          },
        },
      },
    };

    const laceDir = join(tempDir, '.lace');
    writeFileSync(join(laceDir, 'mcp-config.json'), JSON.stringify(requireApprovalConfig));

    // Create new executor to pick up the new config
    await toolExecutor.shutdown();
    toolExecutor = new ToolExecutor();

    // Mock different approval responses
    mockApprovalCallback.requestApproval
      .mockResolvedValueOnce(ApprovalDecision.ALLOW_PROJECT)
      .mockResolvedValueOnce(ApprovalDecision.DENY);

    toolExecutor.setApprovalCallback(mockApprovalCallback);

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create mock agent context (required for non-allow-always tools)
    const mockAgent = {
      getFullSession: vi.fn().mockResolvedValue({
        getEffectiveConfiguration: vi.fn().mockReturnValue({}),
        getToolPolicy: vi.fn().mockReturnValue('require-approval'),
      }),
    };

    const context = {
      signal: new AbortController().signal,
      agent: mockAgent,
    };

    // Test ALLOW_PROJECT - should execute
    let result = await toolExecutor.executeTool(
      {
        id: 'test-1',
        name: 'test-server/echo_test',
        arguments: { message: 'Project approved' },
      },
      context
    );
    expect(result.status).toBe('completed');

    // Test DENY - should be denied
    result = await toolExecutor.executeTool(
      {
        id: 'test-2',
        name: 'test-server/echo_test',
        arguments: { message: 'This should be denied' },
      },
      context
    );
    expect(result.status).toBe('denied');
  });
});
