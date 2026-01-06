// ABOUTME: Integration tests for the complete containerized workspace system
// ABOUTME: Tests the full workflow of cloning, containerizing, and executing code

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { WorkspaceContainerManager } from './workspace-container-manager';
import { AppleContainerRuntime } from '@lace/agent/containers/apple-container';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

describe.skipIf(process.platform !== 'darwin')('Workspace Integration Tests', () => {
  const _testContext = setupCoreTest();
  let manager: WorkspaceContainerManager;
  let testDir: string;
  let projectDir: string;
  // Share runtime across all tests - it's stateless
  let sharedRuntime: AppleContainerRuntime;

  beforeAll(() => {
    // Create shared runtime once for all tests
    sharedRuntime = new AppleContainerRuntime();

    // Create git repo once - tests only clone from it, never modify the source
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
  });

  beforeEach(() => {
    // Create fresh manager per test (manager is stateful with workspace tracking)
    manager = new WorkspaceContainerManager(sharedRuntime);
  });

  afterEach(async () => {
    // Clean up all workspaces created during this test
    const workspaces = await manager.listWorkspaces();
    await Promise.all(workspaces.map((workspace) => manager.destroyWorkspace(workspace.sessionId)));
  }, 30000); // Increase timeout for cleanup

  afterAll(() => {
    // Clean up shared test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should handle concurrent workspaces with isolation and full workflow', async () => {
    const sessionIds = ['workspace-1', 'workspace-2', 'workspace-3'];

    // Phase 1: Concurrent creation (from test 2)
    const workspaces = await Promise.all(
      sessionIds.map((id) => manager.createWorkspace(projectDir, id))
    );

    // Assert all have correct sessionIds, state 'running', clonePaths exist (from test 1)
    for (let i = 0; i < workspaces.length; i++) {
      expect(workspaces[i].sessionId).toBe(sessionIds[i]);
      expect(workspaces[i].state).toBe('running');
      expect(existsSync(workspaces[i].clonePath)).toBe(true);
    }

    // Phase 2: List workspaces (from test 2)
    expect(await manager.listWorkspaces()).toHaveLength(3);

    // Phase 3: Parallel execution - indexed echo + isolation files
    const [echoResults, _writeResults] = await Promise.all([
      // Execute indexed echo commands in all workspaces (from test 2)
      Promise.all(
        sessionIds.map((sessionId, index) =>
          manager.executeInWorkspace(sessionId, {
            command: ['sh', '-c', `echo "Container ${index + 1}"`],
          })
        )
      ),
      // Create isolation files in workspace-1 and workspace-2 (from test 3)
      Promise.all([
        manager.executeInWorkspace('workspace-1', {
          command: ['sh', '-c', 'echo "Session 1 data" > /workspace/session1.txt'],
        }),
        manager.executeInWorkspace('workspace-2', {
          command: ['sh', '-c', 'echo "Session 2 data" > /workspace/session2.txt'],
        }),
      ]),
    ]);

    // Verify echo results (from test 2)
    echoResults.forEach((result, index) => {
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(`Container ${index + 1}`);
    });

    // Phase 4: Verify isolation (from test 3)
    const [w1Read, w1Check, w2Read, w2Check] = await Promise.all([
      // Workspace-1: can read its own file
      manager.executeInWorkspace('workspace-1', {
        command: ['cat', '/workspace/session1.txt'],
      }),
      // Workspace-1: cannot see workspace-2's file
      manager.executeInWorkspace('workspace-1', {
        command: ['ls', '/workspace/session2.txt'],
      }),
      // Workspace-2: can read its own file
      manager.executeInWorkspace('workspace-2', {
        command: ['cat', '/workspace/session2.txt'],
      }),
      // Workspace-2: cannot see workspace-1's file
      manager.executeInWorkspace('workspace-2', {
        command: ['ls', '/workspace/session1.txt'],
      }),
    ]);

    expect(w1Read.exitCode).toBe(0);
    expect(w1Read.stdout.trim()).toBe('Session 1 data');
    expect(w1Check.exitCode).not.toBe(0); // File shouldn't exist

    expect(w2Read.exitCode).toBe(0);
    expect(w2Read.stdout.trim()).toBe('Session 2 data');
    expect(w2Check.exitCode).not.toBe(0); // File shouldn't exist

    // Phase 5: Full workflow on workspace-3 (from test 1)
    // - ls shows original files (app.py, process_data.py, README.md, .gitignore)
    const lsResult = await manager.executeInWorkspace('workspace-3', {
      command: ['ls', '-la', '/workspace'],
    });
    expect(lsResult.exitCode).toBe(0);
    expect(lsResult.stdout).toContain('app.py');
    expect(lsResult.stdout).toContain('process_data.py');
    expect(lsResult.stdout).toContain('README.md');
    expect(lsResult.stdout).toContain('.gitignore');

    // - Environment variable and complex shell script test (from test 1)
    const envResult = await manager.executeInWorkspace('workspace-3', {
      command: [
        'sh',
        '-c',
        'echo "Working directory: $(pwd)" && echo "Session ID: $SESSION_ID" && echo "Hello from containerized workspace!" > output.txt && echo "Output file created"',
      ],
      environment: { SESSION_ID: 'workspace-3' },
    });
    expect(envResult.exitCode).toBe(0);
    expect(envResult.stdout).toContain('Working directory: /workspace');
    expect(envResult.stdout).toContain('Session ID: workspace-3');
    expect(envResult.stdout).toContain('Output file created');

    // - Verify file was created in container (from test 1)
    const catResult = await manager.executeInWorkspace('workspace-3', {
      command: ['cat', '/workspace/output.txt'],
    });
    expect(catResult.exitCode).toBe(0);
    expect(catResult.stdout.trim()).toBe('Hello from containerized workspace!');

    // - File creation in container + host visibility (from test 1)
    const hostPath = join(workspaces[2].clonePath, 'output.txt');
    expect(existsSync(hostPath)).toBe(true);
    expect(readFileSync(hostPath, 'utf-8').trim()).toBe('Hello from containerized workspace!');

    // - JSON output test (from test 1)
    const jsonResult = await manager.executeInWorkspace('workspace-3', {
      command: [
        'sh',
        '-c',
        'echo \'{"status":"processed","container":true}\' > result.json && cat result.json',
      ],
    });
    expect(jsonResult.exitCode).toBe(0);
    const jsonOutput = JSON.parse(jsonResult.stdout.trim()) as {
      status: string;
      container: boolean;
    };
    expect(jsonOutput).toEqual({ status: 'processed', container: true });

    // Phase 6: Destroy one workspace, verify cleanup (from test 1)
    const workspace1Clone = workspaces[0].clonePath;
    await manager.destroyWorkspace('workspace-1');
    expect(await manager.inspectWorkspace('workspace-1')).toBeNull();
    expect(existsSync(workspace1Clone)).toBe(false);
    expect(await manager.listWorkspaces()).toHaveLength(2);

    // Phase 7: Destroy remaining, verify full cleanup (from test 2)
    await Promise.all([
      manager.destroyWorkspace('workspace-2'),
      manager.destroyWorkspace('workspace-3'),
    ]);
    expect(await manager.listWorkspaces()).toHaveLength(0);
  }, 60000);
});
