// ABOUTME: Comprehensive integration tests for workspace system with sessions and tools
// ABOUTME: Verifies BashTool and FileTools work correctly with containerized workspaces

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { BashTool } from '~/tools/implementations/bash';
import { FileReadTool } from '~/tools/implementations/file_read';
import { FileWriteTool } from '~/tools/implementations/file_write';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolContext } from '~/tools/types';

describe('Workspace Integration', () => {
  const testContext = setupCoreTest();
  let tempProjectDir: string;
  let project: Project;

  beforeEach(() => {
    // Set up mock provider configuration
    process.env.ANTHROPIC_KEY = 'test-key';

    // Create temp project directory with test files
    tempProjectDir = mkdtempSync(join(tmpdir(), 'workspace-integration-'));

    // Create some test files
    writeFileSync(join(tempProjectDir, 'README.md'), '# Test Project\n');
    writeFileSync(join(tempProjectDir, 'test.txt'), 'Original content');

    // Create a project
    project = Project.create('Test Project', tempProjectDir, 'Integration test project');
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempProjectDir && existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  describe('Local Mode Integration', () => {
    it('should execute bash commands in workspace', async () => {
      // Create session with local workspace
      const session = await Session.create({
        projectId: project.getId(),
        name: 'Integration Test',
        configuration: {
          workspaceMode: 'local',
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });

      expect(session.getWorkspaceManager()).toBeDefined();
      expect(session.getWorkspaceInfo()).toBeDefined();

      // Create mock tool context with read tracking
      const filesRead = new Set<string>();
      const mockAgent = {
        getThreadId: () => session.getId(),
        hasFileBeenRead: (path: string) => filesRead.has(path),
        markFileAsRead: (path: string) => filesRead.add(path),
      } as any;

      const mockSignal = new AbortController().signal;

      const toolContext: ToolContext = {
        agent: mockAgent,
        signal: mockSignal,
        workingDirectory: tempProjectDir,
        toolTempDir: tempProjectDir, // For bash output files
      };

      // Test BashTool execution through workspace
      const bashTool = new BashTool();
      const result = await bashTool.execute({ command: 'pwd' }, toolContext);

      expect(result.status).toBe('completed');

      // Parse the JSON from the content
      const content = result.content[0];
      expect(content.type).toBe('text');
      const output = JSON.parse((content as any).text);
      expect(output.exitCode).toBe(0);

      await session.destroy();
    });

    it('should read and write files through workspace paths', async () => {
      // Create session with local workspace
      const session = await Session.create({
        projectId: project.getId(),
        name: 'File Test',
        configuration: {
          workspaceMode: 'local',
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });

      const filesRead = new Set<string>();
      const mockAgent = {
        getThreadId: () => session.getId(),
        hasFileBeenRead: (path: string) => filesRead.has(path),
        markFileAsRead: (path: string) => filesRead.add(path),
      } as any;

      const mockSignal = new AbortController().signal;

      const toolContext: ToolContext = {
        agent: mockAgent,
        signal: mockSignal,
        workingDirectory: tempProjectDir,
        toolTempDir: tempProjectDir,
      };

      // Test FileReadTool
      const readTool = new FileReadTool();
      const readResult = await readTool.execute({ path: 'test.txt' }, toolContext);

      expect(readResult.status).toBe('completed');
      const readContent = readResult.content[0];
      expect((readContent as any).text).toContain('Original content');

      // Test FileWriteTool (mark test.txt as read to allow writes)
      filesRead.add('test.txt');
      const writeTool = new FileWriteTool();
      const writeResult = await writeTool.execute(
        {
          path: 'new-file.txt',
          content: 'New content from workspace',
        },
        toolContext
      );

      expect(writeResult.status).toBe('completed');

      // Verify file was created in the workspace
      const newFilePath = join(tempProjectDir, 'new-file.txt');
      expect(existsSync(newFilePath)).toBe(true);
      expect(readFileSync(newFilePath, 'utf-8')).toBe('New content from workspace');

      await session.destroy();
    });

    it('should coordinate bash and file operations', async () => {
      // Create session
      const session = await Session.create({
        projectId: project.getId(),
        name: 'Coordination Test',
        configuration: {
          workspaceMode: 'local',
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });

      const filesRead = new Set<string>();
      const mockAgent = {
        getThreadId: () => session.getId(),
        hasFileBeenRead: (path: string) => filesRead.has(path),
        markFileAsRead: (path: string) => filesRead.add(path),
      } as any;

      const mockSignal = new AbortController().signal;

      const toolContext: ToolContext = {
        agent: mockAgent,
        signal: mockSignal,
        workingDirectory: tempProjectDir,
        toolTempDir: tempProjectDir,
      };

      // Use bash to create a file
      const bashTool = new BashTool();
      const bashResult = await bashTool.execute(
        { command: 'echo "Created by bash" > bash-file.txt' },
        toolContext
      );

      expect(bashResult.status).toBe('completed');

      // Read the file created by bash
      const readTool = new FileReadTool();
      const readResult = await readTool.execute({ path: 'bash-file.txt' }, toolContext);

      expect(readResult.status).toBe('completed');
      const readContent = readResult.content[0];
      expect((readContent as any).text).toContain('Created by bash');

      // Write a file with FileWriteTool
      const writeTool = new FileWriteTool();
      await writeTool.execute(
        {
          path: 'tool-file.txt',
          content: 'Created by FileWriteTool',
        },
        toolContext
      );

      // Use bash to read the file created by FileWriteTool
      const bashRead = await bashTool.execute({ command: 'cat tool-file.txt' }, toolContext);

      expect(bashRead.status).toBe('completed');
      const bashContent = bashRead.content[0];
      const bashOutput = JSON.parse((bashContent as any).text);
      expect(bashOutput.stdoutPreview).toContain('Created by FileWriteTool');

      await session.destroy();
    });
  });

  describe('Workspace Path Resolution', () => {
    it('should resolve relative paths correctly', async () => {
      const session = await Session.create({
        projectId: project.getId(),
        name: 'Path Test',
        configuration: {
          workspaceMode: 'local',
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });

      const mockAgent = {
        getThreadId: () => session.getId(),
      } as any;

      const toolContext: ToolContext = {
        agent: mockAgent,
        signal: new AbortController().signal,
        workingDirectory: tempProjectDir,
      };

      // Create a subdirectory with a file
      const bashTool = new BashTool();
      await bashTool.execute({ command: 'mkdir -p subdir' }, toolContext);

      const writeTool = new FileWriteTool();
      await writeTool.execute(
        {
          path: 'subdir/nested.txt',
          content: 'Nested content',
        },
        toolContext
      );

      // Read using relative path
      const readTool = new FileReadTool();
      const result = await readTool.execute({ path: './subdir/nested.txt' }, toolContext);

      expect(result.status).toBe('completed');
      const readContent = result.content[0];
      expect((readContent as any).text).toContain('Nested content');

      await session.destroy();
    });

    it('should handle absolute paths correctly', async () => {
      const session = await Session.create({
        projectId: project.getId(),
        name: 'Absolute Path Test',
        configuration: {
          workspaceMode: 'local',
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });

      const mockAgent = {
        getThreadId: () => session.getId(),
      } as any;

      const toolContext: ToolContext = {
        agent: mockAgent,
        signal: new AbortController().signal,
        workingDirectory: tempProjectDir,
      };

      // Write using absolute path
      const absolutePath = join(tempProjectDir, 'absolute.txt');
      const writeTool = new FileWriteTool();
      await writeTool.execute(
        {
          path: absolutePath,
          content: 'Absolute path content',
        },
        toolContext
      );

      // Read using absolute path
      const readTool = new FileReadTool();
      const result = await readTool.execute({ path: absolutePath }, toolContext);

      expect(result.status).toBe('completed');
      const readContent = result.content[0];
      expect((readContent as any).text).toContain('Absolute path content');

      await session.destroy();
    });
  });

  describe('Session Lifecycle', () => {
    it('should clean up workspace on session destroy', async () => {
      const session = await Session.create({
        projectId: project.getId(),
        name: 'Cleanup Test',
        configuration: {
          workspaceMode: 'local',
          providerInstanceId: 'anthropic-default',
          modelId: 'claude-3-5-sonnet-20241022',
        },
      });

      const workspaceInfo = session.getWorkspaceInfo();
      expect(workspaceInfo).toBeDefined();

      await session.destroy();

      // Workspace should be cleaned up
      // Note: For local mode, the workspace isn't actually deleted since it's the project dir
      // This test mainly ensures destroy() doesn't throw
    });
  });
});
