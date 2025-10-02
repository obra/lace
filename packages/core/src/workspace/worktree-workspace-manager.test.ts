// ABOUTME: Tests for WorktreeWorkspaceManager
// ABOUTME: Validates git worktree creation and local execution without containers

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorktreeWorkspaceManager } from './worktree-workspace-manager';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

describe('WorktreeWorkspaceManager', () => {
  let tempProjectDir: string;
  let manager: WorktreeWorkspaceManager;

  beforeEach(async () => {
    // Create temp directory for test project
    tempProjectDir = mkdtempSync(join(tmpdir(), 'worktree-test-'));

    // Initialize git repo
    await execFileAsync('git', ['init'], { cwd: tempProjectDir });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: tempProjectDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: tempProjectDir,
    });

    // Create initial commit
    writeFileSync(join(tempProjectDir, 'README.md'), '# Test Project\n');
    await execFileAsync('git', ['add', '.'], { cwd: tempProjectDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tempProjectDir });

    manager = new WorktreeWorkspaceManager();
  });

  afterEach(() => {
    if (tempProjectDir) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  describe('createWorkspace', () => {
    it('creates a git worktree for the session', async () => {
      const sessionId = 'test-session-1';
      const workspaceInfo = await manager.createWorkspace(tempProjectDir, sessionId);

      expect(workspaceInfo).toBeDefined();
      expect(workspaceInfo.sessionId).toBe(sessionId);
      expect(workspaceInfo.projectDir).toBe(tempProjectDir);
      expect(workspaceInfo.clonePath).toContain(sessionId);
      expect(workspaceInfo.clonePath).not.toBe(tempProjectDir); // Should be a worktree
      expect(workspaceInfo.containerId).toBe(`worktree-${sessionId}`);
      expect(workspaceInfo.state).toBe('running');
      expect(workspaceInfo.branchName).toBe(`lace/session/${sessionId}`);

      // Cleanup
      await manager.destroyWorkspace(sessionId);
    });

    it('returns existing workspace if already created', async () => {
      const sessionId = 'test-session-2';

      const workspace1 = await manager.createWorkspace(tempProjectDir, sessionId);
      const workspace2 = await manager.createWorkspace(tempProjectDir, sessionId);

      expect(workspace1).toEqual(workspace2);

      await manager.destroyWorkspace(sessionId);
    });

    it('creates different worktrees for different sessions', async () => {
      const sessionId1 = 'test-session-3';
      const sessionId2 = 'test-session-4';

      const workspace1 = await manager.createWorkspace(tempProjectDir, sessionId1);
      const workspace2 = await manager.createWorkspace(tempProjectDir, sessionId2);

      expect(workspace1.clonePath).not.toBe(workspace2.clonePath);
      expect(workspace1.branchName).not.toBe(workspace2.branchName);

      await manager.destroyWorkspace(sessionId1);
      await manager.destroyWorkspace(sessionId2);
    });
  });

  describe('executeInWorkspace', () => {
    it('executes commands in the worktree directory', async () => {
      const sessionId = 'test-session-5';
      await manager.createWorkspace(tempProjectDir, sessionId);

      const result = await manager.executeInWorkspace(sessionId, {
        command: ['pwd'],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toContain(sessionId); // Should be in worktree path

      await manager.destroyWorkspace(sessionId);
    });

    it('executes commands with environment variables', async () => {
      const sessionId = 'test-session-6';
      await manager.createWorkspace(tempProjectDir, sessionId);

      const result = await manager.executeInWorkspace(sessionId, {
        command: ['sh', '-c', 'echo $TEST_VAR'],
        environment: { TEST_VAR: 'test-value' },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('test-value');

      await manager.destroyWorkspace(sessionId);
    });

    it('isolates file changes to worktree', async () => {
      const sessionId = 'test-session-7';
      const workspace = await manager.createWorkspace(tempProjectDir, sessionId);

      // Create a file in the worktree
      writeFileSync(join(workspace.clonePath, 'test-file.txt'), 'worktree content');

      // Verify file exists in worktree
      const worktreeContent = readFileSync(join(workspace.clonePath, 'test-file.txt'), 'utf-8');
      expect(worktreeContent).toBe('worktree content');

      // Verify file does NOT exist in original project
      expect(() => readFileSync(join(tempProjectDir, 'test-file.txt'))).toThrow();

      await manager.destroyWorkspace(sessionId);
    });
  });

  describe('destroyWorkspace', () => {
    it('removes worktree when workspace is destroyed', async () => {
      const sessionId = 'test-session-8';
      await manager.createWorkspace(tempProjectDir, sessionId);

      await manager.destroyWorkspace(sessionId);

      // Worktree should be removed
      const info = await manager.inspectWorkspace(sessionId);
      expect(info).toBeNull();
    });

    it('keeps branch after destroying worktree', async () => {
      const sessionId = 'test-session-9';
      await manager.createWorkspace(tempProjectDir, sessionId);

      await manager.destroyWorkspace(sessionId);

      // Check that branch still exists
      const { stdout } = await execFileAsync(
        'git',
        ['branch', '--list', `lace/session/${sessionId}`],
        {
          cwd: tempProjectDir,
        }
      );
      expect(stdout.trim()).toContain(`lace/session/${sessionId}`);
    });
  });

  describe('inspectWorkspace', () => {
    it('returns workspace info for existing workspace', async () => {
      const sessionId = 'test-session-10';
      await manager.createWorkspace(tempProjectDir, sessionId);

      const info = await manager.inspectWorkspace(sessionId);

      expect(info).toBeDefined();
      expect(info?.sessionId).toBe(sessionId);

      await manager.destroyWorkspace(sessionId);
    });

    it('returns null for non-existent workspace', async () => {
      const info = await manager.inspectWorkspace('nonexistent-session');
      expect(info).toBeNull();
    });
  });

  describe('listWorkspaces', () => {
    it('lists all active worktree workspaces', async () => {
      const sessionId1 = 'test-session-11';
      const sessionId2 = 'test-session-12';

      await manager.createWorkspace(tempProjectDir, sessionId1);
      await manager.createWorkspace(tempProjectDir, sessionId2);

      const workspaces = await manager.listWorkspaces();

      expect(workspaces.length).toBeGreaterThanOrEqual(2);
      expect(workspaces.find((w) => w.sessionId === sessionId1)).toBeDefined();
      expect(workspaces.find((w) => w.sessionId === sessionId2)).toBeDefined();

      await manager.destroyWorkspace(sessionId1);
      await manager.destroyWorkspace(sessionId2);
    });
  });

  describe('path translation', () => {
    it('returns host paths unchanged (no container translation)', async () => {
      const sessionId = 'test-session-13';
      await manager.createWorkspace(tempProjectDir, sessionId);

      const hostPath = '/some/host/path';
      const translated = manager.translateToContainer(sessionId, hostPath);

      expect(translated).toBe(hostPath); // No translation for local execution

      await manager.destroyWorkspace(sessionId);
    });

    it('returns container paths unchanged (no container translation)', async () => {
      const sessionId = 'test-session-14';
      await manager.createWorkspace(tempProjectDir, sessionId);

      const containerPath = '/workspace/file.txt';
      const translated = manager.translateToHost(sessionId, containerPath);

      expect(translated).toBe(containerPath); // No translation for local execution

      await manager.destroyWorkspace(sessionId);
    });
  });
});
