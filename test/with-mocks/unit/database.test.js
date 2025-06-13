// ABOUTME: Unit tests for conversation database
// ABOUTME: Tests SQLite persistence, conversation history, and session management

import {
  test,
  describe,
  beforeEach,
  afterEach,
  TestHarness,
  assert,
} from "../../test-harness.js";

describe("Conversation Database", () => {
  let harness;

  beforeEach(async () => {
    harness = new TestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  describe("Database Initialization", () => {
    test("should initialize database and create tables", async () => {
      const { ConversationDB } = await import(
        "../../../src/database/conversation-db.js"
      );

      const db = new ConversationDB(":memory:");
      await db.initialize();

      // Test that database is working by attempting a simple operation
      await db.saveMessage("test-session", 0, "user", "test message");

      const history = await db.getConversationHistory("test-session");
      assert.strictEqual(history.length, 1, "Should save and retrieve message");

      await db.close();
    });

    test("should handle database path creation", async () => {
      const { ConversationDB } = await import(
        "../../../src/database/conversation-db.js"
      );

      const testPath = ":memory:";
      const db = new ConversationDB(testPath);

      assert.strictEqual(db.path, testPath, "Should store correct database path");

      await db.initialize();
      await db.close();
    });
  });

  describe("Message Storage", () => {
    test("should save and retrieve messages", async () => {
      const { ConversationDB } = await import(
        "../../../src/database/conversation-db.js"
      );

      const db = new ConversationDB(":memory:");
      await db.initialize();

      const sessionId = "test-session-001";
      const generation = 0;

      await db.saveMessage(sessionId, generation, "user", "Hello world");
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 100));
      await db.saveMessage(sessionId, generation, "assistant", "Hi there!");

      const history = await db.getConversationHistory(sessionId);

      // Debug: log the actual order and timestamps
      console.log(
        "Messages in order:",
        history.map((h) => ({ role: h.role, timestamp: h.timestamp })),
      );

      assert.strictEqual(history.length, 2, "Should have saved both messages");
      assert.strictEqual(
        history[0].role,
        "user",
        "Should return messages in chronological order (oldest first)",
      );
      assert.strictEqual(
        history[1].role,
        "assistant",
        "Should include assistant message",
      );
      assert.strictEqual(
        history[0].content,
        "Hello world",
        "Should preserve user message content",
      );

      await db.close();
    });

    test("should save tool calls with messages", async () => {
      const { ConversationDB } = await import(
        "../../../src/database/conversation-db.js"
      );

      const db = new ConversationDB(":memory:");
      await db.initialize();

      const toolCalls = [{ name: "file_read", input: { path: "test.txt" } }];

      await db.saveMessage(
        "test-session",
        0,
        "assistant",
        "Reading file...",
        toolCalls,
        1500,
      );

      const history = await db.getConversationHistory("test-session");
      const message = history[0];

      assert.strictEqual(
        message.context_size,
        1500,
        "Should save context size",
      );

      const savedToolCalls = JSON.parse(message.tool_calls);
      assert.ok(
        Array.isArray(savedToolCalls),
        "Should parse tool calls as array",
      );
      assert.strictEqual(
        savedToolCalls[0].name,
        "file_read",
        "Should preserve tool call data",
      );

      await db.close();
    });
  });

  describe("Session Management", () => {
    test("should isolate conversations by session", async () => {
      const { ConversationDB } = await import(
        "../../../src/database/conversation-db.js"
      );

      const db = new ConversationDB(":memory:");
      await db.initialize();

      await db.saveMessage("session-1", 0, "user", "Message in session 1");
      await db.saveMessage("session-2", 0, "user", "Message in session 2");

      const session1History = await db.getConversationHistory("session-1");
      const session2History = await db.getConversationHistory("session-2");

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
      assert.strictEqual(
        session1History[0].content,
        "Message in session 1",
        "Should have correct content",
      );
      assert.strictEqual(
        session2History[0].content,
        "Message in session 2",
        "Should have correct content",
      );

      await db.close();
    });

    test("should limit conversation history retrieval", async () => {
      const { ConversationDB } = await import(
        "../../../src/database/conversation-db.js"
      );

      const db = new ConversationDB(":memory:");
      await db.initialize();

      const sessionId = "test-session";

      // Save 10 messages
      for (let i = 0; i < 10; i++) {
        await db.saveMessage(sessionId, 0, "user", `Message ${i}`);
      }

      const limitedHistory = await db.getConversationHistory(sessionId, 5);
      const fullHistory = await db.getConversationHistory(sessionId, 100);

      assert.strictEqual(
        limitedHistory.length,
        5,
        "Should limit to requested number",
      );
      assert.strictEqual(
        fullHistory.length,
        10,
        "Should return all messages when limit is high",
      );

      await db.close();
    });
  });

  describe("Search Functionality", () => {
    test("should search conversation content", async () => {
      const { ConversationDB } = await import(
        "../../../src/database/conversation-db.js"
      );

      const db = new ConversationDB(":memory:");
      await db.initialize();

      const sessionId = "search-test";

      await db.saveMessage(
        sessionId,
        0,
        "user",
        "How do I calculate fibonacci?",
      );
      await db.saveMessage(
        sessionId,
        0,
        "assistant",
        "You can use recursion or iteration",
      );
      await db.saveMessage(sessionId, 0, "user", "What about prime numbers?");

      const fibResults = await db.searchConversations(sessionId, "fibonacci");
      const primeResults = await db.searchConversations(sessionId, "prime");

      assert.strictEqual(fibResults.length, 1, "Should find fibonacci message");
      assert.ok(
        fibResults[0].content.includes("fibonacci"),
        "Should match search term",
      );

      assert.strictEqual(primeResults.length, 1, "Should find prime message");
      assert.ok(
        primeResults[0].content.includes("prime"),
        "Should match search term",
      );

      await db.close();
    });
  });

  describe("Generation Tracking", () => {
    test("should track agent generations", async () => {
      const { ConversationDB } = await import(
        "../../../src/database/conversation-db.js"
      );

      const db = new ConversationDB(":memory:");
      await db.initialize();

      const sessionId = "generation-test";

      await db.saveMessage(sessionId, 0, "user", "Generation 0 message");
      await db.saveMessage(sessionId, 1, "user", "Generation 1 message");

      const gen0History = await db.getGenerationHistory(sessionId, 0);
      const gen1History = await db.getGenerationHistory(sessionId, 1);

      assert.strictEqual(
        gen0History.length,
        1,
        "Should have generation 0 message",
      );
      assert.strictEqual(
        gen1History.length,
        1,
        "Should have generation 1 message",
      );
      assert.strictEqual(
        gen0History[0].generation,
        0,
        "Should have correct generation",
      );
      assert.strictEqual(
        gen1History[0].generation,
        1,
        "Should have correct generation",
      );

      await db.close();
    });

    test("should save handoff information", async () => {
      const { ConversationDB } = await import(
        "../../../src/database/conversation-db.js"
      );

      const db = new ConversationDB(":memory:");
      await db.initialize();

      const sessionId = "handoff-test";
      const compressedContext = "Previous conversation summary";
      const reason = "Context limit reached";

      await db.saveHandoff(sessionId, 0, compressedContext, reason);

      // Note: We'd need to add a method to retrieve handoff data to fully test this
      // For now, just verify no errors occur
      assert.ok(true, "Should save handoff information without errors");

      await db.close();
    });
  });

  describe("Error Handling", () => {
    test("should handle database connection errors gracefully", async () => {
      const { ConversationDB } = await import(
        "../../../src/database/conversation-db.js"
      );

      // Try to initialize with invalid path
      const db = new ConversationDB("/invalid/path/database.db");

      try {
        await db.initialize();
        assert.fail("Should throw error for invalid path");
      } catch (error) {
        assert.ok(error.message, "Should provide error message");
      }
    });
  });
});
