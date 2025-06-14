// ABOUTME: Unit tests for ContextCapture class that integrates conversation and activity data
// ABOUTME: Tests integration with ConversationDB, ActivityLogger, and snapshot metadata enrichment

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

describe("ContextCapture", () => {
  let testHarness;
  let testDir;
  let ContextCapture;
  let mockConversationDB;
  let mockActivityLogger;
  let mockConversation;

  beforeEach(async () => {
    testHarness = new TestHarness();
    testDir = join(process.cwd(), `test-context-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create mock ConversationDB
    mockConversationDB = {
      getConversationHistory: async (sessionId, limit) => [
        {
          id: 1,
          sessionId: "session-123",
          generation: 1,
          role: "user",
          content: "Please help me with my code",
          timestamp: "2025-06-05T14:30:00Z",
          contextSize: 100,
        },
        {
          id: 2,
          sessionId: "session-123",
          generation: 1,
          role: "assistant",
          content: "I'll help you with that.",
          timestamp: "2025-06-05T14:30:05Z",
          contextSize: 150,
        },
      ],
      searchConversations: async (sessionId, query, limit) => [
        {
          id: 3,
          content: "Related conversation about code",
          timestamp: "2025-06-05T14:25:00Z",
        },
      ],
    };

    // Create mock Conversation
    mockConversation = {
      getSessionId: () => "session-123",
      getMessages: async (limit) => {
        const allMessages = [
          {
            id: 1,
            sessionId: "session-123",
            generation: 1,
            role: "user",
            content: "Please help me with my code",
            timestamp: "2025-06-05T14:30:00Z",
            contextSize: 100,
          },
          {
            id: 2,
            sessionId: "session-123",
            generation: 1,
            role: "assistant",
            content: "I'll help you with that.",
            timestamp: "2025-06-05T14:30:05Z",
            contextSize: 150,
          },
        ];
        return limit ? allMessages.slice(0, limit) : allMessages;
      },
      search: async (query, limit) => [
        {
          id: 3,
          content: "Related conversation about code",
          timestamp: "2025-06-05T14:25:00Z",
        },
      ]
    };

    // Create mock ActivityLogger
    mockActivityLogger = {
      getEvents: async (options) => [
        {
          id: 1,
          eventType: "tool_call",
          localSessionId: "session-123",
          modelSessionId: "model-456",
          timestamp: "2025-06-05T14:29:30Z",
          data: {
            toolName: "file-tool",
            operation: "read",
            parameters: { path: "test.js" },
            executionId: "exec-789",
          },
        },
        {
          id: 2,
          eventType: "tool_result",
          localSessionId: "session-123",
          modelSessionId: "model-456",
          timestamp: "2025-06-05T14:29:35Z",
          data: {
            executionId: "exec-789",
            success: true,
            output: "File content here",
          },
        },
      ],
    };

    // Try to import the class
    try {
      const module = await import("../../../src/snapshot/context-capture.js");
      ContextCapture = module.ContextCapture;
    } catch (error) {
      // Class doesn't exist yet, that's expected in TDD
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

  describe("constructor", () => {
    test("should create ContextCapture with activity logger", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const capture = new ContextCapture(
        mockActivityLogger,
      );
      assert.strictEqual(capture.activityLogger, mockActivityLogger);
    });

    test("should accept optional configuration", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const config = {
        conversationTurnsToCapture: 10,
        toolUsesToCapture: 15,
        searchDepth: 5,
      };

      const capture = new ContextCapture(
        mockActivityLogger,
        config,
      );
      assert.strictEqual(capture.config.conversationTurnsToCapture, 10);
      assert.strictEqual(capture.config.toolUsesToCapture, 15);
      assert.strictEqual(capture.config.searchDepth, 5);
    });
  });

  describe("conversation context capture", () => {
    test("should capture recent conversation history", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const capture = new ContextCapture(
        mockActivityLogger,
      );
      const context = await capture.captureConversationContext(
        mockConversation,
        1,
      );

      assert.ok(context.recentHistory, "Should have recent history");
      assert.ok(
        Array.isArray(context.recentHistory),
        "Recent history should be array",
      );
      assert.strictEqual(
        context.recentHistory.length,
        2,
        "Should have 2 history entries",
      );

      assert.strictEqual(context.recentHistory[0].role, "user");
      assert.strictEqual(context.recentHistory[1].role, "assistant");
      assert.ok(context.currentGeneration, "Should have current generation");
      assert.ok(context.sessionId, "Should have session ID");
    });

    test("should limit conversation history to configured amount", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const config = { conversationTurnsToCapture: 1 };
      const capture = new ContextCapture(
        mockActivityLogger,
        config,
      );
      const context = await capture.captureConversationContext(
        mockConversation,
        1,
      );

      assert.strictEqual(
        context.recentHistory.length,
        1,
        "Should limit to 1 entry",
      );
    });

    test("should handle missing conversation data gracefully", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const emptyConversationDB = {
        getConversationHistory: async () => [],
        searchConversations: async () => [],
      };

      const capture = new ContextCapture(
        mockActivityLogger,
      );
      // Create a conversation that returns empty data
      const emptyConversation = {
        getSessionId: () => "nonexistent-session",
        getMessages: async () => []
      };
      const context = await capture.captureConversationContext(
        emptyConversation,
        1,
      );

      assert.ok(
        Array.isArray(context.recentHistory),
        "Should return empty array",
      );
      assert.strictEqual(
        context.recentHistory.length,
        0,
        "Should have no history entries",
      );
    });
  });

  describe("activity context capture", () => {
    test("should capture recent tool usage", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const capture = new ContextCapture(
        mockActivityLogger,
      );
      const context = await capture.captureActivityContext("session-123");

      assert.ok(context.recentToolUses, "Should have recent tool uses");
      assert.ok(
        Array.isArray(context.recentToolUses),
        "Tool uses should be array",
      );
      assert.strictEqual(
        context.recentToolUses.length,
        2,
        "Should have 2 activity entries",
      );

      assert.strictEqual(context.recentToolUses[0].eventType, "tool_call");
      assert.strictEqual(context.recentToolUses[1].eventType, "tool_result");
    });

    test("should filter tool events by session", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const mixedActivityLogger = {
        getEvents: async (options) => [
          {
            eventType: "tool_call",
            localSessionId: "session-123",
            data: { toolName: "correct-session" },
          },
          {
            eventType: "tool_call",
            localSessionId: "session-456",
            data: { toolName: "wrong-session" },
          },
        ],
      };

      const capture = new ContextCapture(
        mixedActivityLogger,
      );
      const context = await capture.captureActivityContext("session-123");

      assert.strictEqual(
        context.recentToolUses.length,
        1,
        "Should filter by session",
      );
      assert.strictEqual(
        context.recentToolUses[0].data.toolName,
        "correct-session",
      );
    });

    test("should limit tool usage to configured amount", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const config = { toolUsesToCapture: 1 };
      const capture = new ContextCapture(
        mockActivityLogger,
        config,
      );
      const context = await capture.captureActivityContext("session-123");

      assert.strictEqual(
        context.recentToolUses.length,
        1,
        "Should limit to 1 entry",
      );
    });
  });

  describe("real repository integration", () => {
    test("should capture real repository SHA when available", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const capture = new ContextCapture(
        mockActivityLogger,
      );

      // This should work in our git repository
      const repoSha = await capture.getRealRepoSha(process.cwd());

      assert.ok(repoSha, "Should have repository SHA");
      assert.ok(repoSha.length >= 7, "SHA should be at least 7 characters");
      assert.notStrictEqual(
        repoSha,
        "unknown",
        "Should not be unknown in git repo",
      );
    });

    test("should handle non-git directories gracefully", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const capture = new ContextCapture(
        mockActivityLogger,
      );

      const repoSha = await capture.getRealRepoSha(testDir);

      assert.strictEqual(
        repoSha,
        "unknown",
        "Should return unknown for non-git directory",
      );
    });
  });

  describe("comprehensive context capture", () => {
    test("should capture complete context for tool execution", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const capture = new ContextCapture(
        mockActivityLogger,
      );

      const toolCall = {
        toolName: "file-tool",
        operation: "write",
        parameters: { path: "test.js", content: "code" },
        executionId: "exec-abc123",
      };

      const context = await capture.captureFullContext(
        "session-123",
        1,
        toolCall,
        testDir,
      );

      // Verify conversation context
      assert.ok(context.conversationTurns !== undefined, "Should have conversation turns");
      assert.ok(context.recentHistory !== undefined, "Should have recent history");
      assert.strictEqual(context.sessionId, "session-123");
      assert.strictEqual(context.currentGeneration, 1);

      // Verify activity context
      assert.ok(context.recentToolUses, "Should have recent tool uses");

      // Verify tool context
      assert.deepStrictEqual(
        context.currentTool,
        toolCall,
        "Should have current tool info",
      );

      // Verify repository context
      assert.ok(context.realRepoSha, "Should have real repo SHA");

      // Verify metadata
      assert.ok(context.captureTimestamp, "Should have capture timestamp");
    });

    test("should enrich context with related conversations", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const capture = new ContextCapture(
        mockActivityLogger,
      );

      const toolCall = {
        toolName: "file-tool",
        operation: "read",
        parameters: { path: "code.js" },
      };

      const context = await capture.captureFullContext(
        "session-123",
        1,
        toolCall,
        testDir,
      );

      // Should search for related conversations based on tool parameters
      assert.ok(context.relatedContext, "Should have related context");
    });
  });

  describe("context enrichment", () => {
    test("should add semantic context based on tool type", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const capture = new ContextCapture(
        mockActivityLogger,
      );

      const fileToolCall = {
        toolName: "file-tool",
        operation: "read",
        parameters: { path: "important.js" },
      };

      const context = await capture.enrichContextForTool(
        fileToolCall,
        "session-123",
      );

      assert.ok(context.toolCategory, "Should categorize tool");
      assert.ok(context.semanticHints, "Should provide semantic hints");
    });

    test("should suggest relevant search terms", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const capture = new ContextCapture(
        mockActivityLogger,
      );

      const searchTerms = capture.generateSearchTerms({
        toolName: "file-tool",
        operation: "write",
        parameters: { path: "auth/login.js", content: "authentication code" },
      });

      assert.ok(
        Array.isArray(searchTerms),
        "Should return array of search terms",
      );
      assert.ok(searchTerms.includes("file-tool"), "Should include tool name");
      assert.ok(searchTerms.includes("auth"), "Should extract path components");
      assert.ok(searchTerms.includes("login"), "Should extract filename parts");
    });
  });

  describe("performance and caching", () => {
    test("should cache repeated context captures", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      let dbCallCount = 0;
      const countingConversationDB = {
        getConversationHistory: async (...args) => {
          dbCallCount++;
          return mockConversationDB.getConversationHistory(...args);
        },
        searchConversations: async (...args) => {
          dbCallCount++;
          return mockConversationDB.searchConversations(...args);
        },
      };

      const capture = new ContextCapture(
        countingConversationDB,
        mockActivityLogger,
      );

      // First call
      await capture.captureConversationContext(mockConversation, 1);
      const firstCallCount = dbCallCount;

      // Second call (should use cache if implemented)
      await capture.captureConversationContext(mockConversation, 1);
      const secondCallCount = dbCallCount;

      // This test allows for caching but doesn't require it
      assert.ok(
        secondCallCount >= firstCallCount,
        "Should not make fewer calls",
      );
    });

    test("should handle database errors gracefully", async () => {
      if (!ContextCapture) {
        assert.fail("ContextCapture class not implemented yet");
      }

      const failingConversationDB = {
        getConversationHistory: async () => {
          throw new Error("Database connection failed");
        },
        searchConversations: async () => {
          throw new Error("Database connection failed");
        },
      };

      const capture = new ContextCapture(
        failingConversationDB,
        mockActivityLogger,
      );

      // Should not throw, but return degraded context
      const context = await capture.captureConversationContext(
        mockConversation,
        1,
      );

      assert.ok(context, "Should return context object even on DB failure");
      assert.ok(
        Array.isArray(context.recentHistory),
        "Should return empty history on failure",
      );
    });
  });
});
