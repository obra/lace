// ABOUTME: Integration tests for dual logging system (activity + debug logging)
// ABOUTME: Verifies both systems work independently without interference

import { test, describe, jest, beforeAll, afterAll } from "@jest/globals";
import assert from "node:assert";
import { Agent } from "../../../src/agents/agent.ts";
import { ToolRegistry } from "../../../src/tools/tool-registry.js";
import { ConversationDB } from "../../../src/database/conversation-db.js";
import { ActivityLogger } from "../../../src/logging/activity-logger.js";
import { DebugLogger } from "../../../src/logging/debug-logger.js";
import { ApprovalEngine } from "../../../src/safety/index.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Mock model provider for testing
class MockModelProvider {
  async chat(messages, options = {}) {
    return {
      success: true,
      content: "Mock response",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      },
      sessionId: "mock-session-123",
    };
  }

  getContextWindow() {
    return 8000;
  }

  calculateCost() {
    return {
      inputCost: 0.001,
      outputCost: 0.002,
      totalCost: 0.003,
    };
  }
}

describe("Dual Logging System Integration", () => {
  let tempDir;
  let activityLogger;
  let tools;
  let db;
  let toolApproval;
  let modelProvider;
  let originalConsoleError;

  beforeAll(() => {
    // Mock console.error to prevent stderr pollution in these logging tests
    originalConsoleError = console.error;
    console.error = jest.fn();
  });

  afterAll(() => {
    // Restore original console.error
    console.error = originalConsoleError;
  });

  // Setup before each test
  async function setup() {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lace-dual-logging-test-"),
    );

    // Initialize activity logger
    activityLogger = new ActivityLogger(path.join(tempDir, "activity-test.db"));
    await activityLogger.initialize();

    // Initialize other components
    tools = new ToolRegistry({ activityLogger });
    await tools.initialize();

    db = new ConversationDB(path.join(tempDir, "conversation-test.db"));
    await db.initialize();

    toolApproval = new ApprovalEngine({
      interactive: false,
      autoApproveTools: ["javascript_evaluate"],
    });

    modelProvider = new MockModelProvider();
  }

  // Cleanup after each test
  async function cleanup() {
    if (activityLogger) {
      await activityLogger.close();
    }
    if (db) {
      await db.close();
    }
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  describe("Debug Logger Initialization", () => {
    test("should initialize debug logger from CLI args", async () => {
      await setup();

      try {
        const debugLogFile = path.join(tempDir, "debug.log");
        const debugLogger = new DebugLogger({
          logLevel: "off", // Don't log to stderr in tests
          logFile: debugLogFile,
          logFileLevel: "debug",
        });
        const agent = new Agent({
          generation: 0,
          tools,
          db,
          modelProvider,
          toolApproval,
          activityLogger,
          role: "general",
          debugLogger,
        });

        // Verify debug logger is initialized
        assert.ok(agent.debugLogger);
        assert.strictEqual(agent.debugLogger.stderrLevel, "off");
        assert.strictEqual(agent.debugLogger.filePath, debugLogFile);
        assert.strictEqual(agent.debugLogger.fileLevel, "debug");
      } finally {
        await cleanup();
      }
    });

    test("should not initialize debug logger when options not provided", async () => {
      await setup();

      try {
        const agent = new Agent({
          generation: 0,
          tools,
          db,
          modelProvider,
          toolApproval,
          activityLogger,
          role: "general",
        });

        // Verify debug logger is not initialized
        assert.strictEqual(agent.debugLogger, null);
      } finally {
        await cleanup();
      }
    });
  });

  describe("Independent Logging Systems", () => {
    test("should log to both systems without interference", async () => {
      await setup();

      try {
        const debugLogFile = path.join(tempDir, "debug.log");
        const debugLogger = new DebugLogger({
          logLevel: "off", // Don't log to stderr in tests
          logFile: debugLogFile,
          logFileLevel: "debug",
        });
        const agent = new Agent({
          generation: 0,
          tools,
          db,
          modelProvider,
          toolApproval,
          activityLogger,
          role: "general",
          verbose: true,
          debugLogger,
        });

        const sessionId = "test-session-dual-logging";

        // Process input to trigger both logging systems
        const result = await agent.processInput(sessionId, "test message");

        // Verify activity logging worked
        const activityEvents = await activityLogger.getEvents({ sessionId });
        assert.ok(activityEvents.length > 0);

        // Find model request and response events
        const modelRequest = activityEvents.find(
          (e) => e.event_type === "model_request",
        );
        const modelResponse = activityEvents.find(
          (e) => e.event_type === "model_response",
        );

        assert.ok(modelRequest, "Should have model_request event");
        assert.ok(modelResponse, "Should have model_response event");

        // Verify model response includes session ID from provider
        const responseData = JSON.parse(modelResponse.data);
        assert.ok(responseData.content);

        // Verify debug logging worked (file should exist and have content)
        const debugLogExists = await fs
          .access(debugLogFile)
          .then(() => true)
          .catch(() => false);
        assert.ok(debugLogExists, "Debug log file should exist");

        const debugLogContent = await fs.readFile(debugLogFile, "utf8");
        assert.ok(debugLogContent.length > 0, "Debug log should have content");

        // Verify result is successful
        assert.ok(result.content);
      } finally {
        await cleanup();
      }
    });

    test("should handle activity logging failure gracefully without affecting debug logging", async () => {
      await setup();

      try {
        const debugLogFile = path.join(tempDir, "debug.log");

        // Close activity logger to simulate failure
        await activityLogger.close();

        const debugLogger = new DebugLogger({
          logLevel: "debug",
          logFile: debugLogFile,
          logFileLevel: "debug",
        });
        const agent = new Agent({
          generation: 0,
          tools,
          db,
          modelProvider,
          toolApproval,
          activityLogger, // Closed logger should cause failures
          role: "general",
          verbose: true,
          debugLogger,
        });

        const sessionId = "test-session-activity-failure";

        // Process input - activity logging should fail but debug logging should work
        const result = await agent.processInput(sessionId, "test message");

        // Verify result is still successful despite activity logging failure
        assert.ok(result.content);

        // Verify debug logging still worked
        const debugLogExists = await fs
          .access(debugLogFile)
          .then(() => true)
          .catch(() => false);
        assert.ok(
          debugLogExists,
          "Debug log file should exist even when activity logging fails",
        );

        const debugLogContent = await fs.readFile(debugLogFile, "utf8");
        assert.ok(
          debugLogContent.length > 0,
          "Debug log should have content even when activity logging fails",
        );
      } finally {
        await cleanup();
      }
    });

    test("should handle debug logging failure without affecting activity logging", async () => {
      await setup();

      try {
        // Use invalid path to cause debug logging failure
        const invalidDebugPath = "/invalid/path/debug.log";

        const debugLogger = new DebugLogger({
          logLevel: "debug",
          logFile: invalidDebugPath,
          logFileLevel: "debug",
        });
        const agent = new Agent({
          generation: 0,
          tools,
          db,
          modelProvider,
          toolApproval,
          activityLogger,
          role: "general",
          verbose: true,
          debugLogger,
        });

        const sessionId = "test-session-debug-failure";

        // Process input - debug logging may fail but activity logging should work
        const result = await agent.processInput(sessionId, "test message");

        // Verify result is successful
        assert.ok(result.content);

        // Verify activity logging worked despite debug logging issues
        const activityEvents = await activityLogger.getEvents({ sessionId });
        assert.ok(
          activityEvents.length > 0,
          "Activity logging should work even when debug logging fails",
        );

        const modelRequest = activityEvents.find(
          (e) => e.event_type === "model_request",
        );
        assert.ok(
          modelRequest,
          "Should have model_request event even when debug logging fails",
        );
      } finally {
        await cleanup();
      }
    });
  });

  describe("Subagent Logger Inheritance", () => {
    test("should pass both loggers to subagents", async () => {
      await setup();

      try {
        const debugLogFile = path.join(tempDir, "debug.log");
        const debugLogger = new DebugLogger({
          logLevel: "off", // Don't log to stderr in tests
          logFile: debugLogFile,
          logFileLevel: "debug",
        });
        const parentAgent = new Agent({
          generation: 0,
          tools,
          db,
          modelProvider,
          toolApproval,
          activityLogger,
          role: "orchestrator",
          debugLogger,
        });

        // Spawn a subagent
        const subagent = await parentAgent.spawnSubagent({
          role: "execution",
          assignedModel: "claude-3-5-haiku-20241022",
          assignedProvider: "anthropic",
        });

        // Verify subagent has both loggers
        assert.ok(
          subagent.activityLogger,
          "Subagent should have activity logger",
        );
        assert.ok(subagent.debugLogger, "Subagent should have debug logger");
        assert.strictEqual(
          subagent.activityLogger,
          parentAgent.activityLogger,
          "Should share same activity logger",
        );

        // Verify debug logger configuration is inherited
        assert.strictEqual(subagent.debugLogger.stderrLevel, "off");
        assert.strictEqual(subagent.debugLogger.filePath, debugLogFile);
        assert.strictEqual(subagent.debugLogger.fileLevel, "debug");
      } finally {
        await cleanup();
      }
    });
  });

  describe("Performance and Independence", () => {
    test("should not significantly impact performance when both systems enabled", async () => {
      await setup();

      try {
        const debugLogFile = path.join(tempDir, "debug.log");

        // Agent with both logging systems
        const debugLogger = new DebugLogger({
          logLevel: "debug",
          logFile: debugLogFile,
          logFileLevel: "debug",
        });
        const agentWithLogging = new Agent({
          generation: 0,
          tools,
          db,
          modelProvider,
          toolApproval,
          activityLogger,
          role: "general",
          verbose: true,
          debugLogger,
        });

        // Agent with no logging
        const agentNoLogging = new Agent({
          generation: 0,
          tools,
          db,
          modelProvider,
          toolApproval,
          activityLogger: null,
          role: "general",
          verbose: false,
        });

        const sessionId1 = "perf-test-with-logging";
        const sessionId2 = "perf-test-no-logging";
        const testMessage = "performance test message";

        // Measure with logging
        const startWith = Date.now();
        await agentWithLogging.processInput(sessionId1, testMessage);
        const timeWith = Date.now() - startWith;

        // Measure without logging
        const startWithout = Date.now();
        await agentNoLogging.processInput(sessionId2, testMessage);
        const timeWithout = Date.now() - startWithout;

        // Logging should not add more than 200ms overhead (generous threshold)
        const overhead = timeWith - timeWithout;
        assert.ok(
          overhead < 200,
          `Logging overhead (${overhead}ms) should be minimal`,
        );
      } finally {
        await cleanup();
      }
    });
  });
});
