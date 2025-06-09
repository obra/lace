// ABOUTME: Integration tests for SnapshotManager with ContextCapture functionality
// ABOUTME: Tests the complete snapshot + context capture system working together

import { test, describe, beforeEach, afterEach, assert } from '../../test-harness.js';
import { TestHarness, utils } from '../../test-harness.js';
import { promises as fs } from 'fs';
import { join } from 'path';

describe('SnapshotManager + ContextCapture Integration', () => {
  let testHarness;
  let testDir;
  let SnapshotManager;
  let ContextCapture;
  let mockGitOperations;
  let mockConversationDB;
  let mockActivityLogger;

  beforeEach(async () => {
    testHarness = new TestHarness();
    testDir = join(process.cwd(), `test-integration-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Create mock ConversationDB
    mockConversationDB = {
      getConversationHistory: async (sessionId, limit) => [
        {
          id: 1,
          sessionId: sessionId,
          generation: 1,
          role: 'user',
          content: 'Test user message',
          timestamp: '2025-06-05T14:30:00Z',
          contextSize: 100
        },
        {
          id: 2,
          sessionId: sessionId,
          generation: 1,
          role: 'assistant',
          content: 'Test assistant response',
          timestamp: '2025-06-05T14:30:05Z',
          contextSize: 150
        }
      ],
      searchConversations: async (sessionId, query, limit) => [
        {
          id: 3,
          content: `Related conversation about ${query}`,
          timestamp: '2025-06-05T14:25:00Z'
        }
      ]
    };

    // Create mock ActivityLogger
    mockActivityLogger = {
      getEvents: async (options) => [
        {
          id: 1,
          eventType: 'tool_call',
          localSessionId: options.sessionId || 'session-123',
          modelSessionId: 'model-456',
          timestamp: '2025-06-05T14:29:30Z',
          data: {
            toolName: 'file-tool',
            operation: 'read',
            parameters: { path: 'test.js' },
            executionId: 'exec-789'
          }
        }
      ]
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
    
    // Try to import the classes
    try {
      const snapshotModule = await import('../../../src/snapshot/snapshot-manager.js');
      const contextModule = await import('../../../src/snapshot/context-capture.js');
      SnapshotManager = snapshotModule.SnapshotManager;
      ContextCapture = contextModule.ContextCapture;
    } catch (error) {
      // Classes don't exist yet, that's expected in TDD
      SnapshotManager = null;
      ContextCapture = null;
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

  describe('Integrated Context Capture', () => {
    test('should enrich snapshot metadata with conversation context', async () => {
      if (!SnapshotManager || !ContextCapture) {
        assert.fail('Classes not implemented yet');
      }

      const manager = new SnapshotManager(testDir);
      manager.gitOps = mockGitOperations; // Inject mock
      await manager.initialize();

      // Set up context capture
      manager.setupContextCapture(mockConversationDB, mockActivityLogger);

      const toolCall = {
        toolName: 'file-tool',
        operation: 'write',
        parameters: { path: 'test.js', content: 'console.log("test");' },
        executionId: 'tool-exec-123'
      };

      // Create snapshot with rich context
      const snapshot = await manager.createPreToolSnapshot(
        toolCall, 
        { legacy: 'context' },
        'session-123',
        5
      );
      
      // Verify snapshot has rich context
      assert.ok(snapshot.context, 'Should have context');
      assert.ok(snapshot.context.sessionId, 'Should have session ID');
      assert.ok(snapshot.context.currentGeneration, 'Should have generation');
      assert.ok(snapshot.context.recentHistory, 'Should have conversation history');
      assert.ok(snapshot.context.recentToolUses, 'Should have tool usage history');
      assert.ok(snapshot.context.currentTool, 'Should have current tool info');
      assert.ok(snapshot.context.realRepoSha, 'Should have real repo SHA');
      
      // Verify enrichment
      assert.ok(snapshot.context.toolCategory, 'Should have tool categorization');
      assert.ok(snapshot.context.semanticHints, 'Should have semantic hints');
      assert.ok(snapshot.context.contextKeywords, 'Should have search keywords');
    });

    test('should work with post-tool snapshots', async () => {
      if (!SnapshotManager || !ContextCapture) {
        assert.fail('Classes not implemented yet');
      }

      const manager = new SnapshotManager(testDir);
      manager.gitOps = mockGitOperations;
      await manager.initialize();
      manager.setupContextCapture(mockConversationDB, mockActivityLogger);

      const toolCall = {
        toolName: 'file-tool',
        operation: 'write',
        parameters: { path: 'test.js' },
        executionId: 'tool-exec-456'
      };

      const executionResult = {
        success: true,
        output: 'File written successfully',
        duration: 250
      };

      const snapshot = await manager.createPostToolSnapshot(
        toolCall,
        { legacy: 'context' },
        executionResult,
        'session-456',
        7
      );

      // Verify rich context in post-tool snapshot
      assert.ok(snapshot.context.sessionId, 'Should have session ID');
      assert.ok(snapshot.context.recentHistory, 'Should have conversation history');
      assert.ok(snapshot.executionResult, 'Should have execution result');
      assert.strictEqual(snapshot.executionResult.success, true);
    });

    test('should fall back gracefully when context capture fails', async () => {
      if (!SnapshotManager || !ContextCapture) {
        assert.fail('Classes not implemented yet');
      }

      // Create failing conversation DB
      const failingConversationDB = {
        getConversationHistory: async () => { throw new Error('DB connection failed'); },
        searchConversations: async () => { throw new Error('DB connection failed'); }
      };

      const manager = new SnapshotManager(testDir);
      manager.gitOps = mockGitOperations;
      await manager.initialize();
      manager.setupContextCapture(failingConversationDB, mockActivityLogger);

      const toolCall = {
        toolName: 'test-tool',
        operation: 'test',
        parameters: {},
        executionId: 'tool-exec-789'
      };

      const legacyContext = { fallback: 'data' };

      // Should not throw and should fall back to legacy context
      const snapshot = await manager.createPreToolSnapshot(
        toolCall,
        legacyContext,
        'session-789',
        3
      );

      assert.ok(snapshot.context, 'Should have context');
      assert.ok(snapshot.context.error, 'Should indicate error occurred');
      assert.strictEqual(snapshot.context.sessionId, 'session-789', 'Should have session ID from degraded context');
    });

    test('should work without context capture setup', async () => {
      if (!SnapshotManager) {
        assert.fail('SnapshotManager not implemented yet');
      }

      const manager = new SnapshotManager(testDir);
      manager.gitOps = mockGitOperations;
      await manager.initialize();
      
      // Don't set up context capture - should use legacy mode

      const toolCall = {
        toolName: 'test-tool',
        operation: 'test',
        parameters: {},
        executionId: 'tool-exec-999'
      };

      const legacyContext = { traditional: 'context' };

      const snapshot = await manager.createPreToolSnapshot(
        toolCall,
        legacyContext,
        'session-999',
        1
      );

      // Should work with legacy context
      assert.deepStrictEqual(snapshot.context, legacyContext, 'Should use legacy context');
      assert.ok(snapshot.snapshotId, 'Should create snapshot');
    });

    test('should capture search terms for tool operations', async () => {
      if (!SnapshotManager || !ContextCapture) {
        assert.fail('Classes not implemented yet');
      }

      const manager = new SnapshotManager(testDir);
      manager.gitOps = mockGitOperations;
      await manager.initialize();
      manager.setupContextCapture(mockConversationDB, mockActivityLogger);

      const toolCall = {
        toolName: 'file-tool',
        operation: 'edit',
        parameters: { 
          path: 'src/components/auth/login.js',
          content: 'function authenticate(user) { return jwt.sign(user); }'
        },
        executionId: 'tool-exec-search'
      };

      const snapshot = await manager.createPreToolSnapshot(
        toolCall,
        {},
        'session-search',
        10
      );

      // Verify search terms were extracted
      const keywords = snapshot.context.contextKeywords;
      assert.ok(Array.isArray(keywords), 'Should have context keywords');
      assert.ok(keywords.includes('file-tool'), 'Should include tool name');
      assert.ok(keywords.includes('auth'), 'Should extract path components');
      assert.ok(keywords.includes('login'), 'Should extract filename parts');
    });
  });
});