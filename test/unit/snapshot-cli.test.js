// ABOUTME: Unit tests for SnapshotCLI class that provides command-line interface for snapshot management
// ABOUTME: Tests user commands for browsing, inspecting, and restoring snapshots with interactive features

import { test, describe, beforeEach, afterEach, assert } from '../test-harness.js';
import { TestHarness, utils } from '../test-harness.js';
import { promises as fs } from 'fs';
import { join } from 'path';

describe('SnapshotCLI', () => {
  let testHarness;
  let testDir;
  let SnapshotCLI;
  let mockSnapshotManager;
  let mockRestoreOperations;
  let mockOutput;
  let capturedOutput;

  beforeEach(async () => {
    testHarness = new TestHarness();
    testDir = join(process.cwd(), `test-cli-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Capture CLI output for testing
    capturedOutput = [];
    mockOutput = {
      log: (...args) => capturedOutput.push({ type: 'log', message: args.join(' ') }),
      info: (...args) => capturedOutput.push({ type: 'info', message: args.join(' ') }),
      warn: (...args) => capturedOutput.push({ type: 'warn', message: args.join(' ') }),
      error: (...args) => capturedOutput.push({ type: 'error', message: args.join(' ') }),
      table: (data) => capturedOutput.push({ type: 'table', data })
    };

    // Create test snapshots data
    const testSnapshots = [
      {
        snapshotId: '2025-06-05T15-30-00-checkpoint',
        type: 'checkpoint',
        timestamp: '2025-06-05T15:30:00Z',
        description: 'Before major refactoring',
        performance: { filesChanged: 5, snapshotSizeBytes: 1024 }
      },
      {
        snapshotId: '2025-06-05T15-35-00-pre-tool-file123',
        type: 'pre-tool',
        timestamp: '2025-06-05T15:35:00Z',
        toolCall: {
          toolName: 'file-tool',
          operation: 'write',
          parameters: { path: 'important.js' }
        },
        performance: { filesChanged: 1, snapshotSizeBytes: 512 }
      },
      {
        snapshotId: '2025-06-05T15-35-01-post-tool-file123',
        type: 'post-tool',
        timestamp: '2025-06-05T15:35:01Z',
        toolCall: {
          toolName: 'file-tool',
          operation: 'write',
          parameters: { path: 'important.js' }
        },
        executionResult: { success: true, duration: 150 },
        performance: { filesChanged: 1, snapshotSizeBytes: 600 }
      }
    ];

    // Mock SnapshotManager
    mockSnapshotManager = {
      listSnapshots: async (filters = {}) => {
        let results = [...testSnapshots];
        if (filters.type) {
          results = results.filter(s => s.type === filters.type);
        }
        return results;
      },
      loadSnapshotMetadata: async (snapshotId) => {
        const snapshot = testSnapshots.find(s => s.snapshotId === snapshotId);
        if (!snapshot) {
          throw new Error(`Snapshot ${snapshotId} not found`);
        }
        return snapshot;
      },
      getSystemStats: async () => ({
        totalSnapshots: testSnapshots.length,
        totalSize: 2136,
        averageSnapshotSize: 712,
        oldestSnapshot: '2025-06-05T15:30:00Z',
        newestSnapshot: '2025-06-05T15:35:01Z'
      })
    };

    // Mock RestoreOperations
    mockRestoreOperations = {
      listAvailableSnapshots: async (filters) => mockSnapshotManager.listSnapshots(filters),
      getSnapshotDetails: async (snapshotId) => mockSnapshotManager.loadSnapshotMetadata(snapshotId),
      previewRestore: async (snapshotId, options = {}) => ({
        snapshotId,
        changes: {
          modified: ['src/main.js', 'package.json'],
          added: ['src/new-feature.js'],
          deleted: ['src/old-file.js'],
          totalChanges: 4
        },
        summary: {
          filesModified: 2,
          filesAdded: 1,
          filesDeleted: 1,
          totalChanges: 4
        },
        snapshotInfo: {
          type: 'checkpoint',
          timestamp: '2025-06-05T15:30:00Z',
          description: 'Before major refactoring'
        },
        forceMode: options.force || false
      }),
      previewFileRestore: async (snapshotId, filePaths) => ({
        snapshotId,
        files: filePaths.map(path => ({ path, status: 'will_be_restored' })),
        snapshotInfo: { type: 'checkpoint', timestamp: '2025-06-05T15:30:00Z' }
      }),
      performSafetyCheck: async () => ({
        hasWorkingTreeChanges: false,
        workingTreeStatus: { modified: [], untracked: [], deleted: [], hasChanges: false },
        recommendations: [],
        safe: true
      }),
      restoreFromSnapshot: async (snapshotId, options = {}) => ({
        success: true,
        snapshotId,
        restoredCommit: 'abc123',
        timestamp: new Date().toISOString(),
        duration: 1500
      }),
      restoreFiles: async (snapshotId, filePaths) => ({
        success: true,
        snapshotId,
        restoredFiles: filePaths,
        timestamp: new Date().toISOString()
      }),
      getRestorationRecommendations: async () => [
        {
          snapshotId: '2025-06-05T15-30-00-checkpoint',
          reason: 'Most recent manual checkpoint',
          priority: 'high',
          type: 'checkpoint'
        },
        {
          snapshotId: '2025-06-05T15-35-01-post-tool-file123',
          reason: 'Recent successful file-tool operation',
          priority: 'medium',
          type: 'tool-operation'
        }
      ],
      findRelatedSnapshots: async (snapshotId) => [
        {
          snapshotId: '2025-06-05T15-35-01-post-tool-file123',
          type: 'post-tool',
          timestamp: '2025-06-05T15:35:01Z'
        }
      ]
    };
    
    // Try to import the class
    try {
      const module = await import('../../src/snapshot/snapshot-cli.js');
      SnapshotCLI = module.SnapshotCLI;
    } catch (error) {
      // Class doesn't exist yet, that's expected in TDD
      SnapshotCLI = null;
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
    test('should create SnapshotCLI with required dependencies', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      assert.strictEqual(cli.snapshotManager, mockSnapshotManager);
      assert.strictEqual(cli.restoreOps, mockRestoreOperations);
      assert.strictEqual(cli.output, mockOutput);
    });

    test('should validate required dependencies', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      try {
        new SnapshotCLI(null, mockRestoreOperations);
        assert.fail('Should require snapshot manager');
      } catch (error) {
        assert.ok(error.message.includes('SnapshotManager'), 'Should validate snapshot manager');
      }

      try {
        new SnapshotCLI(mockSnapshotManager, null);
        assert.fail('Should require restore operations');
      } catch (error) {
        assert.ok(error.message.includes('RestoreOperations'), 'Should validate restore operations');
      }
    });
  });

  describe('list command', () => {
    test('should list all snapshots in table format', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.listSnapshots();
      
      const tableOutput = capturedOutput.find(o => o.type === 'table');
      assert.ok(tableOutput, 'Should output table');
      assert.ok(Array.isArray(tableOutput.data), 'Should output table data');
      assert.strictEqual(tableOutput.data.length, 3, 'Should show all snapshots');
      
      // Verify table columns
      const firstRow = tableOutput.data[0];
      assert.ok(firstRow.snapshotId, 'Should include snapshot ID');
      assert.ok(firstRow.type, 'Should include type');
      assert.ok(firstRow.timestamp, 'Should include timestamp');
    });

    test('should filter snapshots by type', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.listSnapshots({ type: 'checkpoint' });
      
      const tableOutput = capturedOutput.find(o => o.type === 'table');
      assert.ok(tableOutput, 'Should output table');
      assert.strictEqual(tableOutput.data.length, 1, 'Should filter to checkpoints only');
      assert.strictEqual(tableOutput.data[0].type, 'CHECKPOINT');
    });

    test('should show system statistics', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.showSystemStats();
      
      const logOutputs = capturedOutput.filter(o => o.type === 'log');
      assert.ok(logOutputs.length > 0, 'Should output system statistics');
      
      const statsText = logOutputs.map(o => o.message).join(' ');
      assert.ok(statsText.includes('Total snapshots'), 'Should show total snapshots');
      assert.ok(statsText.includes('Total size'), 'Should show total size');
    });
  });

  describe('inspect command', () => {
    test('should show detailed snapshot information', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.inspectSnapshot('2025-06-05T15-30-00-checkpoint');
      
      const outputs = capturedOutput.filter(o => o.type === 'log');
      assert.ok(outputs.length > 0, 'Should output snapshot details');
      
      const allText = outputs.map(o => o.message).join(' ');
      assert.ok(allText.includes('2025-06-05T15-30-00-checkpoint'), 'Should show snapshot ID');
      assert.ok(allText.includes('checkpoint'), 'Should show snapshot type');
      assert.ok(allText.includes('Before major refactoring'), 'Should show description');
    });

    test('should show tool call information for tool snapshots', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.inspectSnapshot('2025-06-05T15-35-00-pre-tool-file123');
      
      const outputs = capturedOutput.filter(o => o.type === 'log');
      const allText = outputs.map(o => o.message).join(' ');
      
      assert.ok(allText.includes('file-tool'), 'Should show tool name');
      assert.ok(allText.includes('write'), 'Should show operation');
      assert.ok(allText.includes('important.js'), 'Should show file path');
    });

    test('should show related snapshots', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.inspectSnapshot('2025-06-05T15-35-00-pre-tool-file123', { showRelated: true });
      
      const outputs = capturedOutput.filter(o => o.type === 'log');
      const allText = outputs.map(o => o.message).join(' ');
      
      assert.ok(allText.includes('Related'), 'Should show related snapshots section');
      assert.ok(allText.includes('post-tool'), 'Should show related post-tool snapshot');
    });

    test('should handle missing snapshot gracefully', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.inspectSnapshot('nonexistent-snapshot');
      
      const errorOutputs = capturedOutput.filter(o => o.type === 'error');
      assert.ok(errorOutputs.length > 0, 'Should output error message');
      assert.ok(errorOutputs[0].message.includes('not found'), 'Should indicate snapshot not found');
    });
  });

  describe('restore preview command', () => {
    test('should preview full restoration changes', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.previewRestore('2025-06-05T15-30-00-checkpoint');
      
      const outputs = capturedOutput.filter(o => o.type === 'log');
      const allText = outputs.map(o => o.message).join(' ');
      
      assert.ok(allText.includes('Preview'), 'Should show preview header');
      assert.ok(allText.includes('4') && allText.includes('changes'), 'Should show total changes');
      assert.ok(allText.includes('src/main.js'), 'Should list changed files');
      assert.ok(allText.includes('package.json'), 'Should list modified files');
    });

    test('should preview file restoration', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.previewFileRestore('2025-06-05T15-30-00-checkpoint', ['src/main.js', 'package.json']);
      
      const outputs = capturedOutput.filter(o => o.type === 'log');
      const allText = outputs.map(o => o.message).join(' ');
      
      assert.ok(allText.includes('File Restore Preview'), 'Should show file restore header');
      assert.ok(allText.includes('src/main.js'), 'Should list files to restore');
      assert.ok(allText.includes('package.json'), 'Should list all requested files');
    });

    test('should show safety warnings', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      // Mock unsafe working tree
      const unsafeRestoreOps = {
        ...mockRestoreOperations,
        performSafetyCheck: async () => ({
          hasWorkingTreeChanges: true,
          workingTreeStatus: { modified: ['file1.js'], hasChanges: true },
          recommendations: ['Commit or stash your changes', 'Use --force to override'],
          safe: false
        })
      };

      const cli = new SnapshotCLI(mockSnapshotManager, unsafeRestoreOps, { output: mockOutput });
      
      await cli.previewRestore('2025-06-05T15-30-00-checkpoint');
      
      const warnOutputs = capturedOutput.filter(o => o.type === 'warn');
      assert.ok(warnOutputs.length > 0, 'Should show safety warnings');
      
      const warningText = warnOutputs.map(o => o.message).join(' ');
      assert.ok(warningText.includes('working tree'), 'Should warn about working tree changes');
    });
  });

  describe('restore command', () => {
    test('should restore from snapshot with confirmation', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { 
        output: mockOutput,
        interactive: false // Disable interactive mode for testing
      });
      
      await cli.restoreFromSnapshot('2025-06-05T15-30-00-checkpoint', { confirm: true });
      
      const infoOutputs = capturedOutput.filter(o => o.type === 'info');
      assert.ok(infoOutputs.length > 0, 'Should output restoration result');
      
      const infoText = infoOutputs.map(o => o.message).join(' ');
      assert.ok(infoText.includes('successfully restored'), 'Should confirm restoration success');
      assert.ok(infoText.includes('abc123'), 'Should show restored commit');
    });

    test('should restore specific files', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { 
        output: mockOutput,
        interactive: false
      });
      
      await cli.restoreFiles('2025-06-05T15-30-00-checkpoint', ['src/main.js'], { confirm: true });
      
      const infoOutputs = capturedOutput.filter(o => o.type === 'info');
      const infoText = infoOutputs.map(o => o.message).join(' ');
      
      assert.ok(infoText.includes('Files restored'), 'Should confirm file restoration');
      assert.ok(infoText.includes('src/main.js'), 'Should list restored files');
    });

    test('should handle restoration errors gracefully', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const failingRestoreOps = {
        ...mockRestoreOperations,
        restoreFromSnapshot: async () => {
          throw new Error('Restoration failed: Git checkout error');
        }
      };

      const cli = new SnapshotCLI(mockSnapshotManager, failingRestoreOps, { 
        output: mockOutput,
        interactive: false
      });
      
      await cli.restoreFromSnapshot('2025-06-05T15-30-00-checkpoint', { confirm: true });
      
      const errorOutputs = capturedOutput.filter(o => o.type === 'error');
      assert.ok(errorOutputs.length > 0, 'Should output error message');
      assert.ok(errorOutputs[0].message.includes('Restoration failed'), 'Should show error details');
    });
  });

  describe('recommendations command', () => {
    test('should show restoration recommendations', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.showRecommendations();
      
      const outputs = capturedOutput.filter(o => o.type === 'log');
      const allText = outputs.map(o => o.message).join(' ');
      
      assert.ok(allText.includes('Recommendations'), 'Should show recommendations header');
      
      // Check table output for recommendation details
      const tableOutput = capturedOutput.find(o => o.type === 'table');
      if (tableOutput) {
        const tableText = JSON.stringify(tableOutput.data);
        assert.ok(tableText.includes('manual checkpoint'), 'Should show recommendation reasons in table');
        assert.ok(tableText.includes('HIGH'), 'Should show priority levels in table');
      } else {
        assert.ok(allText.includes('manual checkpoint'), 'Should show recommendation reasons');
        assert.ok(allText.includes('HIGH'), 'Should show priority levels');
      }
    });

    test('should format recommendations with priorities', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.showRecommendations();
      
      const tableOutput = capturedOutput.find(o => o.type === 'table');
      assert.ok(tableOutput, 'Should output recommendations table');
      assert.ok(tableOutput.data.length >= 2, 'Should show multiple recommendations');
      
      const highPriorityRec = tableOutput.data.find(r => r.priority === 'HIGH');
      assert.ok(highPriorityRec, 'Should include high priority recommendation');
      assert.ok(highPriorityRec.snapshotId, 'Should include snapshot ID');
      assert.ok(highPriorityRec.reason, 'Should include reason');
    });
  });

  describe('interactive features', () => {
    test('should support interactive snapshot selection', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      // Mock user input
      const mockPrompt = {
        select: async (options) => '2025-06-05T15-30-00-checkpoint'
      };

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { 
        output: mockOutput,
        prompt: mockPrompt,
        interactive: true
      });
      
      const selectedSnapshot = await cli.selectSnapshotInteractively();
      
      assert.strictEqual(selectedSnapshot, '2025-06-05T15-30-00-checkpoint');
    });

    test('should prompt for confirmation on destructive operations', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      let confirmationPrompted = false;
      const mockPrompt = {
        confirm: async (message) => {
          confirmationPrompted = true;
          return true;
        }
      };

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { 
        output: mockOutput,
        prompt: mockPrompt,
        interactive: true
      });
      
      await cli.restoreFromSnapshot('2025-06-05T15-30-00-checkpoint');
      
      assert.ok(confirmationPrompted, 'Should prompt for confirmation');
    });
  });

  describe('help and usage', () => {
    test('should show help information', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.showHelp();
      
      const outputs = capturedOutput.filter(o => o.type === 'log');
      const helpText = outputs.map(o => o.message).join(' ');
      
      assert.ok(helpText.includes('Usage'), 'Should show usage information');
      assert.ok(helpText.includes('list'), 'Should document list command');
      assert.ok(helpText.includes('inspect'), 'Should document inspect command');
      assert.ok(helpText.includes('restore'), 'Should document restore command');
    });

    test('should show command examples', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      await cli.showExamples();
      
      const outputs = capturedOutput.filter(o => o.type === 'log');
      const exampleText = outputs.map(o => o.message).join(' ');
      
      assert.ok(exampleText.includes('Examples'), 'Should show examples header');
      assert.ok(exampleText.includes('lace snapshot'), 'Should show command examples');
    });
  });

  describe('output formatting', () => {
    test('should format timestamps in human-readable format', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      const formatted = cli.formatTimestamp('2025-06-05T15:30:00Z');
      
      assert.ok(formatted, 'Should format timestamp');
      assert.ok(typeof formatted === 'string', 'Should return string');
      // Should be more readable than the raw ISO string
      assert.notStrictEqual(formatted, '2025-06-05T15:30:00Z');
    });

    test('should format file sizes in human-readable format', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { output: mockOutput });
      
      const formatted = cli.formatFileSize(1024);
      assert.ok(formatted.includes('1'), 'Should format 1024 bytes');
      assert.ok(formatted.includes('KB'), 'Should use KB unit');
      
      const largeFormatted = cli.formatFileSize(1048576);
      assert.ok(largeFormatted.includes('MB'), 'Should use MB for larger files');
    });

    test('should colorize output based on type and priority', async () => {
      if (!SnapshotCLI) {
        assert.fail('SnapshotCLI class not implemented yet');
      }

      const cli = new SnapshotCLI(mockSnapshotManager, mockRestoreOperations, { 
        output: mockOutput,
        colors: true
      });
      
      const errorText = cli.colorize('Error message', 'error');
      const successText = cli.colorize('Success message', 'success');
      const warningText = cli.colorize('Warning message', 'warning');
      
      assert.ok(typeof errorText === 'string', 'Should return colored error text');
      assert.ok(typeof successText === 'string', 'Should return colored success text');
      assert.ok(typeof warningText === 'string', 'Should return colored warning text');
    });
  });
});