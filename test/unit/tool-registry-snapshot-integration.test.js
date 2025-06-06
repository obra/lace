// ABOUTME: Integration tests for ToolRegistry with automatic snapshot creation on tool execution
// ABOUTME: Tests that tool calls automatically trigger pre/post snapshots with rich context

import { test, describe, beforeEach, afterEach, assert } from '../test-harness.js';
import { TestHarness, utils } from '../test-harness.js';
import { promises as fs } from 'fs';
import { join } from 'path';

describe('ToolRegistry Snapshot Integration', () => {
  let testHarness;
  let testDir;
  let ToolRegistry;
  let SnapshotManager;
  let mockConversationDB;
  let mockActivityLogger;
  let mockSnapshots;

  beforeEach(async () => {
    testHarness = new TestHarness();
    testDir = join(process.cwd(), `test-tool-integration-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Track created snapshots for verification
    mockSnapshots = [];
    
    // Create mock ConversationDB
    mockConversationDB = {
      getConversationHistory: async (sessionId, limit) => [
        {
          id: 1,
          sessionId: sessionId,
          generation: 1,
          role: 'user',
          content: 'Please execute this tool',
          timestamp: new Date().toISOString(),
          contextSize: 100
        }
      ],
      searchConversations: async () => []
    };

    // Create mock ActivityLogger
    mockActivityLogger = {
      getEvents: async (options) => [
        {
          id: 1,
          eventType: 'tool_call',
          localSessionId: options.sessionId || 'session-123',
          timestamp: new Date().toISOString(),
          data: { toolName: 'previous-tool', operation: 'previous-op' }
        }
      ],
      logEvent: async (eventType, sessionId, modelSessionId, data) => {
        // Store logged events for verification
        return { id: Date.now(), eventType, sessionId, data };
      }
    };
    
    // Try to import the classes
    try {
      const toolModule = await import('../../src/tools/tool-registry.js');
      const snapshotModule = await import('../../src/snapshot/snapshot-manager.js');
      ToolRegistry = toolModule.ToolRegistry;
      SnapshotManager = snapshotModule.SnapshotManager;
    } catch (error) {
      // Classes don't exist yet, that's expected in TDD
      ToolRegistry = null;
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

  describe('Automatic Snapshot Creation', () => {
    test('should create pre-tool snapshot before tool execution', async () => {
      if (!ToolRegistry || !SnapshotManager) {
        assert.fail('Classes not implemented yet');
      }

      // Create mock SnapshotManager with tracking
      const mockSnapshotManager = {
        createPreToolSnapshot: async (toolCall, context, sessionId, generation) => {
          const snapshot = {
            snapshotId: `pre-${Date.now()}`,
            type: 'pre-tool',
            timestamp: new Date().toISOString(),
            toolCall,
            context,
            sessionId,
            generation
          };
          mockSnapshots.push(snapshot);
          return snapshot;
        },
        createPostToolSnapshot: async (toolCall, context, result, sessionId, generation) => {
          const snapshot = {
            snapshotId: `post-${Date.now()}`,
            type: 'post-tool',
            timestamp: new Date().toISOString(),
            toolCall,
            context,
            executionResult: result,
            sessionId,
            generation
          };
          mockSnapshots.push(snapshot);
          return snapshot;
        }
      };

      const registry = new ToolRegistry({ 
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager 
      });

      // Register a simple test tool
      const testTool = {
        simpleOperation: async (params) => {
          return { success: true, data: params.input };
        },
        getSchema: () => ({
          name: 'test-tool',
          description: 'Test tool for snapshot integration',
          methods: {
            simpleOperation: {
              description: 'Simple test operation',
              parameters: {
                input: { type: 'string', description: 'Test input' }
              }
            }
          }
        })
      };

      registry.register('test-tool', testTool);

      // Execute tool with snapshot integration
      const params = { input: 'test data' };
      const sessionId = 'session-snapshot-test';
      const generation = 1;

      const result = await registry.callToolWithSnapshots(
        'test-tool', 
        'simpleOperation', 
        params, 
        sessionId,
        generation
      );

      // Verify result
      assert.ok(result.success, 'Tool execution should succeed');
      assert.strictEqual(result.data, 'test data', 'Should return expected data');

      // Verify snapshots were created
      assert.strictEqual(mockSnapshots.length, 2, 'Should create both pre and post snapshots');
      
      const preSnapshot = mockSnapshots.find(s => s.type === 'pre-tool');
      const postSnapshot = mockSnapshots.find(s => s.type === 'post-tool');
      
      assert.ok(preSnapshot, 'Should create pre-tool snapshot');
      assert.ok(postSnapshot, 'Should create post-tool snapshot');
      
      // Verify snapshot metadata
      assert.strictEqual(preSnapshot.toolCall.toolName, 'test-tool');
      assert.strictEqual(preSnapshot.toolCall.operation, 'simpleOperation');
      assert.deepStrictEqual(preSnapshot.toolCall.parameters, params);
      assert.strictEqual(preSnapshot.sessionId, sessionId);
      assert.strictEqual(preSnapshot.generation, generation);
      
      assert.strictEqual(postSnapshot.toolCall.toolName, 'test-tool');
      assert.ok(postSnapshot.executionResult, 'Should have execution result');
      assert.strictEqual(postSnapshot.executionResult.success, true);
    });

    test('should create snapshots with rich context from conversation and activity', async () => {
      if (!ToolRegistry || !SnapshotManager) {
        assert.fail('Classes not implemented yet');
      }

      let capturedContext = null;

      const mockSnapshotManager = {
        createPreToolSnapshot: async (toolCall, context, sessionId, generation) => {
          capturedContext = context;
          return {
            snapshotId: `pre-${Date.now()}`,
            type: 'pre-tool',
            context
          };
        },
        createPostToolSnapshot: async () => ({ snapshotId: `post-${Date.now()}` })
      };

      const registry = new ToolRegistry({ 
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager,
        conversationDB: mockConversationDB
      });

      const testTool = {
        complexOperation: async (params) => ({ result: 'complex result' }),
        getSchema: () => ({ name: 'complex-tool' })
      };

      registry.register('complex-tool', testTool);

      await registry.callToolWithSnapshots(
        'complex-tool',
        'complexOperation',
        { config: 'advanced' },
        'session-rich-context',
        5
      );

      // Verify rich context was captured
      assert.ok(capturedContext, 'Should capture context');
      // Context should be enriched by ContextCapture if available
    });

    test('should handle tool execution errors and still create snapshots', async () => {
      if (!ToolRegistry || !SnapshotManager) {
        assert.fail('Classes not implemented yet');
      }

      const mockSnapshotManager = {
        createPreToolSnapshot: async () => ({ snapshotId: 'pre-error-test' }),
        createPostToolSnapshot: async (toolCall, context, result) => {
          return {
            snapshotId: 'post-error-test',
            executionResult: result
          };
        }
      };

      const registry = new ToolRegistry({ 
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager 
      });

      const failingTool = {
        failingOperation: async () => {
          throw new Error('Tool execution failed');
        },
        getSchema: () => ({ name: 'failing-tool' })
      };

      registry.register('failing-tool', failingTool);

      try {
        await registry.callToolWithSnapshots(
          'failing-tool',
          'failingOperation',
          {},
          'session-error-test',
          1
        );
        assert.fail('Should throw error when tool fails');
      } catch (error) {
        assert.strictEqual(error.message, 'Tool execution failed');
      }

      // Verify snapshots were still created (testing post-snapshot with error info)
      // This would be verified by checking mockSnapshotManager was called
    });

    test('should work with existing tool execution without snapshots', async () => {
      if (!ToolRegistry) {
        assert.fail('ToolRegistry not implemented yet');
      }

      // Test that existing callTool method still works
      const registry = new ToolRegistry({ activityLogger: mockActivityLogger });

      const regularTool = {
        regularOperation: async (params) => ({ output: params.input }),
        getSchema: () => ({ name: 'regular-tool' })
      };

      registry.register('regular-tool', regularTool);

      const result = await registry.callTool(
        'regular-tool',
        'regularOperation',
        { input: 'regular test' },
        'session-regular'
      );

      assert.ok(result.output, 'Should execute normally without snapshots');
      assert.strictEqual(result.output, 'regular test');
    });

    test('should disable snapshot creation when snapshot manager not configured', async () => {
      if (!ToolRegistry) {
        assert.fail('ToolRegistry not implemented yet');
      }

      // Registry without snapshot manager should work normally
      const registry = new ToolRegistry({ activityLogger: mockActivityLogger });

      const testTool = {
        operation: async () => ({ success: true }),
        getSchema: () => ({ name: 'no-snapshot-tool' })
      };

      registry.register('no-snapshot-tool', testTool);

      // This should work even if callToolWithSnapshots is called
      const result = await registry.callToolWithSnapshots(
        'no-snapshot-tool',
        'operation',
        {},
        'session-no-snapshots',
        1
      );

      assert.ok(result.success, 'Should execute successfully without snapshot manager');
    });
  });

  describe('Tool Call Metadata Enhancement', () => {
    test('should enrich tool calls with execution context', async () => {
      if (!ToolRegistry) {
        assert.fail('ToolRegistry not implemented yet');
      }

      let capturedToolCall = null;

      const mockSnapshotManager = {
        createPreToolSnapshot: async (toolCall) => {
          capturedToolCall = toolCall;
          return { snapshotId: 'metadata-test' };
        },
        createPostToolSnapshot: async () => ({ snapshotId: 'metadata-post' })
      };

      const registry = new ToolRegistry({ 
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager 
      });

      const metadataTool = {
        annotatedOperation: async (params) => ({ processed: params }),
        getSchema: () => ({ 
          name: 'metadata-tool',
          description: 'Tool with rich metadata' 
        })
      };

      registry.register('metadata-tool', metadataTool);

      await registry.callToolWithSnapshots(
        'metadata-tool',
        'annotatedOperation',
        { file: 'important.js', mode: 'edit' },
        'session-metadata',
        3
      );

      // Verify enhanced tool call metadata
      assert.ok(capturedToolCall, 'Should capture tool call');
      assert.strictEqual(capturedToolCall.toolName, 'metadata-tool');
      assert.strictEqual(capturedToolCall.operation, 'annotatedOperation');
      assert.ok(capturedToolCall.parameters, 'Should have parameters');
      assert.ok(capturedToolCall.executionId, 'Should have execution ID');
      assert.ok(capturedToolCall.timestamp, 'Should have timestamp');
    });

    test('should track tool execution performance metrics', async () => {
      if (!ToolRegistry) {
        assert.fail('ToolRegistry not implemented yet');
      }

      let capturedResult = null;

      const mockSnapshotManager = {
        createPreToolSnapshot: async () => ({ snapshotId: 'perf-pre' }),
        createPostToolSnapshot: async (toolCall, context, result) => {
          capturedResult = result;
          return { snapshotId: 'perf-post' };
        }
      };

      const registry = new ToolRegistry({ 
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager 
      });

      const performanceTool = {
        timedOperation: async (params) => {
          // Simulate some work
          await new Promise(resolve => setTimeout(resolve, 10));
          return { processed: true, input: params };
        }
      };

      registry.register('perf-tool', performanceTool);

      await registry.callToolWithSnapshots(
        'perf-tool',
        'timedOperation',
        { data: 'performance test' },
        'session-performance',
        1
      );

      // Verify performance tracking
      assert.ok(capturedResult, 'Should capture execution result');
      assert.ok(capturedResult.success, 'Should track success status');
      assert.ok(capturedResult.duration !== undefined, 'Should track execution duration');
      assert.ok(capturedResult.result, 'Should include tool result');
    });
  });

  describe('Configuration and Integration', () => {
    test('should support configurable snapshot behavior', async () => {
      if (!ToolRegistry) {
        assert.fail('ToolRegistry not implemented yet');
      }

      const config = {
        snapshotConfig: {
          enablePreToolSnapshots: true,
          enablePostToolSnapshots: false,
          snapshotOnErrors: true
        }
      };

      let preSnapshotCalled = false;
      let postSnapshotCalled = false;

      const mockSnapshotManager = {
        createPreToolSnapshot: async () => {
          preSnapshotCalled = true;
          return { snapshotId: 'config-pre' };
        },
        createPostToolSnapshot: async () => {
          postSnapshotCalled = true;
          return { snapshotId: 'config-post' };
        }
      };

      const registry = new ToolRegistry({ 
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager,
        ...config
      });

      const configTool = {
        configOperation: async () => ({ configured: true })
      };

      registry.register('config-tool', configTool);

      await registry.callToolWithSnapshots(
        'config-tool',
        'configOperation',
        {},
        'session-config',
        1
      );

      // Verify configuration was respected
      assert.strictEqual(preSnapshotCalled, true, 'Should create pre-tool snapshot when enabled');
      // Note: This test structure assumes the implementation will respect these configs
    });

    test('should integrate with existing activity logging', async () => {
      if (!ToolRegistry) {
        assert.fail('ToolRegistry not implemented yet');
      }

      const loggedEvents = [];
      const trackingActivityLogger = {
        ...mockActivityLogger,
        logEvent: async (eventType, sessionId, modelSessionId, data) => {
          loggedEvents.push({ eventType, sessionId, data });
          return { id: Date.now() };
        }
      };

      const registry = new ToolRegistry({ 
        activityLogger: trackingActivityLogger,
        snapshotManager: { 
          createPreToolSnapshot: async () => ({ snapshotId: 'activity-pre' }),
          createPostToolSnapshot: async () => ({ snapshotId: 'activity-post' })
        }
      });

      const activityTool = {
        loggedOperation: async () => ({ logged: true })
      };

      registry.register('activity-tool', activityTool);

      await registry.callToolWithSnapshots(
        'activity-tool',
        'loggedOperation',
        {},
        'session-activity',
        1
      );

      // Verify activity logging integration
      const snapshotEvents = loggedEvents.filter(e => 
        e.eventType.includes('snapshot') || e.eventType.includes('tool')
      );
      
      assert.ok(snapshotEvents.length > 0, 'Should log snapshot-related events');
    });
  });
});