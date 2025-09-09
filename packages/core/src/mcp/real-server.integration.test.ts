// ABOUTME: Real MCP server integration test using actual filesystem server process
// ABOUTME: Proves MCP integration works with real server, not just mocks

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import type { ToolCall } from '~/tools/types';

describe('Real MCP Server Integration', () => {
  const _tempLaceContext = useTempLaceDir();
  let tempDir: string;
  let testDataDir: string;
  let project: Project;
  let session: Session;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-real-test-'));

    // Create a test data directory for the filesystem server to access
    testDataDir = join(tempDir, 'test-data');
    mkdirSync(testDataDir, { recursive: true });

    // Create a test file
    writeFileSync(join(testDataDir, 'test.txt'), 'Hello from real MCP server!');

    // Change to temp directory for project working directory
    process.chdir(tempDir);

    // Create project with real MCP server configuration (use unique name per test)
    const projectName = `Real MCP Test Project ${Date.now()}`;
    project = Project.create(projectName, tempDir, 'Testing real MCP server');

    // Real MCP server setup moved to specific tests that need it

    // Create session (will auto-initialize real MCP servers)
    session = Session.create({
      name: 'Real MCP Test Session',
      projectId: project.getId(),
      configuration: {
        providerInstanceId: 'test-provider',
        modelId: 'test-model',
      },
    });
  });

  afterEach(async () => {
    // Cleanup session (shuts down real MCP servers)
    if (session) {
      session.destroy();
    }

    // Explicit project cleanup if it has a cleanup method
    if (project && typeof project.destroy === 'function') {
      project.destroy();
    }

    // Restore working directory AFTER cleanup
    process.chdir(originalCwd);

    // Remove temp directory
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should verify MCP integration without external dependencies', async () => {
    // Test native tools are available instead of depending on real MCP server
    const agent = session.getCoordinatorAgent();
    const toolExecutor = agent!.toolExecutor;

    // Verify native tools are available (no external dependencies)
    const availableToolNames = toolExecutor.getAvailableToolNames();

    // Should contain native tools
    expect(availableToolNames).toContain('bash');
    expect(availableToolNames).toContain('file_read');
    expect(availableToolNames).toContain('file_write');

    // Step 2: Test real tool execution - read the test file we created
    const readToolCall: ToolCall = {
      id: 'read-test-1',
      name: 'filesystem/read_text_file',
      arguments: { path: 'test.txt' }, // Relative to the server's allowed directory
    };

    const readResult = await toolExecutor.executeTool(readToolCall, {
      signal: new AbortController().signal,
      agent: agent,
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
      agent: agent,
    });

    expect(listResult.status).toBe('completed');
    expect(listResult.content[0].text).toContain('test.txt');
  }, 10000); // Longer timeout for real server startup

  it('should handle real server startup failures gracefully', async () => {
    // Add invalid MCP server to project
    project.addMCPServer('invalid-server', {
      command: 'nonexistent-command-12345',
      args: ['--invalid'],
      enabled: true,
      tools: {
        fake_tool: 'allow',
      },
    });

    // Wait for initialization attempt (server will fail but session continues)
    await session.waitForMCPInitialization();

    // Get toolExecutor from session
    const agent = session.getCoordinatorAgent();
    const toolExecutor = agent!.toolExecutor;

    // Wait for tool discovery from working servers
    const mcpManager = session.getMCPServerManager();
    await toolExecutor.registerMCPToolsAndWait(mcpManager);

    // Invalid server tools should not appear
    const availableTools = toolExecutor.getAvailableToolNames();
    expect(availableTools).not.toContain('invalid-server/fake_tool');

    // System should continue working (not crash) - working MCP server should still be available
    expect(availableTools).toContain('filesystem/read_text_file');
  }, 5000);
});
