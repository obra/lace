// ABOUTME: Integration tests for the complete containerized workspace system
// ABOUTME: Tests the full workflow of cloning, containerizing, and executing code

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceContainerManager } from './workspace-container-manager';
import { AppleContainerRuntime } from '~/containers/apple-container';
import { CloneManager } from './clone-manager';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

describe('Workspace Integration Tests', () => {
  let manager: WorkspaceContainerManager;
  let testDir: string;
  let projectDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `workspace-integration-${uuidv4()}`);
    projectDir = join(testDir, 'test-project');
    mkdirSync(projectDir, { recursive: true });

    // Initialize a git repo with multiple files and commits
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@example.com"', { cwd: projectDir });
    execSync('git config user.name "Test User"', { cwd: projectDir });

    // Create a Python project structure
    writeFileSync(
      join(projectDir, 'app.py'),
      `#!/usr/bin/env python
import os
import sys

def main():
    print(f"Working directory: {os.getcwd()}")
    print(f"Session ID: {os.environ.get('SESSION_ID', 'unknown')}")

    # Write a test file
    with open('output.txt', 'w') as f:
        f.write('Hello from containerized workspace!')

    print("Output file created")

if __name__ == '__main__':
    main()
`
    );

    writeFileSync(
      join(projectDir, 'process_data.py'),
      `#!/usr/bin/env python
import json

def process():
    data = {'status': 'processed', 'container': True}
    with open('result.json', 'w') as f:
        json.dump(data, f)
    print(json.dumps(data))

if __name__ == '__main__':
    process()
`
    );

    writeFileSync(
      join(projectDir, 'README.md'),
      '# Test Project\nThis is a test project for workspace containers.'
    );

    // Create initial commit
    execSync('git add .', { cwd: projectDir });
    execSync('git commit -m "Initial commit"', { cwd: projectDir });

    // Add another file and commit
    writeFileSync(join(projectDir, '.gitignore'), '*.pyc\n__pycache__/\noutput.txt\nresult.json');
    execSync('git add .', { cwd: projectDir });
    execSync('git commit -m "Add gitignore"', { cwd: projectDir });

    // Create manager with real runtime
    manager = new WorkspaceContainerManager(new AppleContainerRuntime());
  });

  afterEach(async () => {
    // Clean up all workspaces
    const workspaces = await manager.listWorkspaces();
    for (const workspace of workspaces) {
      await manager.destroyWorkspace(workspace.sessionId);
    }

    // Clean up any remaining clones
    const clones = await CloneManager.listSessionClones();
    for (const sessionId of clones) {
      await CloneManager.removeSessionClone(sessionId);
    }

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30000); // Increase timeout for cleanup

  it('should complete full workflow: clone, containerize, execute, modify, and cleanup', async () => {
    const sessionId = 'integration-test-1';

    // Step 1: Create workspace
    const workspace = await manager.createWorkspace(projectDir, sessionId);

    expect(workspace.sessionId).toBe(sessionId);
    expect(workspace.state).toBe('running');
    expect(existsSync(workspace.clonePath)).toBe(true);

    // Step 2: Verify files are present
    const result1 = await manager.executeInWorkspace(sessionId, {
      command: ['ls', '-la', '/workspace'],
    });

    expect(result1.exitCode).toBe(0);
    expect(result1.stdout).toContain('app.py');
    expect(result1.stdout).toContain('process_data.py');
    expect(result1.stdout).toContain('README.md');
    expect(result1.stdout).toContain('.gitignore');

    // Step 3: Execute Python script
    const result2 = await manager.executeInWorkspace(sessionId, {
      command: ['python', '/workspace/app.py'],
    });

    expect(result2.exitCode).toBe(0);
    expect(result2.stdout).toContain('Working directory: /workspace');
    expect(result2.stdout).toContain(`Session ID: ${sessionId}`);
    expect(result2.stdout).toContain('Output file created');

    // Step 4: Verify file was created in container
    const result3 = await manager.executeInWorkspace(sessionId, {
      command: ['cat', '/workspace/output.txt'],
    });

    expect(result3.exitCode).toBe(0);
    expect(result3.stdout).toBe('Hello from containerized workspace!');

    // Step 5: File should also exist in the clone on host
    const outputPath = join(workspace.clonePath, 'output.txt');
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, 'utf-8')).toBe('Hello from containerized workspace!');

    // Step 6: Execute another script with JSON output
    const result4 = await manager.executeInWorkspace(sessionId, {
      command: ['python', '/workspace/process_data.py'],
    });

    expect(result4.exitCode).toBe(0);
    const jsonOutput = JSON.parse(result4.stdout.trim());
    expect(jsonOutput).toEqual({ status: 'processed', container: true });

    // Step 7: Path translation
    const hostPath = join(workspace.clonePath, 'data', 'file.txt');
    const containerPath = manager.translateToContainer(sessionId, hostPath);
    expect(containerPath).toBe('/workspace/data/file.txt');

    const translatedBack = manager.translateToHost(sessionId, containerPath);
    expect(translatedBack).toBe(hostPath);

    // Step 8: Cleanup
    await manager.destroyWorkspace(sessionId);

    // Workspace should be gone
    const info = await manager.inspectWorkspace(sessionId);
    expect(info).toBeNull();

    // Clone should be removed
    expect(existsSync(workspace.clonePath)).toBe(false);
  }, 60000); // 60 second timeout for integration test

  it('should handle multiple concurrent workspaces', async () => {
    const sessionIds = ['concurrent-1', 'concurrent-2', 'concurrent-3'];
    const workspaces = [];

    // Create multiple workspaces in parallel
    const createPromises = sessionIds.map((sessionId) =>
      manager.createWorkspace(projectDir, sessionId)
    );
    const createdWorkspaces = await Promise.all(createPromises);

    for (const workspace of createdWorkspaces) {
      expect(workspace.state).toBe('running');
      workspaces.push(workspace);
    }

    // Execute commands in parallel across all workspaces
    const execPromises = sessionIds.map((sessionId, index) =>
      manager.executeInWorkspace(sessionId, {
        command: ['sh', '-c', `echo "Container ${index + 1}"`],
      })
    );

    const results = await Promise.all(execPromises);

    results.forEach((result, index) => {
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(`Container ${index + 1}`);
    });

    // List all workspaces
    const allWorkspaces = await manager.listWorkspaces();
    expect(allWorkspaces).toHaveLength(3);

    // Clean up in parallel
    const destroyPromises = sessionIds.map((sessionId) => manager.destroyWorkspace(sessionId));
    await Promise.all(destroyPromises);

    // Verify all cleaned up
    const remainingWorkspaces = await manager.listWorkspaces();
    expect(remainingWorkspaces).toHaveLength(0);
  }, 60000);

  it('should isolate workspaces from each other', async () => {
    const session1 = 'isolated-1';
    const session2 = 'isolated-2';

    // Create two workspaces
    const workspace1 = await manager.createWorkspace(projectDir, session1);
    const workspace2 = await manager.createWorkspace(projectDir, session2);

    // Create different files in each workspace
    await manager.executeInWorkspace(session1, {
      command: ['sh', '-c', 'echo "Session 1 data" > /workspace/session1.txt'],
    });

    await manager.executeInWorkspace(session2, {
      command: ['sh', '-c', 'echo "Session 2 data" > /workspace/session2.txt'],
    });

    // Verify isolation - session1 file exists only in workspace1
    const result1 = await manager.executeInWorkspace(session1, {
      command: ['cat', '/workspace/session1.txt'],
    });
    expect(result1.exitCode).toBe(0);
    expect(result1.stdout.trim()).toBe('Session 1 data');

    const result2 = await manager.executeInWorkspace(session1, {
      command: ['ls', '/workspace/session2.txt'],
    });
    expect(result2.exitCode).not.toBe(0); // File shouldn't exist

    // Verify isolation - session2 file exists only in workspace2
    const result3 = await manager.executeInWorkspace(session2, {
      command: ['cat', '/workspace/session2.txt'],
    });
    expect(result3.exitCode).toBe(0);
    expect(result3.stdout.trim()).toBe('Session 2 data');

    const result4 = await manager.executeInWorkspace(session2, {
      command: ['ls', '/workspace/session1.txt'],
    });
    expect(result4.exitCode).not.toBe(0); // File shouldn't exist

    // Clean up
    await manager.destroyWorkspace(session1);
    await manager.destroyWorkspace(session2);
  }, 60000);
});
