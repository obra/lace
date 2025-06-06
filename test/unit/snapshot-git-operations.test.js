// ABOUTME: Unit tests for GitOperations class that manages git operations for the snapshot system
// ABOUTME: Tests git commands with custom git-dir, repository initialization, and atomic operations

import { test, describe, beforeEach, afterEach, assert } from '../test-harness.js';
import { TestHarness, utils } from '../test-harness.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('GitOperations', () => {
  let testHarness;
  let testDir;
  let GitOperations;

  beforeEach(async () => {
    testHarness = new TestHarness();
    testDir = join(process.cwd(), `test-snapshot-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Import the class after creating test directory
    try {
      const module = await import('../../src/snapshot/git-operations.js');
      GitOperations = module.GitOperations;
    } catch (error) {
      // Class doesn't exist yet, that's expected in TDD
      GitOperations = null;
    }
  });

  afterEach(async () => {
    await testHarness.cleanup();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    test('should create GitOperations with valid project path', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      assert.strictEqual(gitOps.projectPath, testDir);
      assert.strictEqual(gitOps.gitDir, join(testDir, '.lace', 'history-snapshot-dotgit'));
      assert.strictEqual(gitOps.workTree, testDir);
    });

    test('should throw error for invalid project path during initialize', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      try {
        const gitOps = new GitOperations('/nonexistent/path');
        assert.fail('Should throw error for invalid path');
      } catch (error) {
        assert.ok(error.message.includes('Cannot use simple-git on a directory that does not exist'), 
                 'Should indicate directory does not exist');
      }
    });
  });

  describe('initialization', () => {
    test('should initialize git repository in .lace directory', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();

      // Check that .lace directory was created
      assert.ok(await utils.fileExists(join(testDir, '.lace')));
      assert.ok(await utils.fileExists(join(testDir, '.lace', 'history-snapshot-dotgit')));
      
      // Check that .git file was created pointing to separate git dir
      assert.ok(await utils.fileExists(join(testDir, '.git')));
      
      // Check that it's a valid git repository
      const status = await gitOps.getStatus();
      assert.ok(status, 'Should have git status');
    });

    test('should handle already initialized repository', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();
      
      // Should not throw when called again
      await gitOps.initialize();
      
      assert.ok(await utils.fileExists(join(testDir, '.lace', 'history-snapshot-dotgit')));
      assert.ok(await utils.fileExists(join(testDir, '.git')));
    });

    test('should create proper .gitignore in snapshot repo', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();

      const gitignorePath = join(testDir, '.gitignore');
      if (await utils.fileExists(gitignorePath)) {
        const gitignoreContent = await utils.readFile(gitignorePath);
        assert.ok(gitignoreContent.includes('.git/'), 'Should exclude main .git directory');
        assert.ok(gitignoreContent.includes('.lace/'), 'Should exclude .lace directory');
      }
    });
  });

  describe('git commands', () => {
    test('should execute git commands with custom git-dir', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();

      // Create a test file
      const testFile = join(testDir, 'test.txt');
      await utils.writeFile(testFile, 'test content');

      // Add and commit the file
      await gitOps.add('.');
      const commitSha = await gitOps.commit('Test commit');

      assert.ok(commitSha, 'Should return commit SHA');
      assert.ok(commitSha.length >= 7, 'SHA should be at least 7 characters');

      // Verify commit exists
      const log = await gitOps.getLog(1);
      assert.ok(log.includes('Test commit'), 'Commit should appear in log');
    });

    test('should handle git command errors gracefully', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();

      // Try to commit with no changes
      try {
        await gitOps.commit('Empty commit');
        assert.fail('Should throw error for empty commit');
      } catch (error) {
        assert.ok(error.message.includes('Git command failed') || 
                 error.message.includes('No changes to commit'),
                 `Unexpected error message: ${error.message}`);
      }
    });

    test('should support atomic operations', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();

      // Create multiple test files
      await utils.writeFile(join(testDir, 'file1.txt'), 'content1');
      await utils.writeFile(join(testDir, 'file2.txt'), 'content2');
      await utils.writeFile(join(testDir, 'file3.txt'), 'content3');

      // Atomic add and commit
      const commitSha = await gitOps.addAndCommit('Add multiple files atomically');
      
      assert.ok(commitSha, 'Should return commit SHA');
      
      // Verify all files are in the commit
      const status = await gitOps.getStatus();
      assert.ok(status.isClean(), 'Working tree should be clean');
    });
  });

  describe('repository maintenance', () => {
    test('should provide repository statistics', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();

      // Add some commits
      await utils.writeFile(join(testDir, 'file1.txt'), 'content1');
      await gitOps.addAndCommit('First commit');
      
      await utils.writeFile(join(testDir, 'file2.txt'), 'content2');
      await gitOps.addAndCommit('Second commit');

      const stats = await gitOps.getRepositoryStats();
      
      assert.ok(stats.commitCount >= 2, 'Should have at least 2 commits');
      assert.ok(stats.fileCount >= 2, 'Should have at least 2 files');
      assert.ok(typeof stats.repositorySize === 'number', 'Should have repository size');
    });

    test('should support cleanup operations', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();

      // Add some content to create objects
      await utils.writeFile(join(testDir, 'large-file.txt'), 'x'.repeat(10000));
      await gitOps.addAndCommit('Add large file');

      const statsBefore = await gitOps.getRepositoryStats();
      await gitOps.cleanup();
      const statsAfter = await gitOps.getRepositoryStats();

      // Cleanup might reduce size, but at minimum should not increase it
      assert.ok(statsAfter.repositorySize <= statsBefore.repositorySize * 1.1, 
               'Repository size should not significantly increase after cleanup');
    });
  });

  describe('error handling', () => {
    test('should handle corrupted repository', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();

      // Corrupt the repository by removing HEAD
      await fs.rm(join(gitOps.gitDir, 'HEAD'), { force: true });

      try {
        await gitOps.getStatus();
        assert.fail('Should throw error for corrupted repository');
      } catch (error) {
        assert.ok(error.message.includes('repository') || 
                 error.message.includes('HEAD'), 'Should indicate repository corruption');
      }
    });

    test('should validate git availability', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      // This test assumes git is available (reasonable for development)
      const gitOps = new GitOperations(testDir);
      const isAvailable = await gitOps.isGitAvailable();
      
      assert.strictEqual(isAvailable, true, 'Git should be available in development environment');
    });
  });

  describe('file operations', () => {
    test('should track file changes correctly', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();

      // Create and modify files
      await utils.writeFile(join(testDir, 'new-file.txt'), 'new content');
      await utils.writeFile(join(testDir, 'existing-file.txt'), 'original');
      await gitOps.addAndCommit('Initial commit');

      await utils.writeFile(join(testDir, 'existing-file.txt'), 'modified');
      await utils.writeFile(join(testDir, 'another-new.txt'), 'another');

      const changes = await gitOps.getChangedFiles();
      
      assert.ok(changes.modified.includes('existing-file.txt'), 'Should detect modified file');
      assert.ok(changes.untracked.includes('another-new.txt'), 'Should detect new file');
    });

    test('should handle binary files', async () => {
      if (!GitOperations) {
        assert.fail('GitOperations class not implemented yet');
      }

      const gitOps = new GitOperations(testDir);
      await gitOps.initialize();

      // Create a binary file (simple approach: file with null bytes)
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE]);
      await fs.writeFile(join(testDir, 'binary-file.bin'), binaryContent);

      const commitSha = await gitOps.addAndCommit('Add binary file');
      assert.ok(commitSha, 'Should successfully commit binary file');

      const status = await gitOps.getStatus();
      assert.ok(status.isClean(), 'Should handle binary files');
    });
  });
});