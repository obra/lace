// ABOUTME: TDD failing tests for parallel tool execution implementation
// ABOUTME: Tests Promise.all() based parallel execution, error handling, and concurrency limits

import {
  test,
  describe,
  beforeEach,
  afterEach,
  TestHarness,
  assert,
  utils,
} from "../../test-harness.js";
import { createMockTools } from "../__mocks__/tools-mock.js";

describe("Parallel Tool Execution", () => {
  let harness;
  let agent;
  let mockTools;

  beforeEach(async () => {
    harness = new TestHarness();
    
    // Create reusable mock tools with call tracking
    mockTools = createMockTools();

    // Use TestHarness to create agent instead of direct import
    agent = await harness.createTestAgent({
      generation: 1,
      tools: mockTools,
      maxConcurrentTools: 3, // Test limit
      debugLogging: null, // Disable debug logging to avoid sqlite3 dependency
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  describe("Basic Parallel Execution", () => {
    test("should execute multiple tools in parallel using Promise.all()", async () => {
      // This test should FAIL until parallel execution is implemented

      const toolCalls = [
        { name: "tool1_method1", input: { param: "value1" } },
        { name: "tool2_method2", input: { param: "value2" } },
        { name: "tool3_method3", input: { param: "value3" } },
      ];

      const sessionId = "test-session";
      const startTime = Date.now();

      // Execute tools using the new parallel execution method directly
      const results = await agent.toolExecutor.executeToolsInParallel(
        toolCalls,
        sessionId,
        "test context",
      );

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Check that tools ran in parallel (should fail with current sequential implementation)
      assert.ok(
        totalTime < 200,
        `Total execution time ${totalTime}ms should be < 200ms for parallel execution (sequential would be ~300ms)`,
      );

      // Verify all tools started before any completed (parallel behavior)
      const currentCallOrder = mockTools.getCallOrder();
      const startEvents = currentCallOrder.filter((event) => event.endsWith("_start"));
      const endEvents = currentCallOrder.filter((event) => event.endsWith("_end"));

      // In parallel execution, all starts should come before all ends
      const lastStartIndex = currentCallOrder.lastIndexOf(
        startEvents[startEvents.length - 1],
      );
      const firstEndIndex = currentCallOrder.indexOf(endEvents[0]);

      assert.ok(
        lastStartIndex < firstEndIndex,
        "All tools should start before any complete (parallel execution pattern)",
      );

      // Verify all results are present
      assert.equal(results.length, 3, "Should have results for all tools");
      assert.ok(
        results.every((r) => r.success),
        "All tools should succeed",
      );
    });

    test("should handle mixed success and failure in parallel execution", async () => {
      const toolCalls = [
        { name: "tool1_method1", input: {} },
        { name: "error_method", input: {} }, // This will fail
        { name: "tool3_method3", input: {} },
      ];

      const sessionId = "test-session";

      // This should continue executing successful tools even if some fail
      const results = await agent.toolExecutor.executeToolsInParallel(
        toolCalls,
        sessionId,
        "test context",
      );

      // Should have attempted all tools
      assert.equal(
        results.length,
        3,
        "Should process all tools despite failures",
      );

      // Should have 2 successes and 1 failure
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success || r.error);

      assert.equal(successes.length, 2, "Should have 2 successful results");
      assert.equal(failures.length, 1, "Should have 1 failed result");
      assert.ok(
        failures[0].error && failures[0].error.includes("error_") && failures[0].error.includes("failed"),
        "Should capture error details",
      );
    });
  });

  describe("Concurrency Limits", () => {
    test("should respect maxConcurrentTools limit", async () => {
      // Create 6 tool calls but limit concurrent execution to 3
      const toolCalls = [
        { name: "slow_method", input: { id: 1 } },
        { name: "slow_method", input: { id: 2 } },
        { name: "slow_method", input: { id: 3 } },
        { name: "slow_method", input: { id: 4 } },
        { name: "slow_method", input: { id: 5 } },
        { name: "fast_method", input: { id: 6 } },
      ];

      // Override mock to track concurrent executions
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const originalCallTool = mockTools.callTool;
      mockTools.callTool = async (...args) => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);

        const result = await originalCallTool(...args);

        concurrentCount--;
        return result;
      };

      const sessionId = "test-session";

      // Execute with concurrency limit
      const results = await agent.toolExecutor.executeToolsInParallel(
        toolCalls,
        sessionId,
        "test context",
      );

      // Should never exceed the limit of 3 concurrent tools
      assert.ok(
        maxConcurrent <= 3,
        `Max concurrent tools ${maxConcurrent} should not exceed limit of 3`,
      );
      assert.equal(results.length, 6, "Should process all 6 tools");
    });

    test("should use role-based default maxConcurrentTools", async () => {
      // Agent without explicit maxConcurrentTools should use role's default
      const defaultAgent = await harness.createTestAgent({
        generation: 1,
        tools: mockTools,
        // No maxConcurrentTools specified - should use role default
      });

      // Should use the 'general' role's default value of 8
      assert.equal(
        defaultAgent.maxConcurrentTools,
        8,
        "Should use general role default of 8 concurrent tools",
      );

      // Test with orchestrator role which has different default
      const orchestratorAgent = await harness.createTestAgent({
        generation: 1,
        tools: mockTools,
        role: "orchestrator",
        // No maxConcurrentTools specified - should use orchestrator role default
      });

      // Should use the 'orchestrator' role's default value of 10
      assert.equal(
        orchestratorAgent.maxConcurrentTools,
        10,
        "Should use orchestrator role default of 10 concurrent tools",
      );
    });
  });

  describe("Tool Approval with Parallel Execution", () => {
    test("should handle tool approval for each parallel tool call", async () => {
      // Mock tool approval that tracks approval requests
      const approvalRequests = [];
      const mockApproval = {
        requestApproval: async (toolCall, context) => {
          approvalRequests.push({ toolCall: toolCall.name, context });
          return { approved: true, modifiedCall: null };
        },
      };

      agent.toolApproval = mockApproval;
      agent.toolExecutor.config.toolApproval = mockApproval;

      const toolCalls = [
        { name: "tool1_method1", input: {} },
        { name: "tool2_method2", input: {} },
        { name: "tool3_method3", input: {} },
      ];

      const sessionId = "test-session";

      // Execute tools
      const results = await agent.toolExecutor.executeToolsInParallel(
        toolCalls,
        sessionId,
        "test context",
      );

      // Each tool should have requested approval
      assert.equal(
        approvalRequests.length,
        3,
        "Should request approval for each tool",
      );
      assert.equal(results.length, 3, "Should execute all approved tools");
      assert.ok(
        results.every((r) => r.success),
        "All tools should succeed after approval",
      );
    });

    test("should handle denied tools in parallel execution", async () => {
      const mockApproval = {
        requestApproval: async (approvalRequest) => {
          const toolCall = approvalRequest.toolCall;
          // Deny the second tool
          if (toolCall.name === "tool2_method2") {
            return { approved: false, reason: "Tool denied for testing" };
          }
          return { approved: true, modifiedCall: null };
        },
      };

      agent.toolApproval = mockApproval;
      agent.toolExecutor.config.toolApproval = mockApproval;

      const toolCalls = [
        { name: "tool1_method1", input: {} },
        { name: "tool2_method2", input: {} }, // Will be denied
        { name: "tool3_method3", input: {} },
      ];

      const sessionId = "test-session";

      const results = await agent.toolExecutor.executeToolsInParallel(
        toolCalls,
        sessionId,
        "test context",
      );

      // Should have 2 successful executions and 1 denial
      const deniedResults = results.filter((r) => r.denied);
      const successResults = results.filter((r) => r.success);

      assert.equal(deniedResults.length, 1, "Should have 1 denied result");
      assert.equal(
        successResults.length,
        2,
        "Should have 2 successful results",
      );
    });
  });

  describe("Error Recovery and Resilience", () => {
    test("should continue parallel execution when some tools fail", async () => {
      const toolCalls = [
        { name: "tool1_method1", input: {} },
        { name: "error_method", input: {} }, // Will throw error
        { name: "tool3_method3", input: {} },
        { name: "error_method", input: {} }, // Another error
        { name: "fast_method", input: {} },
      ];

      const sessionId = "test-session";
      const startTime = Date.now();

      const results = await agent.toolExecutor.executeToolsInParallel(
        toolCalls,
        sessionId,
        "test context",
      );

      const endTime = Date.now();

      // Should complete in parallel time despite errors
      assert.ok(
        endTime - startTime < 250,
        "Should complete quickly due to parallel execution",
      );

      // Should have results for all tools (success or error)
      assert.equal(results.length, 5, "Should process all 5 tools");

      const successes = results.filter((r) => r.success);
      const errors = results.filter((r) => r.error);

      assert.equal(successes.length, 3, "Should have 3 successful results");
      assert.equal(errors.length, 2, "Should have 2 error results");
    });
  });

  describe("Performance and Timing", () => {
    test("should demonstrate significant performance improvement over sequential execution", async () => {
      const toolCalls = [
        { name: "slow_method", input: {} }, // 300ms
        { name: "slow_method", input: {} }, // 300ms
        { name: "slow_method", input: {} }, // 300ms
        { name: "slow_method", input: {} }, // 300ms
      ];

      const sessionId = "test-session";
      const startTime = Date.now();

      const results = await agent.toolExecutor.executeToolsInParallel(
        toolCalls,
        sessionId,
        "test context",
      );

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Sequential execution would take ~1200ms (4 * 300ms)
      // Parallel execution with limit 3 should take ~600ms (2 batches of 300ms)
      assert.ok(
        totalTime < 700,
        `Parallel execution (${totalTime}ms) should be much faster than sequential (~1200ms)`,
      );
      assert.equal(results.length, 4, "Should complete all tools");
      assert.ok(
        results.every((r) => r.success),
        "All tools should succeed",
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty tool calls array", async () => {
      const toolCalls = [];
      const sessionId = "test-session";

      // Should handle gracefully without errors
      const results = await agent.toolExecutor.executeToolsInParallel(
        toolCalls,
        sessionId,
        "test context",
      );

      assert.equal(results.length, 0, "Should handle empty array gracefully");
    });

    test("should handle single tool call (no parallelization needed)", async () => {
      const toolCalls = [{ name: "tool1_method1", input: {} }];

      const sessionId = "test-session";

      const results = await agent.toolExecutor.executeToolsInParallel(
        toolCalls,
        sessionId,
        "test context",
      );

      assert.equal(results.length, 1, "Should handle single tool correctly");
      assert.ok(results[0].success, "Single tool should succeed");
    });
  });
});
