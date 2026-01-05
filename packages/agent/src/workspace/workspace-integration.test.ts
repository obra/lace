// ABOUTME: Integration tests for workspace managers and tool execution
// ABOUTME: Verifies BashTool and File tools work with workspace execution

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Project } from '@lace/core/projects/project';
import { BashTool } from '@lace/core/tools/implementations/bash';
import { FileReadTool } from '@lace/core/tools/implementations/file_read';
import { FileWriteTool } from '@lace/core/tools/implementations/file_write';
import { setupCoreTest } from '@lace/core/test-utils/core-test-setup';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolContext } from '@lace/core/tools/types';
import { WorkspaceManagerFactory } from './workspace-manager';

describe('Workspace Integration', () => {
  setupCoreTest();

  let tempProjectDir: string;
  let project: Project;

  beforeEach(() => {
    tempProjectDir = mkdtempSync(join(tmpdir(), 'workspace-integration-'));
    writeFileSync(join(tempProjectDir, 'README.md'), '# Test Project\n');
    writeFileSync(join(tempProjectDir, 'test.txt'), 'Original content');
    project = Project.create('Test Project', tempProjectDir, 'Integration test project');
  });

  afterEach(() => {
    if (tempProjectDir && existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  function makeContext(sessionId: string): ToolContext {
    const workspaceManager = WorkspaceManagerFactory.get('local');
    return {
      signal: new AbortController().signal,
      workingDirectory: tempProjectDir,
      threadId: sessionId,
      projectId: project.getId(),
      workspaceManager,
      // workspaceInfo filled in per-test after createWorkspace()
      hasFileBeenRead: () => true,
    };
  }

  it('executes bash commands in a local workspace', async () => {
    const sessionId = 'workspace-test-1';
    const workspaceManager = WorkspaceManagerFactory.get('local');
    const workspaceInfo = await workspaceManager.createWorkspace(tempProjectDir, sessionId);

    const toolContext = { ...makeContext(sessionId), workspaceInfo };

    const bashTool = new BashTool();
    const result = await bashTool.execute({ command: 'pwd' }, toolContext);

    expect(result.status).toBe('completed');
    const output = JSON.parse((result.content[0] as { text: string }).text);
    expect(output.exitCode).toBe(0);

    await workspaceManager.destroyWorkspace(sessionId);
  });

  it('reads and writes files through workspace paths', async () => {
    const sessionId = 'workspace-test-2';
    const workspaceManager = WorkspaceManagerFactory.get('local');
    const workspaceInfo = await workspaceManager.createWorkspace(tempProjectDir, sessionId);

    const toolContext = { ...makeContext(sessionId), workspaceInfo };

    const readTool = new FileReadTool();
    const readResult = await readTool.execute({ path: 'test.txt' }, toolContext);
    expect(readResult.status).toBe('completed');
    expect((readResult.content[0] as { text: string }).text).toContain('Original content');

    const writeTool = new FileWriteTool();
    const writeResult = await writeTool.execute(
      { path: 'new-file.txt', content: 'New content from workspace' },
      toolContext
    );
    expect(writeResult.status).toBe('completed');

    const newFilePath = join(tempProjectDir, 'new-file.txt');
    expect(existsSync(newFilePath)).toBe(true);
    expect(readFileSync(newFilePath, 'utf-8')).toBe('New content from workspace');

    await workspaceManager.destroyWorkspace(sessionId);
  });

  it('resolves relative and absolute paths consistently', async () => {
    const sessionId = 'workspace-test-3';
    const workspaceManager = WorkspaceManagerFactory.get('local');
    const workspaceInfo = await workspaceManager.createWorkspace(tempProjectDir, sessionId);

    const toolContext = { ...makeContext(sessionId), workspaceInfo };

    const writeTool = new FileWriteTool();
    await writeTool.execute({ path: 'subdir/nested.txt', content: 'Nested content' }, toolContext);

    const readTool = new FileReadTool();
    const nested = await readTool.execute({ path: './subdir/nested.txt' }, toolContext);
    expect(nested.status).toBe('completed');
    expect((nested.content[0] as { text: string }).text).toContain('Nested content');

    const absolutePath = join(tempProjectDir, 'absolute.txt');
    await writeTool.execute({ path: absolutePath, content: 'Absolute path content' }, toolContext);

    const absoluteRead = await readTool.execute({ path: absolutePath }, toolContext);
    expect(absoluteRead.status).toBe('completed');
    expect((absoluteRead.content[0] as { text: string }).text).toContain('Absolute path content');

    await workspaceManager.destroyWorkspace(sessionId);
    expect(await workspaceManager.inspectWorkspace(sessionId)).toBeNull();
  });
});
