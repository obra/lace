// ABOUTME: Integration tests for core Lace functionality without API dependencies
// ABOUTME: Tests system integration, tool coordination, and agent workflows

import {
  test,
  describe,
  beforeEach,
  afterEach,
  TestHarness,
  assert,
} from "@test/test-harness.ts";
import { Conversation } from "../../../src/conversation/conversation.js";
import { jest } from "@jest/globals";

// Integration tests use real implementations

describe("Lace Integration Tests", () => {
  let harness;

  beforeEach(async () => {
    harness = new TestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  describe("System Initialization", () => {
    test("should initialize all core systems", async () => {
      const lace = await harness.createTestLaceUI();

      assert.ok(lace.conversation, "Should have conversation");
      assert.ok(lace.tools, "Should have tool registry");
      assert.ok(lace.agentCoordinator.primaryAgentInstance, "Should have primary agent");
      assert.strictEqual(
        lace.agentCoordinator.primaryAgentInstance.role,
        "orchestrator",
        "Primary agent should be orchestrator",
      );
    });

    test("should have all required tools available", async () => {
      const lace = await harness.createTestLaceUI();

      const tools = lace.tools.listTools();
      const requiredTools = ["shell", "read_file", "javascript", "file_search"];

      for (const tool of requiredTools) {
        assert.ok(tools.includes(tool), `Should have ${tool} tool`);
      }
    });

    test("should prepare tools for LLM format", async () => {
      const lace = await harness.createTestLaceUI();

      const toolsForLLM = lace.agentCoordinator.primaryAgentInstance.toolExecutor.buildToolsForLLM();

      assert.ok(Array.isArray(toolsForLLM), "Should return array of tools");
      assert.ok(toolsForLLM.length > 0, "Should have tools available");

      // Check tool format
      const sampleTool = toolsForLLM[0];
      assert.ok(sampleTool.name, "Tool should have name");
      assert.ok(sampleTool.description, "Tool should have description");
      assert.ok(sampleTool.input_schema, "Tool should have input schema");
    });
  });

  describe("Agent Coordination", () => {
    test("should spawn subagents with correct configuration", async () => {
      const lace = await harness.createTestLaceUI();

      const mockModelInstance = {
        definition: {
          name: "claude-3-5-haiku-20241022",
          provider: "anthropic",
          contextWindow: 200000,
          inputPrice: 0.25,
          outputPrice: 1.25,
          capabilities: ["chat", "tools"]
        },
        chat: async () => ({ success: true, content: "Mock" })
      };

      const subagent = await lace.agentCoordinator.primaryAgentInstance.spawnSubagent({
        role: "execution",
        model: mockModelInstance,
        task: "Test task",
      });

      assert.strictEqual(
        subagent.role,
        "execution",
        "Subagent should have correct role",
      );
      assert.strictEqual(
        subagent.model.definition.name,
        "claude-3-5-haiku-20241022",
        "Subagent should have correct model",
      );
      assert.strictEqual(
        subagent.task,
        "Test task",
        "Subagent should have assigned task",
      );
    });

    test("should analyze tasks and choose appropriate agents", async () => {
      const lace = await harness.createTestLaceUI();

      const testCases = [
        { task: "plan authentication system", expectedRole: "planning" },
        { task: "list files in directory", expectedRole: "execution" },
        { task: "debug this error message", expectedRole: "reasoning" },
        { task: "run npm install", expectedRole: "execution" },
      ];

      for (const testCase of testCases) {
        const config = lace.agentCoordinator.primaryAgentInstance.chooseAgentForTask(testCase.task);
        assert.strictEqual(
          config.role,
          testCase.expectedRole,
          `Task "${testCase.task}" should choose ${testCase.expectedRole} agent`,
        );
      }
    });
  });

  describe("Tool Integration", () => {
    test("should execute file operations through agent", async () => {
      const lace = await harness.createTestLaceUI();

      // Create a temp file to test with
      const tempFile = await harness.createTempFile("test content");

      // Test tool execution through agent
      const result = await lace.agentCoordinator.primaryAgentInstance.toolExecutor.executeTool({
        name: "read_file",
        input: { path: tempFile },
      }, "test-session");

      assert.ok(result.success, "File read should succeed");
      assert.strictEqual(
        result.content,
        "test content",
        "Should read correct content",
      );
    });

    test("should execute JavaScript calculations", async () => {
      const lace = await harness.createTestLaceUI();

      const result = await lace.agentCoordinator.primaryAgentInstance.toolExecutor.executeTool({
        name: "javascript",
        input: { code: "6 * 12" },
      }, "test-session");

      assert.ok(result.success, "Calculation should succeed");
      assert.strictEqual(result.result, 72, "Should calculate correctly");
    });

    test("should handle shell commands", async () => {
      const lace = await harness.createTestLaceUI();

      const result = await lace.agentCoordinator.primaryAgentInstance.toolExecutor.executeTool({
        name: "shell",
        input: { command: 'echo "test"' },
      }, "test-session");

      assert.ok(result.success, "Shell command should succeed");
      assert.strictEqual(
        result.stdout.trim(),
        "test",
        "Should return command output",
      );
    });
  });

  describe("Conversation Persistence", () => {
    test("should save and retrieve conversation history", async () => {
      const lace = await harness.createTestLaceUI();

      // Use the existing conversation from lace
      await lace.conversation.addUserMessage("Test message");
      await lace.conversation.addAssistantMessage("Test response");

      // Retrieve history
      const history = await lace.conversation.getMessages();

      assert.strictEqual(history.length, 2, "Should have saved messages");
      assert.strictEqual(
        history[0].role,
        "user",
        "Should return chronological order (user first)",
      );
      assert.strictEqual(
        history[1].role,
        "assistant",
        "Should include assistant message",
      );
    });

    test("should maintain session isolation", async () => {
      // Create separate conversations with different session IDs
      const conversation1 = await Conversation.load("session-1", ":memory:");
      const conversation2 = await Conversation.load("session-2", ":memory:");

      await conversation1.addUserMessage("Message 1");
      await conversation2.addUserMessage("Message 2");

      const session1History = await conversation1.getMessages();
      const session2History = await conversation2.getMessages();

      assert.strictEqual(
        session1History.length,
        1,
        "Session 1 should have 1 message",
      );
      assert.strictEqual(
        session2History.length,
        1,
        "Session 2 should have 1 message",
      );
      assert.notStrictEqual(
        session1History[0].content,
        session2History[0].content,
        "Sessions should be isolated",
      );
    });
  });

  describe("Error Handling", () => {
    test("should handle tool execution errors gracefully", async () => {
      const lace = await harness.createTestLaceUI();

      try {
        await lace.agentCoordinator.primaryAgentInstance.toolExecutor.executeTool({
          name: "nonexistent_tool",
          input: {},
        }, "test-session");
        assert.fail("Should throw error for nonexistent tool");
      } catch (error) {
        assert.ok(
          error.message.includes("not found"),
          "Should provide meaningful error",
        );
      }
    });

    test("should handle file operation errors", async () => {
      const lace = await harness.createTestLaceUI();

      const result = await lace.agentCoordinator.primaryAgentInstance.toolExecutor.executeTool({
        name: "read_file",
        input: { path: "/nonexistent/file.txt" },
      }, "test-session");

      assert.ok(!result.success, "Should fail for nonexistent file");
      assert.ok(result.error, "Should provide error message");
    });
  });

  describe("Context Management", () => {
    test("should track context size and handoff conditions", async () => {
      const lace = await harness.createTestLaceUI();

      const agent = lace.agentCoordinator.primaryAgentInstance;

      assert.strictEqual(
        agent.contextSize,
        0,
        "Should start with zero context",
      );
      assert.ok(agent.maxContextSize > 0, "Should have context limit");
      assert.ok(!agent.shouldHandoff(), "Should not need handoff initially");

      // Simulate large context
      agent.contextSize = agent.maxContextSize * 0.9;
      assert.ok(agent.shouldHandoff(), "Should detect handoff need");
    });
  });
});
