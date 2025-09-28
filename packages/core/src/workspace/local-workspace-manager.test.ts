// ABOUTME: Tests for LocalWorkspaceManager that runs without containers
// ABOUTME: Verifies local execution mode works correctly

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalWorkspaceManager } from './local-workspace-manager';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

describe('LocalWorkspaceManager', () => {
  const testContext = setupCoreTest();
  let manager: LocalWorkspaceManager;
  let testDir: string;
  let projectDir: string;

  beforeEach(() => {
    manager = new LocalWorkspaceManager();
    testDir = join(tmpdir(), `local-workspace-test-${uuidv4()}`);
    projectDir = join(testDir, 'test-project');
    mkdirSync(projectDir, { recursive: true });

    // Create test files
    writeFileSync(join(projectDir, 'test.txt'), 'Hello from test project');
    writeFileSync(join(projectDir, 'script.sh'), '#!/bin/bash\necho "Script output"');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createWorkspace', () => {
    it('should create a local workspace using project directory directly', async () => {
      const sessionId = 'test-session-1';

      const workspace = await manager.createWorkspace(projectDir, sessionId);

      expect(workspace).toEqual({
        sessionId,
        projectDir,
        clonePath: projectDir, // Should use project dir directly
        containerId: `local-${sessionId}`,
        state: 'running',
      });

      // No clone should be created - clonePath equals projectDir
      expect(workspace.clonePath).toBe(projectDir);
    });

    it('should throw error if workspace already exists', async () => {
      const sessionId = 'test-duplicate';

      await manager.createWorkspace(projectDir, sessionId);

      await expect(manager.createWorkspace(projectDir, sessionId)).rejects.toThrow(
        'Workspace already exists for session'
      );
    });
  });

  describe('executeInWorkspace', () => {
    it('should execute commands locally in project directory', async () => {
      const sessionId = 'test-exec';

      await manager.createWorkspace(projectDir, sessionId);

      const result = await manager.executeInWorkspace(sessionId, {
        command: ['echo', 'Hello from local'],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('Hello from local');
    });

    it('should read files from project directory', async () => {
      const sessionId = 'test-read';

      await manager.createWorkspace(projectDir, sessionId);

      const result = await manager.executeInWorkspace(sessionId, {
        command: ['cat', 'test.txt'],
        workingDirectory: projectDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('Hello from test project');
    });

    it('should handle environment variables', async () => {
      const sessionId = 'test-env';

      await manager.createWorkspace(projectDir, sessionId);

      const result = await manager.executeInWorkspace(sessionId, {
        command: ['sh', '-c', 'echo "$TEST_VAR"'],
        environment: { TEST_VAR: 'test_value' },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('test_value');
    });

    it('should include SESSION_ID in environment', async () => {
      const sessionId = 'test-session-env';

      await manager.createWorkspace(projectDir, sessionId);

      const result = await manager.executeInWorkspace(sessionId, {
        command: ['sh', '-c', 'echo "$SESSION_ID"'],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(sessionId);
    });

    it('should handle non-zero exit codes', async () => {
      const sessionId = 'test-error';

      await manager.createWorkspace(projectDir, sessionId);

      const result = await manager.executeInWorkspace(sessionId, {
        command: ['ls', '/nonexistent/path'],
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });
  });

  describe('path translation', () => {
    it('should pass through paths without translation', async () => {
      const sessionId = 'test-translate';

      await manager.createWorkspace(projectDir, sessionId);

      const hostPath = '/some/host/path';
      const containerPath = '/some/container/path';

      // Both should pass through unchanged
      expect(manager.translateToContainer(sessionId, hostPath)).toBe(hostPath);
      expect(manager.translateToHost(sessionId, containerPath)).toBe(containerPath);
    });
  });

  describe('workspace management', () => {
    it('should list all workspaces', async () => {
      const sessionIds = ['session-1', 'session-2', 'session-3'];

      for (const sessionId of sessionIds) {
        await manager.createWorkspace(projectDir, sessionId);
      }

      const workspaces = await manager.listWorkspaces();

      expect(workspaces).toHaveLength(3);
      const ids = workspaces.map((w) => w.sessionId);
      expect(ids.sort()).toEqual(sessionIds.sort());
    });

    it('should inspect workspace', async () => {
      const sessionId = 'test-inspect';

      const created = await manager.createWorkspace(projectDir, sessionId);
      const inspected = await manager.inspectWorkspace(sessionId);

      expect(inspected).toEqual(created);
    });

    it('should return null for non-existent workspace', async () => {
      const result = await manager.inspectWorkspace('non-existent');
      expect(result).toBeNull();
    });

    it('should destroy workspace', async () => {
      const sessionId = 'test-destroy';

      await manager.createWorkspace(projectDir, sessionId);
      expect(await manager.inspectWorkspace(sessionId)).toBeTruthy();

      await manager.destroyWorkspace(sessionId);
      expect(await manager.inspectWorkspace(sessionId)).toBeNull();
    });
  });
});
