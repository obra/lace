// ABOUTME: Integration tests for conversation memory functionality
// ABOUTME: Tests that agents remember previous messages within the same session using real database

import { test, describe, beforeEach, afterEach } from "@jest/globals";
import { TestHarness } from "@test/test-harness.js";
import { Conversation } from "../../../src/conversation/conversation.js";
import assert from "node:assert";

describe("Conversation Memory Integration", () => {
  let harness;

  beforeEach(async () => {
    harness = new TestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test("agent remembers previous message in same session", async () => {
    const agent = await harness.createTestAgent();
    
    // Override with mock that tracks what messages it receives
    const receivedMessages = [];
    agent.model.chat = async (messages, options) => {
      receivedMessages.push([...messages]); // Store copy of messages array
      
      // Return different responses based on whether history is present
      const hasConversationHistory = messages.length > 2; // more than system + current user message
      return {
        success: true,
        content: hasConversationHistory ? "I remember our conversation" : "First message",
        toolCalls: [],
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    };
    const sessionId = "test-session-123";
    const conversation = await Conversation.load(sessionId, ":memory:");

    // First message - should only have system prompt + user message
    const firstResponse = await agent.processInput(conversation, "Hello, my name is Jesse");
    assert.strictEqual(firstResponse.content, "First message");
    assert.strictEqual(receivedMessages[0].length, 2, "First call should have 2 messages (system + user)");

    // Second message - should include conversation history
    const secondResponse = await agent.processInput(conversation, "What is my name?");
    
    // This test currently FAILS because conversation history is not retrieved in generateResponse()
    // When step 1.2 is implemented, this should pass
    const secondCallMessages = receivedMessages[1];
    const hasHistory = secondCallMessages.length > 2;
    
    assert.ok(hasHistory, 
      `Second call should include conversation history. Got ${secondCallMessages.length} messages: ${JSON.stringify(secondCallMessages.map(m => ({
        role: m.role, 
        content: typeof m.content === 'string' ? m.content.substring(0, 50) : '[array]'
      })))}`);
    
    assert.strictEqual(secondResponse.content, "I remember our conversation", 
      "Agent should remember previous messages when history is provided");
  });

  test("agent uses accurate token counting instead of estimation", async () => {
    const agent = await harness.createTestAgent();
    const mockProvider = harness.createMockModelProvider();
    
    // Track token counting calls
    let tokenCountCalled = false;
    let countTokensParams = null;
    
    mockProvider.countTokens = async (messages, options) => {
      tokenCountCalled = true;
      countTokensParams = { messages, options };
      return {
        success: true,
        inputTokens: 150,
        totalTokens: 150,
      };
    };
    
    agent.modelProvider = mockProvider;
    const sessionId = "test-session-456";

    // Process input should trigger token counting
    const conversation = await Conversation.load(sessionId, ":memory:");
    const response = await agent.processInput(conversation, "Count my tokens");
    
    // Verify token counting was called
    assert.ok(tokenCountCalled, "countTokens should be called for accurate counting");
    assert.ok(countTokensParams, "countTokens should receive parameters");
    assert.ok(countTokensParams.messages.length > 0, "countTokens should receive messages");
    assert.strictEqual(countTokensParams.options.model, agent.model.definition.name, "Should use agent's assigned model");
    
    // Verify context size is updated with accurate count
    assert.strictEqual(agent.contextSize, 150, "Agent context size should use accurate token count");
  });

  test("agent truncates long conversations to stay within token limits", async () => {
    const agent = await harness.createTestAgent();
    const mockProvider = harness.createMockModelProvider();
    
    // Track truncation calls
    let truncationCalls = [];
    
    mockProvider.countTokens = async (messages, options) => {
      const tokenCount = messages.length * 50; // Mock: 50 tokens per message
      truncationCalls.push({ messageCount: messages.length, tokenCount });
      
      return {
        success: true,
        inputTokens: tokenCount,
        totalTokens: tokenCount,
      };
    };
    
    agent.modelProvider = mockProvider;
    agent.maxContextSize = 1000; // Small context window for testing
    const sessionId = "test-session-truncation";
    const conversation = await Conversation.load(sessionId, ":memory:");

    // Simulate a long conversation by adding multiple messages to the conversation
    for (let i = 0; i < 15; i++) {
      await conversation.addUserMessage(`Message ${i}`);
      await conversation.addAssistantMessage(`Response ${i}`);
    }

    // Process a new input - should trigger truncation
    const response = await agent.processInput(conversation, "This should trigger truncation");
    
    // Verify truncation was called and messages were reduced
    assert.ok(truncationCalls.length > 0, "Token counting should be called during truncation");
    
    // The final token count should be within limits (70% of 1000 = 700)
    const finalCall = truncationCalls[truncationCalls.length - 1];
    assert.ok(finalCall.tokenCount <= 700, 
      `Final token count (${finalCall.tokenCount}) should be within 70% limit (700)`);
    
    // Should have fewer messages than the full conversation
    assert.ok(finalCall.messageCount < 32, // 15*2 + system + user = 32 total
      `Should truncate to fewer than 32 messages, got ${finalCall.messageCount}`);
  });


  test("agent tracks conversation metrics correctly", async () => {
    const agent = await harness.createTestAgent();
    
    agent.model.chat = async (messages, options) => {
      return {
        success: true,
        content: "Test response",
        toolCalls: [],
        usage: { 
          input_tokens: 50, 
          output_tokens: 20, 
          total_tokens: 70,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5
        },
      };
    };

    agent.model.countTokens = async (messages, options) => {
      return {
        success: true,
        inputTokens: 50,
        totalTokens: 50,
      };
    };
    const sessionId = "test-session-metrics";
    const conversation = await Conversation.load(sessionId, ":memory:");

    // Process two messages
    await agent.processInput(conversation, "First message");
    await agent.processInput(conversation, "Second message");
    
    // Check conversation metrics
    const metrics = agent.getConversationMetrics();
    
    assert.strictEqual(metrics.totalMessages, 2, "Should track message count");
    assert.strictEqual(metrics.totalTokensUsed, 140, "Should track total tokens used (70 * 2)");
    assert.strictEqual(metrics.cacheHits, 10, "Should track cache hits (5 * 2)");
    assert.strictEqual(metrics.cacheCreations, 20, "Should track cache creations (10 * 2)");
    assert.strictEqual(metrics.cacheHitRate, "33.3%", "Should calculate cache hit rate");
    assert.ok(metrics.sessionUptime >= 0, "Should track session uptime");
    assert.ok(metrics.lastActivity > 0, "Should track last activity");
  });

});
