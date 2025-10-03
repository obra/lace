// ABOUTME: Validation test for workspace cleanup behavior
// ABOUTME: Ensures no .git directories created in source and containers are cleaned up

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { WorktreeWorkspaceManager } from '~/workspace/worktree-workspace-manager';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Compute source packages/core directory relative to this test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE_PACKAGES_DIR = resolve(__dirname, '../..');

describe('Workspace Cleanup Validation', () => {
  const _testContext = setupCoreTest();
  let tempProjectDir: string;
  let manager: WorktreeWorkspaceManager;

  beforeEach(() => {
    // Create isolated temp directory for test project
    tempProjectDir = mkdtempSync(join(tmpdir(), 'workspace-cleanup-test-'));

    // Initialize git repo in temp directory
    execSync('git init', { cwd: tempProjectDir });
    execSync('git config user.name "Test User"', { cwd: tempProjectDir });
    execSync('git config user.email "test@example.com"', { cwd: tempProjectDir });

    // Create initial commit
    execSync('echo "test" > README.md', { cwd: tempProjectDir, shell: true });
    execSync('git add .', { cwd: tempProjectDir });
    execSync('git commit -m "Initial commit"', { cwd: tempProjectDir });

    manager = new WorktreeWorkspaceManager();
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempProjectDir && existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  it('should NOT create .git directory in source packages/core', async () => {
    // Verify source directory has no .git before test
    const gitDirBefore = join(SOURCE_PACKAGES_DIR, '.git');
    const hadGitBefore = existsSync(gitDirBefore);

    // Create and destroy a workspace
    const sessionId = 'test-session-no-git-pollution';
    await manager.createWorkspace(tempProjectDir, sessionId);

    // Verify .git was NOT created in source directory
    const gitDirAfter = join(SOURCE_PACKAGES_DIR, '.git');
    const hasGitAfter = existsSync(gitDirAfter);

    expect(hasGitAfter).toBe(hadGitBefore); // Should not change
    expect(hasGitAfter).toBe(false); // Should never exist

    // Clean up workspace
    await manager.destroyWorkspace(sessionId);

    // Verify STILL no .git in source after cleanup
    const gitDirFinal = join(SOURCE_PACKAGES_DIR, '.git');
    expect(existsSync(gitDirFinal)).toBe(false);
  });

  it('should fully clean up worktree after destroy', async () => {
    const sessionId = 'test-session-cleanup';

    // Create workspace
    const workspace = await manager.createWorkspace(tempProjectDir, sessionId);
    const worktreePath = workspace.clonePath;

    // Verify worktree was created
    expect(existsSync(worktreePath)).toBe(true);

    // Destroy workspace
    await manager.destroyWorkspace(sessionId);

    // Verify worktree is gone
    expect(existsSync(worktreePath)).toBe(false);

    // Verify no orphaned git worktree metadata
    const result = execSync('git worktree list', { cwd: tempProjectDir }).toString();
    expect(result).not.toContain(sessionId);
  });

  it('should handle cleanup when database is open', async () => {
    const sessionId = 'test-session-db-lock';

    // Create workspace
    await manager.createWorkspace(tempProjectDir, sessionId);

    // Database is open due to setupCoreTest() - this simulates real scenario

    // Destroy should still succeed even with DB open
    await expect(manager.destroyWorkspace(sessionId)).resolves.not.toThrow();

    // setupCoreTest() will close DB in afterEach, then temp dir cleanup happens
  });
});
