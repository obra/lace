// ABOUTME: Tests for WorkspaceContainerManager that manages containerized session workspaces
// ABOUTME: Integrates CloneManager with AppleContainerRuntime for isolated development environments
// ABOUTME: Optimized for performance by sharing containers across non-destructive tests

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { WorkspaceContainerManager } from './workspace-container-manager';
import type { WorkspaceInfo } from './workspace-container-manager';
import { AppleContainerRuntime } from '@lace/agent/containers/apple-container';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

describe('WorkspaceContainerManager', () => {
  const _testContext = setupCoreTest();

  /**
   * Helper to create a test project directory with git repo
   */
  function createTestProject(): { testDir: string; projectDir: string } {
    const testDir = join(tmpdir(), `workspace-manager-test-${uuidv4()}`);
    const projectDir = join(testDir, 'test-project');
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

    return { testDir, projectDir };
  }

  /**
   * Tests that can share a single container (non-destructive, read-only operations)
   */
  describe('with shared workspace', () => {
    let manager: WorkspaceContainerManager;
    let testDir: string;
    let projectDir: string;
    let sharedWorkspace: WorkspaceInfo;
    const sharedSessionId = 'shared-test-session';

    beforeAll(async () => {
      const project = createTestProject();
      testDir = project.testDir;
      projectDir = project.projectDir;

      manager = new WorkspaceContainerManager(new AppleContainerRuntime());
      sharedWorkspace = await manager.createWorkspace(projectDir, sharedSessionId);
    }, 30000);

    afterAll(async () => {
      await manager.destroyWorkspace(sharedSessionId);
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    }, 30000);

    describe('createWorkspace', () => {
      it('should create a containerized workspace with cloned repository', () => {
        // Verify the shared workspace was created correctly
        expect(sharedWorkspace).toEqual({
          sessionId: sharedSessionId,
          projectDir,
          containerMountPath: '/workspace',
          clonePath: expect.stringContaining('/worktrees'),
          branchName: `lace/session/${sharedSessionId}`,
          containerId: expect.stringContaining(sharedSessionId),
          state: 'running',
        });

        // Verify clone was created
        expect(existsSync(sharedWorkspace.clonePath)).toBe(true);
      });
    });

    describe('inspectWorkspace', () => {
      it('should return workspace info', async () => {
        const info = await manager.inspectWorkspace(sharedSessionId);

        expect(info).toEqual({
          sessionId: sharedSessionId,
          projectDir,
          containerMountPath: '/workspace',
          clonePath: sharedWorkspace.clonePath,
          branchName: sharedWorkspace.branchName,
          containerId: sharedWorkspace.containerId,
          state: 'running',
        });
      });
    });

    describe('executeInWorkspace', () => {
      it('should execute commands in the container', async () => {
        const result = await manager.executeInWorkspace(sharedSessionId, {
          command: ['echo', 'Hello from container'],
        });

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('Hello from container');
      });

      it('should handle environment variables', async () => {
        const result = await manager.executeInWorkspace(sharedSessionId, {
          command: ['sh', '-c', 'echo $TEST_VAR'],
          environment: { TEST_VAR: 'test_value' },
        });

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('test_value');
      });
    });

    describe('translatePath', () => {
      it('should translate host paths to container paths', () => {
        const hostPath = join(sharedWorkspace.clonePath, 'src', 'index.js');
        const containerPath = manager.translateToContainer(sharedSessionId, hostPath);

        expect(containerPath).toBe('/workspace/src/index.js');
      });

      it('should translate container paths to host paths', () => {
        const containerPath = '/workspace/src/index.js';
        const hostPath = manager.translateToHost(sharedSessionId, containerPath);

        expect(hostPath).toBe(join(sharedWorkspace.clonePath, 'src', 'index.js'));
      });
    });
  });

  /**
   * Tests that need no container (test error handling for non-existent workspaces)
   */
  describe('without workspace', () => {
    let manager: WorkspaceContainerManager;

    beforeEach(() => {
      manager = new WorkspaceContainerManager(new AppleContainerRuntime());
    });

    describe('destroyWorkspace', () => {
      it('should not throw if workspace does not exist', async () => {
        await expect(manager.destroyWorkspace('non-existent')).resolves.not.toThrow();
      });
    });

    describe('inspectWorkspace', () => {
      it('should return null for non-existent workspace', async () => {
        const info = await manager.inspectWorkspace('non-existent');
        expect(info).toBeNull();
      });
    });

    describe('executeInWorkspace', () => {
      it('should throw if workspace does not exist', async () => {
        await expect(
          manager.executeInWorkspace('non-existent', { command: ['echo', 'test'] })
        ).rejects.toThrow('Workspace not found');
      });
    });

    describe('listWorkspaces', () => {
      it('should return empty array when no workspaces exist', async () => {
        const workspaces = await manager.listWorkspaces();
        expect(workspaces).toEqual([]);
      });
    });

    describe('translatePath', () => {
      it('should return original path if workspace not found', () => {
        const path = '/some/path';
        expect(manager.translateToContainer('non-existent', path)).toBe(path);
        expect(manager.translateToHost('non-existent', path)).toBe(path);
      });
    });
  });

  /**
   * Tests that must have their own container (destructive or special setup)
   * Uses a single container to test full lifecycle: create, mount, duplicate, list, destroy
   * Reduced from 2 containers to 1 (saving ~6-8s)
   */
  describe('with dedicated workspace', () => {
    let manager: WorkspaceContainerManager;
    let testDir: string;
    let projectDir: string;

    beforeEach(() => {
      const project = createTestProject();
      testDir = project.testDir;
      projectDir = project.projectDir;
      manager = new WorkspaceContainerManager(new AppleContainerRuntime());
    });

    afterEach(async () => {
      // Clean up test directory (workspace cleanup happens within the test)
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    }, 30000);

    it('should mount, list, and destroy workspaces correctly', async () => {
      // This comprehensive test covers full workspace lifecycle with a SINGLE container:
      // 1. Create workspace
      // 2. Verify mount works (execute ls /workspace)
      // 3. Duplicate handling (calling createWorkspace again returns same workspace)
      // 4. List workspaces (should see 1)
      // 5. Destroy workspace and verify clone is gone
      // 6. List again to verify empty
      // Total: 1 container lifecycle instead of 2

      // Step 1: Create workspace
      const workspace = await manager.createWorkspace(projectDir, 'lifecycle-test');
      expect(workspace.sessionId).toBe('lifecycle-test');
      expect(workspace.state).toBe('running');

      // Step 2: Verify mount works (execute ls /workspace)
      const lsResult = await manager.executeInWorkspace('lifecycle-test', {
        command: ['ls', '/workspace'],
      });
      expect(lsResult.exitCode).toBe(0);
      expect(lsResult.stdout).toContain('package.json');
      expect(lsResult.stdout).toContain('index.js');

      // Step 3: Verify duplicate handling (call createWorkspace again)
      const workspaceDuplicate = await manager.createWorkspace(projectDir, 'lifecycle-test');
      expect(workspaceDuplicate.sessionId).toBe(workspace.sessionId);
      expect(workspaceDuplicate.clonePath).toBe(workspace.clonePath);
      expect(workspaceDuplicate.containerId).toBe(workspace.containerId);

      // Step 4: List all workspaces (should see 1)
      const workspacesBeforeDestroy = await manager.listWorkspaces();
      expect(workspacesBeforeDestroy).toHaveLength(1);
      expect(workspacesBeforeDestroy[0].sessionId).toBe('lifecycle-test');

      // Step 5: Destroy workspace, verify clone is gone
      expect(existsSync(workspace.clonePath)).toBe(true);
      await manager.destroyWorkspace('lifecycle-test');
      expect(existsSync(workspace.clonePath)).toBe(false);

      // Verify container is also removed
      const destroyedInfo = await manager.inspectWorkspace('lifecycle-test');
      expect(destroyedInfo).toBeNull();

      // Step 6: List again (should be empty)
      const workspacesAfterDestroy = await manager.listWorkspaces();
      expect(workspacesAfterDestroy).toHaveLength(0);
    });
  });
});
