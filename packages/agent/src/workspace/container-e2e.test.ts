// ABOUTME: End-to-end test for containerized workspace with real container execution
// ABOUTME: Creates a git repo workspace and verifies isolated execution and cleanup

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BashTool } from '@lace/core/tools/implementations/bash';
import { FileReadTool } from '@lace/core/tools/implementations/file_read';
import { FileWriteTool } from '@lace/core/tools/implementations/file_write';
import { setupCoreTest } from '@lace/core/test-utils/core-test-setup';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolContext } from '@lace/core/tools/types';
import { WorkspaceManagerFactory } from './workspace-manager';

function listContainers(): Array<{ id?: string; name?: string; configuration?: { id?: string } }> {
  try {
    const output = execSync('container list --format json 2>/dev/null || true', {
      encoding: 'utf-8',
    });
    const trimmed = output.trim();
    if (!trimmed) return [];

    // `container list --format json` can return either a JSON array or newline-delimited JSON.
    if (trimmed.startsWith('[')) {
      return JSON.parse(trimmed) as Array<{
        id?: string;
        name?: string;
        configuration?: { id?: string };
      }>;
    }

    return trimmed
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

describe('Container E2E Test', () => {
  setupCoreTest();
  let tempProjectDir: string;

  beforeEach(() => {
    if (process.platform !== 'darwin') {
      return;
    }

    tempProjectDir = mkdtempSync(join(tmpdir(), 'container-e2e-'));

    execSync('git init', { cwd: tempProjectDir });
    execSync('git config user.email "test@example.com"', { cwd: tempProjectDir });
    execSync('git config user.name "Test User"', { cwd: tempProjectDir });

    writeFileSync(join(tempProjectDir, 'README.md'), '# Container Test Project\n');
    writeFileSync(join(tempProjectDir, 'test.txt'), 'Original content from host');
    writeFileSync(join(tempProjectDir, 'script.js'), 'console.log("Hello from container");');

    execSync('git add .', { cwd: tempProjectDir });
    execSync('git commit -m "Initial commit"', { cwd: tempProjectDir });
  });

  afterEach(() => {
    if (tempProjectDir && existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  it('creates container workspace and executes isolated commands', async function () {
    if (process.platform !== 'darwin') {
      this.skip();
      return;
    }

    const sessionId = 'container-e2e-1';
    const workspaceManager = WorkspaceManagerFactory.get('container');
    const workspaceInfo = await workspaceManager.createWorkspace(tempProjectDir, sessionId);

    try {
      expect(workspaceInfo.containerId).toMatch(/^workspace-/);
      expect(workspaceInfo.clonePath).not.toBe(tempProjectDir);
      expect(existsSync(workspaceInfo.clonePath)).toBe(true);
      expect(existsSync(join(workspaceInfo.clonePath, 'README.md'))).toBe(true);

      const filesRead = new Set<string>();

      const toolContext: ToolContext = {
        signal: new AbortController().signal,
        workspaceManager,
        workspaceInfo,
        workingDirectory: '/workspace',
        hasFileBeenRead: (path: string) => filesRead.has(path),
      };

      const bashTool = new BashTool();
      const pwdResult = await bashTool.execute({ command: 'pwd' }, toolContext);
      expect(pwdResult.status).toBe('completed');
      const pwdOutput = JSON.parse((pwdResult.content[0] as { text: string }).text);
      expect(pwdOutput.exitCode).toBe(0);
      expect(pwdOutput.stdoutPreview).toContain('/workspace');

      await bashTool.execute(
        { command: 'echo "Created in container" > container-file.txt' },
        toolContext
      );

      const readTool = new FileReadTool();
      const readOriginal = await readTool.execute({ path: 'test.txt' }, toolContext);
      expect(readOriginal.status).toBe('completed');
      expect((readOriginal.content[0] as { text: string }).text).toContain(
        'Original content from host'
      );

      const readContainerFile = await readTool.execute({ path: 'container-file.txt' }, toolContext);
      expect(readContainerFile.status).toBe('completed');
      expect((readContainerFile.content[0] as { text: string }).text).toContain(
        'Created in container'
      );

      filesRead.add(join(workspaceInfo.clonePath, 'test.txt'));
      const writeTool = new FileWriteTool();
      const writeResult = await writeTool.execute(
        { path: 'tool-created.txt', content: 'Created by FileWriteTool in workspace' },
        toolContext
      );
      expect(writeResult.status).toBe('completed');

      expect(existsSync(join(workspaceInfo.clonePath, 'tool-created.txt'))).toBe(true);
      expect(existsSync(join(tempProjectDir, 'tool-created.txt'))).toBe(false);

      const catResult = await bashTool.execute({ command: 'cat tool-created.txt' }, toolContext);
      expect(catResult.status).toBe('completed');
      const catOutput = JSON.parse((catResult.content[0] as { text: string }).text);
      expect(catOutput.stdoutPreview).toContain('Created by FileWriteTool in workspace');

      await bashTool.execute({ command: 'echo "Modified in container" > test.txt' }, toolContext);
      expect(readFileSync(join(tempProjectDir, 'test.txt'), 'utf-8')).toBe(
        'Original content from host'
      );
      expect(readFileSync(join(workspaceInfo.clonePath, 'test.txt'), 'utf-8')).toContain(
        'Modified in container'
      );
    } finally {
      await workspaceManager.destroyWorkspace(sessionId);
    }
  });

  it('cleans up container and clone directory on destroy', async function () {
    if (process.platform !== 'darwin') {
      this.skip();
      return;
    }

    const sessionId = 'container-e2e-2';
    const workspaceManager = WorkspaceManagerFactory.get('container');
    const workspaceInfo = await workspaceManager.createWorkspace(tempProjectDir, sessionId);

    const containerId = workspaceInfo.containerId;
    expect(containerId).toBeDefined();

    const existsBefore = listContainers().some((c) => c.configuration?.id === containerId);
    expect(existsBefore).toBe(true);

    await workspaceManager.destroyWorkspace(sessionId);

    const existsAfter = listContainers().some((c) => c.configuration?.id === containerId);
    expect(existsAfter).toBe(false);

    expect(existsSync(workspaceInfo.clonePath)).toBe(false);
  });
});
