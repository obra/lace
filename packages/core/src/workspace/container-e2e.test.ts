// ABOUTME: End-to-end test for containerized workspace with real container execution
// ABOUTME: Creates git repo, session with container, and verifies isolated execution

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { BashTool } from '~/tools/implementations/bash';
import { FileReadTool } from '~/tools/implementations/file_read';
import { FileWriteTool } from '~/tools/implementations/file_write';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolContext } from '~/tools/types';

describe('Container E2E Test', () => {
  const _testContext = setupCoreTest();
  let tempProjectDir: string;
  let project: Project;

  beforeEach(() => {
    // Skip on non-macOS platforms
    if (process.platform !== 'darwin') {
      console.log('Skipping container E2E test on non-macOS platform');
      return;
    }

    // Set up mock provider configuration
    process.env.ANTHROPIC_KEY = 'test-key';

    // Create temp project directory
    tempProjectDir = mkdtempSync(join(tmpdir(), 'container-e2e-'));

    // Initialize as git repository
    execSync('git init', { cwd: tempProjectDir });
    execSync('git config user.email "test@example.com"', { cwd: tempProjectDir });
    execSync('git config user.name "Test User"', { cwd: tempProjectDir });

    // Create test files
    writeFileSync(join(tempProjectDir, 'README.md'), '# Container Test Project\n');
    writeFileSync(join(tempProjectDir, 'test.txt'), 'Original content from host');
    writeFileSync(join(tempProjectDir, 'script.js'), 'console.log("Hello from container");');

    // Commit files
    execSync('git add .', { cwd: tempProjectDir });
    execSync('git commit -m "Initial commit"', { cwd: tempProjectDir });

    // Create a project
    project = Project.create(
      'Container Test Project',
      tempProjectDir,
      'E2E test with real container'
    );
  });

  afterEach(async () => {
    // Clean up any running containers
    try {
      // List and kill any test containers
      const output = execSync('container list --format json 2>/dev/null || true', {
        encoding: 'utf-8',
      });

      if (output) {
        const containers = output
          .split('\n')
          .filter((line) => line)
          .map((line) => JSON.parse(line))
          .filter((c) => c.name?.includes('workspace-'));

        for (const container of containers) {
          try {
            execSync(`container delete ${container.id} 2>/dev/null || true`);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    } catch {
      // Ignore if container command fails
    }

    // Clean up temp directory
    if (tempProjectDir && existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  it('should create container workspace and execute isolated commands', async function () {
    // Skip on non-macOS
    if (process.platform !== 'darwin') {
      this.skip();
      return;
    }

    // Create session with container workspace
    const session = await Session.create({
      projectId: project.getId(),
      name: 'Container E2E Test',
      configuration: {
        workspaceMode: 'container',
        providerInstanceId: 'anthropic-default',
        modelId: 'claude-3-5-sonnet-20241022',
      },
    });

    try {
      const workspaceInfo = session.getWorkspaceInfo();
      expect(workspaceInfo).toBeDefined();
      expect(workspaceInfo?.containerId).toMatch(/^workspace-/);
      expect(workspaceInfo?.clonePath).not.toBe(tempProjectDir);
      expect(workspaceInfo?.clonePath).toContain('/clones/');

      // Verify the clone was created
      expect(existsSync(workspaceInfo!.clonePath)).toBe(true);
      expect(existsSync(join(workspaceInfo!.clonePath, 'README.md'))).toBe(true);

      // Create tool context
      const filesRead = new Set<string>();
      const mockAgent = {
        getThreadId: () => session.getId(),
        hasFileBeenRead: (path: string) => filesRead.has(path),
        markFileAsRead: (path: string) => filesRead.add(path),
      } as any;

      const toolContext: ToolContext = {
        agent: mockAgent,
        signal: new AbortController().signal,
        workingDirectory: '/workspace', // Use container's working directory
        toolTempDir: tempProjectDir,
      };

      // Test 1: Execute bash command in container
      const bashTool = new BashTool();
      const pwdResult = await bashTool.execute({ command: 'pwd' }, toolContext);

      expect(pwdResult.status).toBe('completed');
      // Parse the JSON from the content
      const pwdContent = pwdResult.content[0];
      expect(pwdContent.type).toBe('text');
      const pwdOutput = JSON.parse((pwdContent as any).text);
      expect(pwdOutput.exitCode).toBe(0);
      // In container, working directory should be /workspace
      expect(pwdOutput.stdoutPreview).toContain('/workspace');

      // Test 2: Create a file in the container
      const createFileResult = await bashTool.execute(
        { command: 'echo "Created in container" > container-file.txt' },
        toolContext
      );

      expect(createFileResult.status).toBe('completed');

      // Test 3: Read files using FileReadTool (should read from clone)
      const readTool = new FileReadTool();
      const readOriginal = await readTool.execute({ path: 'test.txt' }, toolContext);

      expect(readOriginal.status).toBe('completed');
      const readContent = readOriginal.content[0];
      expect(readContent.type).toBe('text');
      expect((readContent as any).text).toContain('Original content from host');

      // Test 4: File created in container should be in clone
      const readContainerFile = await readTool.execute({ path: 'container-file.txt' }, toolContext);

      expect(readContainerFile.status).toBe('completed');
      const containerFileContent = readContainerFile.content[0];
      expect((containerFileContent as any).text).toContain('Created in container');

      // Test 5: Write file using FileWriteTool (should write to clone)
      filesRead.add('test.txt'); // Mark as read to allow writes
      const writeTool = new FileWriteTool();
      const writeResult = await writeTool.execute(
        {
          path: 'tool-created.txt',
          content: 'Created by FileWriteTool in workspace',
        },
        toolContext
      );

      expect(writeResult.status).toBe('completed');

      // Test 6: Verify isolation - file should be in clone, not original
      expect(existsSync(join(workspaceInfo!.clonePath, 'tool-created.txt'))).toBe(true);
      expect(existsSync(join(tempProjectDir, 'tool-created.txt'))).toBe(false);

      // Test 7: Container can see the file created by tool
      const catResult = await bashTool.execute({ command: 'cat tool-created.txt' }, toolContext);

      expect(catResult.status).toBe('completed');
      const catContent = catResult.content[0];
      const catOutput = JSON.parse((catContent as any).text);
      expect(catOutput.stdoutPreview).toContain('Created by FileWriteTool in workspace');

      // Test 8: Verify container isolation - changes don't affect host
      await bashTool.execute({ command: 'echo "Modified in container" > test.txt' }, toolContext);

      // Original file should be unchanged
      const hostContent = readFileSync(join(tempProjectDir, 'test.txt'), 'utf-8');
      expect(hostContent).toBe('Original content from host');

      // Clone should have the modified version
      const cloneContent = readFileSync(join(workspaceInfo!.clonePath, 'test.txt'), 'utf-8');
      expect(cloneContent).toContain('Modified in container');
    } finally {
      // Clean up session and container
      await session.destroy();
    }
  });

  it('should handle container lifecycle properly', async function () {
    if (process.platform !== 'darwin') {
      this.skip();
      return;
    }

    const session = await Session.create({
      projectId: project.getId(),
      name: 'Lifecycle Test',
      configuration: {
        workspaceMode: 'container',
        providerInstanceId: 'anthropic-default',
        modelId: 'claude-3-5-sonnet-20241022',
      },
    });

    const workspaceInfo = session.getWorkspaceInfo();
    const containerId = workspaceInfo?.containerId;

    expect(containerId).toBeDefined();

    // Container should exist
    const listBefore = execSync('container list --format json', { encoding: 'utf-8' });
    const containersBefore = JSON.parse(listBefore || '[]');

    const containerExists = containersBefore.some((c) => c.configuration?.id === containerId);
    expect(containerExists).toBe(true);

    // Destroy session
    await session.destroy();

    // Container should be cleaned up
    const listAfter = execSync('container list --format json 2>/dev/null || echo "[]"', {
      encoding: 'utf-8',
    });

    const containersAfter = JSON.parse(listAfter || '[]');
    const containerStillExists = containersAfter.some(
      (c: any) => c.configuration?.id === containerId
    );
    expect(containerStillExists).toBe(false);

    // Clone directory should be removed
    expect(existsSync(workspaceInfo!.clonePath)).toBe(false);
  });
});
