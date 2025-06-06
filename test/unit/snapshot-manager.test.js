// ABOUTME: Unit tests for SnapshotManager class that coordinates snapshot creation and management
// ABOUTME: Tests snapshot creation, metadata management, configuration, and indexing functionality

import { test, describe, beforeEach, afterEach, assert } from '../test-harness.js';
import { TestHarness, utils } from '../test-harness.js';
import { promises as fs } from 'fs';
import { join } from 'path';

describe('SnapshotManager', () => {
  let testHarness;
  let testDir;
  let SnapshotManager;
  let mockGitOperations;
  let mockConfig;

  beforeEach(async () => {
    testHarness = new TestHarness();
    testDir = join(process.cwd(), `test-snapshot-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Create mock config
    mockConfig = {
      enabled: true,
      retentionPolicy: {
        maxAge: '7 days',
        maxSnapshots: 1000,
        keepCheckpoints: true
      },
      performance: {
        excludePatterns: ['node_modules/**', '*.log'],
        compressionLevel: 6,
        backgroundPruning: true
      },
      integration: {
        autoSnapshotOnToolUse: true,
        conversationTurnsToCapture: 5,
        toolUsesToCapture: 10
      }
    };

    // Create mock GitOperations
    mockGitOperations = {
      initialize: async () => {},
      addAndCommit: async (message) => `commit-${Date.now()}`,
      getRepositoryStats: async () => ({
        commitCount: 5,
        fileCount: 10,
        repositorySize: 1024
      }),
      getChangedFiles: async () => ({
        modified: ['file1.txt'],
        untracked: ['file2.txt'],
        deleted: []
      }),
      cleanup: async () => {}
    };
    
    // Try to import the class
    try {
      const module = await import('../../src/snapshot/snapshot-manager.js');
      SnapshotManager = module.SnapshotManager;
    } catch (error) {
      // Class doesn't exist yet, that's expected in TDD
      SnapshotManager = null;
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
    test('should create SnapshotManager with valid project path', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir);
      assert.strictEqual(manager.projectPath, testDir);
      assert.strictEqual(manager.laceDir, join(testDir, '.lace'));
      assert.strictEqual(manager.snapshotsDir, join(testDir, '.lace', 'snapshots'));
      assert.strictEqual(manager.metadataDir, join(testDir, '.lace', 'snapshots', 'metadata'));
    });

    test('should accept custom configuration', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const customConfig = { ...mockConfig, enabled: false };
      const manager = new SnapshotManager(testDir, customConfig);
      
      assert.strictEqual(manager.config.enabled, false);
    });
  });

  describe('initialization', () => {
    test('should initialize directory structure and git operations', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      await manager.initialize();

      // Check directory structure
      assert.ok(await utils.fileExists(join(testDir, '.lace')));
      assert.ok(await utils.fileExists(join(testDir, '.lace', 'snapshots')));
      assert.ok(await utils.fileExists(join(testDir, '.lace', 'snapshots', 'metadata')));
      
      // Check config file
      const configPath = join(testDir, '.lace', 'snapshot-config.json');
      assert.ok(await utils.fileExists(configPath));
      
      const savedConfig = JSON.parse(await utils.readFile(configPath));
      assert.strictEqual(savedConfig.enabled, true);
    });

    test('should load existing configuration', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      // Create existing config
      await fs.mkdir(join(testDir, '.lace'), { recursive: true });
      const configPath = join(testDir, '.lace', 'snapshot-config.json');
      await utils.writeFile(configPath, JSON.stringify({ enabled: false, custom: 'value' }));

      const manager = new SnapshotManager(testDir);
      await manager.initialize();

      assert.strictEqual(manager.config.enabled, false);
      assert.strictEqual(manager.config.custom, 'value');
    });

    test('should create index file if not exists', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      await manager.initialize();

      const indexPath = join(testDir, '.lace', 'snapshots', 'index.json');
      assert.ok(await utils.fileExists(indexPath));
      
      const index = JSON.parse(await utils.readFile(indexPath));
      assert.ok(Array.isArray(index.snapshots));
      assert.strictEqual(index.snapshots.length, 0);
    });
  });

  describe('snapshot creation', () => {
    test('should create pre-tool snapshot with metadata', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      manager.gitOps = mockGitOperations; // Inject mock
      await manager.initialize();

      const toolCall = {
        toolName: 'file-tool',
        operation: 'write',
        parameters: { path: 'test.txt', content: 'test' },
        executionId: 'tool-exec-123'
      };

      const context = {
        conversationTurns: 3,
        recentHistory: ['user said hello', 'agent responded'],
        recentToolUses: ['previous-tool-call'],
        activeAgent: 'coding-agent'
      };

      const snapshot = await manager.createPreToolSnapshot(toolCall, context);
      
      assert.ok(snapshot.snapshotId, 'Should have snapshot ID');
      assert.ok(snapshot.snapshotId.includes('pre-tool'), 'Should be pre-tool snapshot');
      assert.strictEqual(snapshot.type, 'pre-tool');
      assert.deepStrictEqual(snapshot.toolCall, toolCall);
      assert.deepStrictEqual(snapshot.context, context);
      assert.ok(snapshot.timestamp, 'Should have timestamp');
      assert.ok(snapshot.gitCommitSha, 'Should have git commit SHA');
    });

    test('should create post-tool snapshot with execution results', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      manager.gitOps = mockGitOperations; // Inject mock
      await manager.initialize();

      const toolCall = {
        toolName: 'file-tool',
        operation: 'write',
        parameters: { path: 'test.txt', content: 'test' },
        executionId: 'tool-exec-123'
      };

      const context = {
        conversationTurns: 3,
        recentHistory: ['user said hello', 'agent responded'],
        recentToolUses: ['previous-tool-call'],
        activeAgent: 'coding-agent'
      };

      const executionResult = {
        success: true,
        output: 'File written successfully',
        duration: 150
      };

      const snapshot = await manager.createPostToolSnapshot(toolCall, context, executionResult);
      
      assert.ok(snapshot.snapshotId.includes('post-tool'), 'Should be post-tool snapshot');
      assert.strictEqual(snapshot.type, 'post-tool');
      assert.deepStrictEqual(snapshot.executionResult, executionResult);
      assert.ok(snapshot.performance.processingTimeMs >= 0, 'Should have processing time');
    });

    test('should create manual checkpoint snapshot', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      manager.gitOps = mockGitOperations; // Inject mock
      await manager.initialize();

      const description = 'Manual checkpoint before refactoring';
      const snapshot = await manager.createCheckpoint(description);
      
      assert.strictEqual(snapshot.type, 'checkpoint');
      assert.ok(snapshot.snapshotId.includes('checkpoint'), 'Should be checkpoint snapshot');
      assert.strictEqual(snapshot.description, description);
    });

    test('should handle snapshot creation errors gracefully', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const failingGitOps = {
        ...mockGitOperations,
        addAndCommit: async () => { throw new Error('Git operation failed'); }
      };

      const manager = new SnapshotManager(testDir, mockConfig);
      manager.gitOps = failingGitOps;
      await manager.initialize();

      // Create a test file so git operations are called
      await utils.writeFile(join(testDir, 'test.txt'), 'content');

      try {
        await manager.createCheckpoint('Should fail');
        assert.fail('Should throw error when git operations fail');
      } catch (error) {
        assert.ok(error.message.includes('Git operation failed') || 
                 error.message.includes('Failed to create checkpoint'), 'Should provide meaningful error');
      }
    });
  });

  describe('metadata management', () => {
    test('should save and load snapshot metadata', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      manager.gitOps = mockGitOperations;
      await manager.initialize();

      const snapshot = await manager.createCheckpoint('Test checkpoint');
      
      // Verify metadata file was created
      const metadataPath = join(manager.metadataDir, `${snapshot.snapshotId}.json`);
      assert.ok(await utils.fileExists(metadataPath));
      
      // Load and verify metadata
      const loadedMetadata = await manager.loadSnapshotMetadata(snapshot.snapshotId);
      assert.deepStrictEqual(loadedMetadata.snapshotId, snapshot.snapshotId);
      assert.deepStrictEqual(loadedMetadata.type, snapshot.type);
    });

    test('should update snapshot index', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      manager.gitOps = mockGitOperations;
      await manager.initialize();

      // Create test files for commits
      await utils.writeFile(join(testDir, 'test1.txt'), 'content1');
      await manager.createCheckpoint('First checkpoint');
      
      await utils.writeFile(join(testDir, 'test2.txt'), 'content2');
      await manager.createCheckpoint('Second checkpoint');

      const index = await manager.getSnapshotIndex();
      assert.strictEqual(index.snapshots.length, 2);
      assert.ok(index.snapshots[0].snapshotId);
      assert.ok(index.snapshots[1].snapshotId);
      assert.ok(index.lastUpdated);
    });

    test('should handle missing metadata files', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      await manager.initialize();

      try {
        await manager.loadSnapshotMetadata('nonexistent-snapshot');
        assert.fail('Should throw error for missing metadata');
      } catch (error) {
        assert.ok(error.message.includes('not found') || 
                 error.message.includes('metadata'), 'Should indicate missing metadata');
      }
    });
  });

  describe('configuration management', () => {
    test('should apply retention policies', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, {
        ...mockConfig,
        retentionPolicy: { maxSnapshots: 2, maxAge: '1 day' }
      });
      manager.gitOps = mockGitOperations;
      await manager.initialize();

      // Create multiple snapshots with test files
      await utils.writeFile(join(testDir, 'test1.txt'), 'content1');
      await manager.createCheckpoint('First');
      
      await utils.writeFile(join(testDir, 'test2.txt'), 'content2');
      await manager.createCheckpoint('Second');
      
      await utils.writeFile(join(testDir, 'test3.txt'), 'content3');
      await manager.createCheckpoint('Third');

      // Apply retention policy
      const prunedCount = await manager.applyRetentionPolicy();
      
      assert.ok(prunedCount >= 1, 'Should prune excess snapshots');
      
      const index = await manager.getSnapshotIndex();
      assert.ok(index.snapshots.length <= 2, 'Should respect maxSnapshots limit');
    });

    test('should respect exclusion patterns', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, {
        ...mockConfig,
        performance: { excludePatterns: ['*.log', 'temp/**'] }
      });

      const shouldExclude = manager.shouldExcludeFile('debug.log');
      assert.strictEqual(shouldExclude, true, 'Should exclude .log files');

      const shouldInclude = manager.shouldExcludeFile('source.js');
      assert.strictEqual(shouldInclude, false, 'Should include .js files');
    });

    test('should validate configuration on initialization', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const invalidConfig = {
        retentionPolicy: { maxSnapshots: -1 } // Invalid value
      };

      try {
        const manager = new SnapshotManager(testDir, invalidConfig);
        await manager.initialize();
        assert.fail('Should throw error for invalid configuration');
      } catch (error) {
        assert.ok(error.message.includes('configuration') || 
                 error.message.includes('invalid'), 'Should indicate configuration error');
      }
    });
  });

  describe('snapshot querying', () => {
    test('should list snapshots with filtering', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      manager.gitOps = mockGitOperations;
      await manager.initialize();

      const toolCall = {
        toolName: 'file-tool',
        operation: 'write',
        parameters: {},
        executionId: 'test-exec'
      };

      // Create test files for snapshots
      await utils.writeFile(join(testDir, 'test1.txt'), 'content1');
      await manager.createPreToolSnapshot(toolCall, {});
      
      await utils.writeFile(join(testDir, 'test2.txt'), 'content2');
      await manager.createCheckpoint('Manual checkpoint');
      
      await utils.writeFile(join(testDir, 'test3.txt'), 'content3');
      await manager.createPostToolSnapshot(toolCall, {}, { success: true });

      // Test filtering by type
      const checkpoints = await manager.listSnapshots({ type: 'checkpoint' });
      assert.strictEqual(checkpoints.length, 1);
      assert.strictEqual(checkpoints[0].type, 'checkpoint');

      // Test filtering by tool
      const toolSnapshots = await manager.listSnapshots({ tool: 'file-tool' });
      assert.strictEqual(toolSnapshots.length, 2); // pre and post tool snapshots
    });

    test('should search snapshots by date range', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      manager.gitOps = mockGitOperations;
      await manager.initialize();

      // Create test files for snapshots
      await utils.writeFile(join(testDir, 'old.txt'), 'old content');
      await manager.createCheckpoint('Old checkpoint');
      
      // Wait a bit to create time separation
      await utils.sleep(10);
      const startTime = new Date();
      
      await utils.writeFile(join(testDir, 'new.txt'), 'new content');
      await manager.createCheckpoint('New checkpoint');

      const recentSnapshots = await manager.listSnapshots({ since: startTime });
      assert.strictEqual(recentSnapshots.length, 1);
      assert.ok(recentSnapshots[0].description.includes('New'));
    });
  });

  describe('performance monitoring', () => {
    test('should track snapshot creation performance', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      manager.gitOps = mockGitOperations;
      await manager.initialize();

      const snapshot = await manager.createCheckpoint('Performance test');
      
      assert.ok(typeof snapshot.performance.processingTimeMs === 'number');
      assert.ok(snapshot.performance.processingTimeMs >= 0);
      assert.ok(typeof snapshot.performance.snapshotSizeBytes === 'number');
    });

    test('should provide system statistics', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager class not implemented yet');
      }

      const manager = new SnapshotManager(testDir, mockConfig);
      manager.gitOps = mockGitOperations;
      await manager.initialize();

      await manager.createCheckpoint('Test');
      
      const stats = await manager.getSystemStats();
      
      assert.ok(typeof stats.totalSnapshots === 'number');
      assert.ok(typeof stats.totalSize === 'number');
      assert.ok(typeof stats.averageSnapshotSize === 'number');
      assert.ok(stats.oldestSnapshot);
      assert.ok(stats.newestSnapshot);
    });
  });
});