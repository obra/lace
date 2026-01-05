// ABOUTME: Tests for LocalWorkspaceManager that runs without containers
// ABOUTME: Verifies local execution mode works correctly

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalWorkspaceManager } from './local-workspace-manager';
import { setupCoreTest } from '@lace/core/test-utils/core-test-setup';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

describe('LocalWorkspaceManager', () => {
  const _testContext = setupCoreTest();
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

  afterEach(async () => {
    // Clean up all workspaces from the manager
    const workspaces = await manager.listWorkspaces();
    for (const workspace of workspaces) {
      await manager.destroyWorkspace(workspace.sessionId);
    }

    // Clean up filesystem
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

    it('should return existing workspace if workspace already exists', async () => {
      const sessionId = 'test-duplicate';

      const workspace1 = await manager.createWorkspace(projectDir, sessionId);
      const workspace2 = await manager.createWorkspace(projectDir, sessionId);

      // Should return the same workspace
      expect(workspace2).toEqual(workspace1);
      expect(workspace2.sessionId).toBe(sessionId);
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

    it('should prevent shell injection via command array arguments', async () => {
      const sessionId = 'test-injection';

      await manager.createWorkspace(projectDir, sessionId);

      // Attempt injection with a malicious argument that would execute if shell-interpreted
      // The old implementation would construct: echo "test; echo INJECTED"
      // The new implementation uses execFile which treats this as a literal argument
      const result = await manager.executeInWorkspace(sessionId, {
        command: ['echo', 'test; echo INJECTED'],
      });

      expect(result.exitCode).toBe(0);
      // Should output the entire string literally, not execute the injection
      expect(result.stdout.trim()).toBe('test; echo INJECTED');
      // The word INJECTED should appear once (in the literal output)
      const matches = result.stdout.match(/INJECTED/g);
      expect(matches).toHaveLength(1);
    });

    it('should handle special characters in array command arguments safely', async () => {
      const sessionId = 'test-special-chars';

      await manager.createWorkspace(projectDir, sessionId);

      // Test various special characters that could be exploited
      const specialArgs = ['$HOME', '`whoami`', '$(pwd)', '&&', '||', ';', '|'];

      for (const arg of specialArgs) {
        const result = await manager.executeInWorkspace(sessionId, {
          command: ['echo', arg],
        });

        expect(result.exitCode).toBe(0);
        // Should echo the literal string, not interpret it
        expect(result.stdout.trim()).toBe(arg);
      }
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
