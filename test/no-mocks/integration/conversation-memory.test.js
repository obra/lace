// ABOUTME: Integration tests for conversation memory functionality
// ABOUTME: Tests that agents remember previous messages within the same session using real database

import { test, describe, beforeEach, afterEach } from "@jest/globals";
import { TestHarness } from "@test/test-harness.js";
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
    const mockProvider = harness.createMockModelProvider();
    
    // Override with mock that tracks what messages it receives
    const receivedMessages = [];
    mockProvider.chat = async (messages, options) => {
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
    
    agent.modelProvider = mockProvider;
    const sessionId = "test-session-123";

    // First message - should only have system prompt + user message
    const firstResponse = await agent.processInput(sessionId, "Hello, my name is Jesse");
    assert.strictEqual(firstResponse.content, "First message");
    assert.strictEqual(receivedMessages[0].length, 2, "First call should have 2 messages (system + user)");

    // Second message - should include conversation history
    const secondResponse = await agent.processInput(sessionId, "What is my name?");
    
    // This test currently FAILS because conversation history is not retrieved in generateResponse()
    // When step 1.2 is implemented, this should pass
    const secondCallMessages = receivedMessages[1];
    const hasHistory = secondCallMessages.length > 2;
    
    assert.ok(hasHistory, 
      `Second call should include conversation history. Got ${secondCallMessages.length} messages: ${JSON.stringify(secondCallMessages.map(m => ({role: m.role, content: m.content?.substring(0, 50)})))}`);
    
    assert.strictEqual(secondResponse.content, "I remember our conversation", 
      "Agent should remember previous messages when history is provided");
  });
});