// ABOUTME: Tests for WorkspaceContainerManager that manages containerized session workspaces
// ABOUTME: Integrates CloneManager with AppleContainerRuntime for isolated development environments

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceContainerManager } from './workspace-container-manager';
import { AppleContainerRuntime } from '~/containers/apple-container';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

describe('WorkspaceContainerManager', () => {
  const _testContext = setupCoreTest();
  let manager: WorkspaceContainerManager;
  let testDir: string;
  let projectDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `workspace-manager-test-${uuidv4()}`);
    projectDir = join(testDir, 'test-project');
    mkdirSync(projectDir, { recursive: true });

    // Initialize a git repo in projectDir
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@example.com"', { cwd: projectDir });
    execSync('git config user.name "Test User"', { cwd: projectDir });

    // Create test files
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
      })
    );
    writeFileSync(join(projectDir, 'index.js'), 'console.log("Hello from test project");');
    execSync('git add .', { cwd: projectDir });
    execSync('git commit -m "Initial commit"', { cwd: projectDir });

    // Create manager instance
    manager = new WorkspaceContainerManager(new AppleContainerRuntime());
  });

  afterEach(async () => {
    // Clean up all workspaces
    const workspaces = await manager.listWorkspaces();
    for (const workspace of workspaces) {
      await manager.destroyWorkspace(workspace.sessionId);
    }

    // Clean up test directory - clones are in isolated LACE_DIR and will be cleaned up automatically
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createWorkspace', () => {
    it('should create a containerized workspace with cloned repository', async () => {
      const sessionId = 'test-session-1';

      const workspace = await manager.createWorkspace(projectDir, sessionId);

      expect(workspace).toEqual({
        sessionId,
        projectDir,
        containerMountPath: '/workspace',
        clonePath: expect.stringContaining('/worktrees'),
        branchName: `lace/session/${sessionId}`,
        containerId: expect.stringContaining(sessionId),
        state: 'running',
      });

      // Verify clone was created
      expect(existsSync(workspace.clonePath)).toBe(true);

      // Verify container is running
      const info = await manager.inspectWorkspace(sessionId);
      expect(info?.state).toBe('running');
    });

    it('should mount the cloned repository in the container', async () => {
      const sessionId = 'test-session-2';

      const _workspace = await manager.createWorkspace(projectDir, sessionId);

      // Execute command in container to verify mount
      const result = await manager.executeInWorkspace(sessionId, {
        command: ['ls', '/workspace'],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('package.json');
      expect(result.stdout).toContain('index.js');
    });

    it('should return existing workspace if session already has one', async () => {
      const sessionId = 'test-session-duplicate';

      const workspace1 = await manager.createWorkspace(projectDir, sessionId);
      const workspace2 = await manager.createWorkspace(projectDir, sessionId);

      // Should return the same workspace
      expect(workspace2.sessionId).toBe(workspace1.sessionId);
      expect(workspace2.clonePath).toBe(workspace1.clonePath);
      expect(workspace2.containerId).toBe(workspace1.containerId);
    });
  });

  describe('destroyWorkspace', () => {
    it('should remove container and clone', async () => {
      const sessionId = 'test-destroy';

      const workspace = await manager.createWorkspace(projectDir, sessionId);
      expect(existsSync(workspace.clonePath)).toBe(true);

      await manager.destroyWorkspace(sessionId);

      // Clone should be removed
      expect(existsSync(workspace.clonePath)).toBe(false);

      // Container should be removed
      const info = await manager.inspectWorkspace(sessionId);
      expect(info).toBeNull();
    });

    it('should not throw if workspace does not exist', async () => {
      await expect(manager.destroyWorkspace('non-existent')).resolves.not.toThrow();
    });
  });

  describe('executeInWorkspace', () => {
    it('should execute commands in the container', async () => {
      const sessionId = 'test-exec';

      await manager.createWorkspace(projectDir, sessionId);

      // Use a simple echo command that should work in any container
      const result = await manager.executeInWorkspace(sessionId, {
        command: ['echo', 'Hello from container'],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('Hello from container');
    });

    it('should handle environment variables', async () => {
      const sessionId = 'test-env';

      await manager.createWorkspace(projectDir, sessionId);

      const result = await manager.executeInWorkspace(sessionId, {
        command: ['sh', '-c', 'echo $TEST_VAR'],
        environment: { TEST_VAR: 'test_value' },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('test_value');
    });

    it('should throw if workspace does not exist', async () => {
      await expect(
        manager.executeInWorkspace('non-existent', { command: ['echo', 'test'] })
      ).rejects.toThrow('Workspace not found');
    });
  });

  describe('inspectWorkspace', () => {
    it('should return workspace info', async () => {
      const sessionId = 'test-inspect';

      const workspace = await manager.createWorkspace(projectDir, sessionId);

      const info = await manager.inspectWorkspace(sessionId);

      expect(info).toEqual({
        sessionId,
        projectDir,
        containerMountPath: '/workspace',
        clonePath: workspace.clonePath,
        branchName: workspace.branchName,
        containerId: workspace.containerId,
        state: 'running',
      });
    });

    it('should return null for non-existent workspace', async () => {
      const info = await manager.inspectWorkspace('non-existent');
      expect(info).toBeNull();
    });
  });

  describe('listWorkspaces', () => {
    it('should list all active workspaces', async () => {
      const sessionIds = ['session-1', 'session-2', 'session-3'];

      for (const sessionId of sessionIds) {
        await manager.createWorkspace(projectDir, sessionId);
      }

      const workspaces = await manager.listWorkspaces();

      expect(workspaces).toHaveLength(3);
      const ids = workspaces.map((w) => w.sessionId).sort();
      expect(ids).toEqual(sessionIds.sort());
    });

    it('should return empty array when no workspaces exist', async () => {
      const workspaces = await manager.listWorkspaces();
      expect(workspaces).toEqual([]);
    });
  });

  describe('translatePath', () => {
    it('should translate host paths to container paths', async () => {
      const sessionId = 'test-translate';

      const workspace = await manager.createWorkspace(projectDir, sessionId);

      const hostPath = join(workspace.clonePath, 'src', 'index.js');
      const containerPath = manager.translateToContainer(sessionId, hostPath);

      expect(containerPath).toBe('/workspace/src/index.js');
    });

    it('should translate container paths to host paths', async () => {
      const sessionId = 'test-translate-2';

      const workspace = await manager.createWorkspace(projectDir, sessionId);

      const containerPath = '/workspace/src/index.js';
      const hostPath = manager.translateToHost(sessionId, containerPath);

      expect(hostPath).toBe(join(workspace.clonePath, 'src', 'index.js'));
    });

    it('should return original path if workspace not found', () => {
      const path = '/some/path';
      expect(manager.translateToContainer('non-existent', path)).toBe(path);
      expect(manager.translateToHost('non-existent', path)).toBe(path);
    });
  });
});
