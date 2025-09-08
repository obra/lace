// ABOUTME: End-to-end integration test for complete MCP functionality using Session-based architecture
// ABOUTME: Tests that MCP tools are properly integrated from Project → Session → ToolExecutor

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { ApprovalDecision } from '~/tools/types';
import type { ToolCall, ApprovalCallback } from '~/tools/types';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

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
  const tempLaceContext = useTempLaceDir();
  let tempDir: string;
  let project: Project;
  let session: Session;
  let mockApprovalCallback: ApprovalCallback;

  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-integration-test-'));

    // Change to temp directory for project working directory
    process.chdir(tempDir);

    // Setup mock approval callback
    mockApprovalCallback = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalDecision.ALLOW_ALWAYS),
    };

    // Create project with MCP server configuration
    project = Project.create('Test Project', tempDir, 'Integration test project');

    // Add MCP server to project
    project.addMCPServer('test-server', {
      command: 'node',
      args: ['test-server.js'],
      enabled: true,
      tools: {
        echo_test: 'allow',
      },
    });

    // Create session (will auto-initialize MCP servers)
    session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      approvalCallback: mockApprovalCallback,
      configuration: {
        providerInstanceId: 'test-provider',
        modelId: 'test-model',
      },
    });

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Restore working directory BEFORE cleanup
    process.chdir(originalCwd);

    // Cleanup session (shuts down MCP servers)
    if (session) {
      session.destroy();
    }

    // Remove temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should complete full integration: config → server start → tool discovery → tool execution via ToolExecutor', async () => {
    // Step 1: Verify project MCP configuration was added
    const projectServers = project.getMCPServers();
    expect(projectServers['test-server']).toBeDefined();
    expect(projectServers['test-server'].enabled).toBe(true);
    expect(projectServers['test-server'].tools.echo_test).toBe('allow');

    // Step 2: Wait for MCP server initialization to complete
    await session.waitForMCPInitialization();

    // Step 3: Get ToolExecutor from session's coordinator agent
    const coordinatorAgent = session.getCoordinatorAgent();
    expect(coordinatorAgent).toBeDefined();
    const toolExecutor = coordinatorAgent!.toolExecutor;

    // Step 4: Wait for MCP tool discovery to complete properly
    const mcpManager = session.getMCPServerManager();
    await toolExecutor.registerMCPToolsAndWait(mcpManager);

    // Step 5: Verify MCP tool is available through ToolExecutor
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

    // Create proper context for execution with agent (required for approval)
    const context = {
      signal: new AbortController().signal,
      agent: coordinatorAgent,
    };

    // Step 6: Execute tool through ToolExecutor (this tests the full approval flow)
    const result = await toolExecutor.executeTool(toolCall, context);

    expect(result.status).toBe('completed');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe('Echo: Hello MCP Integration!');

    // For allow tools, approval callback should NOT be called (bypassed)
    expect(mockApprovalCallback.requestApproval).not.toHaveBeenCalled();
  });

  it('should respect MCP approval policies - DISABLE should not appear in available tools', async () => {
    // Update the project MCP server configuration to disable the tool
    project.updateMCPServer('test-server', {
      command: 'node',
      args: ['test-server.js'],
      enabled: true,
      tools: {
        echo_test: 'disable', // This tool should not appear in available tools
      },
    });

    // Manually restart the MCP server with new config since event handling isn't fully set up yet
    await session.restartMCPServer('test-server');

    // Get updated toolExecutor from session after config change
    const updatedAgent = session.getCoordinatorAgent();
    const toolExecutor = updatedAgent!.toolExecutor;

    // Wait for tool discovery with updated config
    const mcpManager = session.getMCPServerManager();
    await toolExecutor.registerMCPToolsAndWait(mcpManager);

    // Disabled tools should not appear in available tool names
    const availableToolNames = toolExecutor.getAvailableToolNames();
    expect(availableToolNames).not.toContain('test-server/echo_test');

    // Should also not be retrievable directly
    const disabledTool = toolExecutor.getTool('test-server/echo_test');
    expect(disabledTool).toBeUndefined();
  });

  it('should handle MCP tool execution failures gracefully', async () => {
    // Wait for MCP initialization and tool discovery
    await session.waitForMCPInitialization();

    // Get toolExecutor from session
    const agent = session.getCoordinatorAgent();
    const toolExecutor = agent!.toolExecutor;

    // Wait for tool discovery
    const mcpManager = session.getMCPServerManager();
    await toolExecutor.registerMCPToolsAndWait(mcpManager);

    // Test that the tool exists and can be retrieved
    const mcpTool = toolExecutor.getTool('test-server/echo_test');
    expect(mcpTool).toBeDefined();

    // Directly test the tool's error handling by calling execute with invalid args
    // This bypasses the complex mock setup issues
    const result = await mcpTool!.execute(
      { invalidArg: 'test' },
      {
        signal: new AbortController().signal,
      }
    );

    // Should return validation error due to invalid arguments
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('Validation failed');
  });

  it('should verify MCP approval levels are working in ToolExecutor', async () => {
    // Test that our approval level integration is working correctly

    // Wait for MCP initialization
    await session.waitForMCPInitialization();

    // Get toolExecutor from session
    const agent = session.getCoordinatorAgent();
    const toolExecutor = agent!.toolExecutor;

    // Wait for tool discovery
    const mcpManager = session.getMCPServerManager();
    await toolExecutor.registerMCPToolsAndWait(mcpManager);

    // Verify tool is available (with allow config from beforeEach)
    const availableTools = toolExecutor.getAvailableToolNames();
    expect(availableTools).toContain('test-server/echo_test');

    // Test execution of allow tool (should work without Agent context)
    const toolCall: ToolCall = {
      id: 'test-approval-level',
      name: 'test-server/echo_test',
      arguments: { message: 'Testing approval levels' },
    };

    const result = await toolExecutor.executeTool(toolCall, {
      signal: new AbortController().signal,
      agent: agent,
    });

    // Should execute successfully because of allow approval level
    expect(result.status).toBe('completed');
    expect(result.content[0].text).toBe('Echo: Testing approval levels');

    // Approval callback should not be called for allow tools
    expect(mockApprovalCallback.requestApproval).not.toHaveBeenCalled();
  });
});
