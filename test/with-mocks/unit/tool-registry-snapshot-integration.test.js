// ABOUTME: Integration tests for ToolRegistry with automatic snapshot creation on tool execution
// ABOUTME: Tests that tool calls automatically trigger pre/post snapshots with rich context

import {
  test,
  describe,
  beforeEach,
  afterEach,
  assert,
  TestHarness,
  utils,
} from "../../test-harness.js";
import { promises as fs } from "fs";
import { join } from "path";

// Import new mock factories
import {
  createMockDatabase,
  createMockActivityLogger,
} from "../__mocks__/standard-mocks.js";

describe("ToolRegistry Snapshot Integration", () => {
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

    // Create mock ConversationDB using factory
    const conversationHistory = [
      {
        id: 1,
        sessionId: "session-123",
        generation: 1,
        role: "user",
        content: "Please execute this tool",
        timestamp: new Date().toISOString(),
        contextSize: 100,
      },
    ];
    
    mockConversationDB = createMockDatabase({
      conversationHistory,
      shouldSucceed: true
    });
    
    // Override searchConversations for specific test behavior
    mockConversationDB.searchConversations = async () => [];

    // Create mock ActivityLogger using factory
    mockActivityLogger = createMockActivityLogger();
    
    // Override getEvents and logEvent for specific test behavior
    mockActivityLogger.getEvents = async (options) => [
      {
        id: 1,
        eventType: "tool_call",
        localSessionId: options.sessionId || "session-123",
        timestamp: new Date().toISOString(),
        data: { toolName: "previous-tool", operation: "previous-op" },
      },
    ];
    
    mockActivityLogger.logEvent = async (eventType, sessionId, modelSessionId, data) => {
      // Store logged events for verification
      return { id: Date.now(), eventType, sessionId, data };
    };

    // Try to import the classes
    try {
      const toolModule = await import("../../../src/tools/tool-registry.ts");
      const snapshotModule = await import(
        "../../../src/snapshot/snapshot-manager.js"
      );
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

  describe("Automatic Snapshot Creation", () => {
    test("should create pre-tool snapshot before tool execution", async () => {
      if (!ToolRegistry || !SnapshotManager) {
        assert.fail("Classes not implemented yet");
      }

      // Create mock SnapshotManager with tracking
      const mockSnapshotManager = {
        createPreToolSnapshot: async (
          toolCall,
          context,
          sessionId,
          generation,
        ) => {
          const snapshot = {
            snapshotId: `pre-${Date.now()}`,
            type: "pre-tool",
            timestamp: new Date().toISOString(),
            toolCall,
            context,
            sessionId,
            generation,
          };
          mockSnapshots.push(snapshot);
          return snapshot;
        },
        createPostToolSnapshot: async (
          toolCall,
          context,
          result,
          sessionId,
          generation,
        ) => {
          const snapshot = {
            snapshotId: `post-${Date.now()}`,
            type: "post-tool",
            timestamp: new Date().toISOString(),
            toolCall,
            context,
            executionResult: result,
            sessionId,
            generation,
          };
          mockSnapshots.push(snapshot);
          return snapshot;
        },
      };

      const registry = new ToolRegistry({
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager,
      });

      // Register a simple test tool
      class TestTool {
        getMetadata() {
          return {
            name: "test-tool",
            description: "Test tool for snapshot integration",
            methods: {
              run: {
                description: "Simple test operation",
                parameters: {
                  input: { type: "string", description: "Test input" },
                },
              },
            },
          };
        }

        async run(params) {
          return { success: true, data: params.input };
        }

        async execute(params, options = {}) {
          const result = await this.run(params);
          return { success: true, data: result };
        }
      }

      const testTool = new TestTool();

      registry.register("test-tool", testTool);

      // Execute tool with snapshot integration
      const params = { input: "test data" };
      const sessionId = "session-snapshot-test";
      const generation = 1;

      const result = await registry.callToolWithSnapshots(
        "test-tool",
        params,
        sessionId,
        generation,
      );

      // Verify result
      assert.ok(result.success, "Tool execution should succeed");
      assert.strictEqual(
        result.data,
        "test data",
        "Should return expected data",
      );

      // Verify snapshots were created
      assert.strictEqual(
        mockSnapshots.length,
        2,
        "Should create both pre and post snapshots",
      );

      const preSnapshot = mockSnapshots.find((s) => s.type === "pre-tool");
      const postSnapshot = mockSnapshots.find((s) => s.type === "post-tool");

      assert.ok(preSnapshot, "Should create pre-tool snapshot");
      assert.ok(postSnapshot, "Should create post-tool snapshot");

      // Verify snapshot metadata
      assert.strictEqual(preSnapshot.toolCall.toolName, "test-tool");
      assert.strictEqual(preSnapshot.toolCall.operation, "run");
      assert.deepStrictEqual(preSnapshot.toolCall.parameters, params);
      assert.strictEqual(preSnapshot.sessionId, sessionId);
      assert.strictEqual(preSnapshot.generation, generation);

      assert.strictEqual(postSnapshot.toolCall.toolName, "test-tool");
      assert.ok(postSnapshot.executionResult, "Should have execution result");
      assert.strictEqual(postSnapshot.executionResult.success, true);
    });

    test("should create snapshots with rich context from conversation and activity", async () => {
      if (!ToolRegistry || !SnapshotManager) {
        assert.fail("Classes not implemented yet");
      }

      let capturedContext = null;

      const mockSnapshotManager = {
        createPreToolSnapshot: async (
          toolCall,
          context,
          sessionId,
          generation,
        ) => {
          capturedContext = context;
          return {
            snapshotId: `pre-${Date.now()}`,
            type: "pre-tool",
            context,
          };
        },
        createPostToolSnapshot: async () => ({
          snapshotId: `post-${Date.now()}`,
        }),
      };

      const registry = new ToolRegistry({
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager,
        conversationDB: mockConversationDB,
      });

      class ComplexTool {
        getMetadata() {
          return {
            name: "complex-tool",
            description: "Complex test tool",
            methods: {
              run: {
                description: "Complex test operation",
                parameters: {
                  config: { type: "string", description: "Config value" },
                },
              },
            },
          };
        }

        async run(params) {
          return { result: "complex result" };
        }

        async execute(params, options = {}) {
          const result = await this.run(params);
          return { success: true, data: result };
        }
      }

      const testTool = new ComplexTool();

      registry.register("complex-tool", testTool);

      await registry.callToolWithSnapshots(
        "complex-tool",
        { config: "advanced" },
        "session-rich-context",
        5,
      );

      // Verify rich context was captured
      assert.ok(capturedContext, "Should capture context");
      // Context should be enriched by ContextCapture if available
    });

    test("should handle tool execution errors and still create snapshots", async () => {
      if (!ToolRegistry || !SnapshotManager) {
        assert.fail("Classes not implemented yet");
      }

      const mockSnapshotManager = {
        createPreToolSnapshot: async () => ({ snapshotId: "pre-error-test" }),
        createPostToolSnapshot: async (toolCall, context, result) => {
          return {
            snapshotId: "post-error-test",
            executionResult: result,
          };
        },
      };

      const registry = new ToolRegistry({
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager,
      });

      class FailingTool {
        getMetadata() {
          return {
            name: "failing-tool",
            description: "Tool that fails",
            methods: {
              run: {
                description: "Operation that fails",
                parameters: {},
              },
            },
          };
        }

        async run() {
          throw new Error("Tool execution failed");
        }

        async execute(params, options = {}) {
          await this.run(params);
        }
      }

      const failingTool = new FailingTool();

      registry.register("failing-tool", failingTool);

      try {
        await registry.callToolWithSnapshots(
          "failing-tool",
          {},
          "session-error-test",
          1,
        );
        assert.fail("Should throw error when tool fails");
      } catch (error) {
        assert.strictEqual(error.message, "Tool execution failed");
      }

      // Verify snapshots were still created (testing post-snapshot with error info)
      // This would be verified by checking mockSnapshotManager was called
    });

    test("should work with existing tool execution without snapshots", async () => {
      if (!ToolRegistry) {
        assert.fail("ToolRegistry not implemented yet");
      }

      // Test that existing callTool method still works
      const registry = new ToolRegistry({ activityLogger: mockActivityLogger });

      class RegularTool {
        getMetadata() {
          return {
            name: "regular-tool",
            description: "Regular test tool",
            methods: {
              run: {
                description: "Regular operation",
                parameters: {
                  input: { type: "string", description: "Input value" },
                },
              },
            },
          };
        }

        async run(params) {
          return { output: params.input };
        }

        async execute(params, options = {}) {
          const result = await this.run(params);
          return { success: true, data: result };
        }
      }

      const regularTool = new RegularTool();

      registry.register("regular-tool", regularTool);

      const result = await registry.callTool(
        "regular-tool",
        { input: "regular test" },
        "session-regular",
      );

      assert.ok(result.output, "Should execute normally without snapshots");
      assert.strictEqual(result.output, "regular test");
    });

    test("should disable snapshot creation when snapshot manager not configured", async () => {
      if (!ToolRegistry) {
        assert.fail("ToolRegistry not implemented yet");
      }

      // Registry without snapshot manager should work normally
      const registry = new ToolRegistry({ activityLogger: mockActivityLogger });

      class NoSnapshotTool {
        getMetadata() {
          return {
            name: "no-snapshot-tool",
            description: "Tool without snapshots",
            methods: {
              run: {
                description: "Simple operation",
                parameters: {},
              },
            },
          };
        }

        async run() {
          return { success: true };
        }

        async execute(params, options = {}) {
          const result = await this.run(params);
          return { success: true, data: result };
        }
      }

      const testTool = new NoSnapshotTool();

      registry.register("no-snapshot-tool", testTool);

      // This should work even if callToolWithSnapshots is called
      const result = await registry.callToolWithSnapshots(
        "no-snapshot-tool",
        {},
        "session-no-snapshots",
        1,
      );

      assert.ok(
        result.success,
        "Should execute successfully without snapshot manager",
      );
    });
  });

  describe("Tool Call Metadata Enhancement", () => {
    test("should enrich tool calls with execution context", async () => {
      if (!ToolRegistry) {
        assert.fail("ToolRegistry not implemented yet");
      }

      let capturedToolCall = null;

      const mockSnapshotManager = {
        createPreToolSnapshot: async (toolCall) => {
          capturedToolCall = toolCall;
          return { snapshotId: "metadata-test" };
        },
        createPostToolSnapshot: async () => ({ snapshotId: "metadata-post" }),
      };

      const registry = new ToolRegistry({
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager,
      });

      class MetadataTool {
        getMetadata() {
          return {
            name: "metadata-tool",
            description: "Tool with rich metadata",
            methods: {
              run: {
                description: "Operation with annotations",
                parameters: {
                  file: { type: "string", description: "File path" },
                  mode: { type: "string", description: "Operation mode" },
                },
              },
            },
          };
        }

        async run(params) {
          return { processed: params };
        }

        async execute(params, options = {}) {
          const result = await this.run(params);
          return { success: true, data: result };
        }
      }

      const metadataTool = new MetadataTool();

      registry.register("metadata-tool", metadataTool);

      await registry.callToolWithSnapshots(
        "metadata-tool",
        { file: "important.js", mode: "edit" },
        "session-metadata",
        3,
      );

      // Verify enhanced tool call metadata
      assert.ok(capturedToolCall, "Should capture tool call");
      assert.strictEqual(capturedToolCall.toolName, "metadata-tool");
      assert.strictEqual(capturedToolCall.operation, "run");
      assert.ok(capturedToolCall.parameters, "Should have parameters");
      assert.ok(capturedToolCall.executionId, "Should have execution ID");
      assert.ok(capturedToolCall.timestamp, "Should have timestamp");
    });

    test("should track tool execution performance metrics", async () => {
      if (!ToolRegistry) {
        assert.fail("ToolRegistry not implemented yet");
      }

      let capturedResult = null;

      const mockSnapshotManager = {
        createPreToolSnapshot: async () => ({ snapshotId: "perf-pre" }),
        createPostToolSnapshot: async (toolCall, context, result) => {
          capturedResult = result;
          return { snapshotId: "perf-post" };
        },
      };

      const registry = new ToolRegistry({
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager,
      });

      class PerformanceTool {
        getMetadata() {
          return {
            name: "perf-tool",
            description: "Performance testing tool",
            methods: {
              run: {
                description: "Timed operation",
                parameters: {
                  data: { type: "string", description: "Test data" },
                },
              },
            },
          };
        }

        async run(params) {
          // Simulate some work
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { processed: true, input: params };
        }

        async execute(params, options = {}) {
          const result = await this.run(params);
          return { success: true, data: result };
        }
      }

      const performanceTool = new PerformanceTool();

      registry.register("perf-tool", performanceTool);

      await registry.callToolWithSnapshots(
        "perf-tool",
        { data: "performance test" },
        "session-performance",
        1,
      );

      // Verify performance tracking
      assert.ok(capturedResult, "Should capture execution result");
      assert.ok(capturedResult.success, "Should track success status");
      assert.ok(
        capturedResult.duration !== undefined,
        "Should track execution duration",
      );
      assert.ok(capturedResult.result, "Should include tool result");
    });
  });

  describe("Configuration and Integration", () => {
    test("should support configurable snapshot behavior", async () => {
      if (!ToolRegistry) {
        assert.fail("ToolRegistry not implemented yet");
      }

      const config = {
        snapshotConfig: {
          enablePreToolSnapshots: true,
          enablePostToolSnapshots: false,
          snapshotOnErrors: true,
        },
      };

      let preSnapshotCalled = false;
      let postSnapshotCalled = false;

      const mockSnapshotManager = {
        createPreToolSnapshot: async () => {
          preSnapshotCalled = true;
          return { snapshotId: "config-pre" };
        },
        createPostToolSnapshot: async () => {
          postSnapshotCalled = true;
          return { snapshotId: "config-post" };
        },
      };

      const registry = new ToolRegistry({
        activityLogger: mockActivityLogger,
        snapshotManager: mockSnapshotManager,
        ...config,
      });

      class ConfigTool {
        getMetadata() {
          return {
            name: "config-tool",
            description: "Configurable tool",
            methods: {
              run: {
                description: "Configured operation",
                parameters: {},
              },
            },
          };
        }

        async run() {
          return { configured: true };
        }

        async execute(params, options = {}) {
          const result = await this.run(params);
          return { success: true, data: result };
        }
      }

      const configTool = new ConfigTool();

      registry.register("config-tool", configTool);

      await registry.callToolWithSnapshots(
        "config-tool",
        {},
        "session-config",
        1,
      );

      // Verify configuration was respected
      assert.strictEqual(
        preSnapshotCalled,
        true,
        "Should create pre-tool snapshot when enabled",
      );
      // Note: This test structure assumes the implementation will respect these configs
    });

    test("should integrate with existing activity logging", async () => {
      if (!ToolRegistry) {
        assert.fail("ToolRegistry not implemented yet");
      }

      const loggedEvents = [];
      const trackingActivityLogger = {
        ...mockActivityLogger,
        logEvent: async (eventType, sessionId, modelSessionId, data) => {
          loggedEvents.push({ eventType, sessionId, data });
          return { id: Date.now() };
        },
      };

      const registry = new ToolRegistry({
        activityLogger: trackingActivityLogger,
        snapshotManager: {
          createPreToolSnapshot: async () => ({ snapshotId: "activity-pre" }),
          createPostToolSnapshot: async () => ({ snapshotId: "activity-post" }),
        },
      });

      class ActivityTool {
        getMetadata() {
          return {
            name: "activity-tool",
            description: "Activity logging tool",
            methods: {
              run: {
                description: "Logged operation",
                parameters: {},
              },
            },
          };
        }

        async run() {
          return { logged: true };
        }

        async execute(params, options = {}) {
          const result = await this.run(params);
          return { success: true, data: result };
        }
      }

      const activityTool = new ActivityTool();

      registry.register("activity-tool", activityTool);

      await registry.callToolWithSnapshots(
        "activity-tool",
        {},
        "session-activity",
        1,
      );

      // Verify activity logging integration
      const snapshotEvents = loggedEvents.filter(
        (e) => e.eventType.includes("snapshot") || e.eventType.includes("tool"),
      );

      assert.ok(
        snapshotEvents.length > 0,
        "Should log snapshot-related events",
      );
    });
  });
});
