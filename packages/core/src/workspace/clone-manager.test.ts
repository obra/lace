// ABOUTME: Tests for CloneManager which creates local git clones for session workspaces
// ABOUTME: Uses git clone --local for space-efficient clones with hardlinks

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CloneManager } from './clone-manager';
import { setupCoreTest } from '@lace/core/test-utils/core-test-setup';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

describe('CloneManager', () => {
  const testContext = setupCoreTest();
  let testDir: string;
  let projectDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `clone-manager-test-${uuidv4()}`);
    projectDir = join(testDir, 'test-project');
    mkdirSync(projectDir, { recursive: true });

    // Initialize a git repo in projectDir
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@example.com"', { cwd: projectDir });
    execSync('git config user.name "Test User"', { cwd: projectDir });

    // Create and commit a test file
    writeFileSync(join(projectDir, 'README.md'), '# Test Project');
    execSync('git add .', { cwd: projectDir });
    execSync('git commit -m "Initial commit"', { cwd: projectDir });
  });

  afterEach(async () => {
    // Clean up test directory - clones are in isolated LACE_DIR and will be cleaned up automatically
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createSessionClone', () => {
    it('should create a local clone of the project directory', async () => {
      const sessionId = 'test-session-123';

      const clonePath = await CloneManager.createSessionClone(projectDir, sessionId);

      // Clone path should exist
      expect(existsSync(clonePath)).toBe(true);

      // Should be a valid git repository
      const gitDir = join(clonePath, '.git');
      expect(existsSync(gitDir)).toBe(true);

      // Should have the committed file
      const readmePath = join(clonePath, 'README.md');
      expect(existsSync(readmePath)).toBe(true);

      // Git clone --local uses hardlinks for objects, not working tree files
      // So let's check that .git/objects is using hardlinks
      const gitObjectsSource = join(projectDir, '.git', 'objects');
      const gitObjectsClone = join(clonePath, '.git', 'objects');

      // Check that objects directory exists in both
      expect(existsSync(gitObjectsSource)).toBe(true);
      expect(existsSync(gitObjectsClone)).toBe(true);
    });

    it('should create clone in LACE_DIR/clones directory', async () => {
      const sessionId = 'test-session-456';

      const clonePath = await CloneManager.createSessionClone(projectDir, sessionId);

      expect(clonePath).toContain('/clones');
      expect(clonePath).toContain(sessionId);
      // Verify it uses the test LACE_DIR
      expect(clonePath.startsWith(testContext.tempDir)).toBe(true);
    });

    it('should throw error if project directory does not exist', async () => {
      const nonExistentDir = join(testDir, 'non-existent');

      await expect(CloneManager.createSessionClone(nonExistentDir, 'session-1')).rejects.toThrow(
        'Project directory does not exist'
      );
    });

    it('should auto-initialize git for non-git directories', async () => {
      const nonGitDir = join(testDir, 'non-git');
      mkdirSync(nonGitDir);

      // Create a test file to verify it gets committed
      writeFileSync(join(nonGitDir, 'test.txt'), 'Test content');

      const sessionId = 'session-auto-init';
      const clonePath = await CloneManager.createSessionClone(nonGitDir, sessionId);

      // Should have created a clone successfully
      expect(existsSync(clonePath)).toBe(true);

      // Clone should be a git repository
      const gitDir = join(clonePath, '.git');
      expect(existsSync(gitDir)).toBe(true);

      // Test file should be in the clone
      const testFilePath = join(clonePath, 'test.txt');
      expect(existsSync(testFilePath)).toBe(true);
      expect(readFileSync(testFilePath, 'utf8')).toBe('Test content');

      // Original directory should now be a git repository too
      expect(existsSync(join(nonGitDir, '.git'))).toBe(true);
    });
  });

  describe('removeSessionClone', () => {
    it('should remove a session clone', async () => {
      const sessionId = 'test-remove-session';

      // First create a clone
      const clonePath = await CloneManager.createSessionClone(projectDir, sessionId);
      expect(existsSync(clonePath)).toBe(true);

      // Now remove it
      await CloneManager.removeSessionClone(sessionId);

      // Should be gone
      expect(existsSync(clonePath)).toBe(false);
    });

    it('should not throw if clone does not exist', () => {
      // Should not throw for non-existent session - just silently succeed
      expect(() => CloneManager.removeSessionClone('non-existent-session')).not.toThrow();
    });
  });

  describe('listSessionClones', () => {
    it('should list all session clones', async () => {
      // Create multiple clones
      const sessionIds = ['session-1', 'session-2', 'session-3'];
      for (const sessionId of sessionIds) {
        await CloneManager.createSessionClone(projectDir, sessionId);
      }

      const clones = await CloneManager.listSessionClones();

      // Should find all our clones
      expect(clones).toHaveLength(3);
      expect(clones.sort()).toEqual(sessionIds.sort());
    });

    it('should return empty array when no clones exist', async () => {
      const clones = await CloneManager.listSessionClones();
      expect(clones).toEqual([]);
    });
  });
});
