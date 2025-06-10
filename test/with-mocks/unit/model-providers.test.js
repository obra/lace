// ABOUTME: Unit tests for model provider session ID tracking functionality
// ABOUTME: Tests conversation ID generation, session tracking, and UUID creation

import { test, describe } from "@jest/globals";
import assert from "node:assert";
import { AnthropicProvider } from "../../../src/models/providers/anthropic-provider.js";
import { OpenAIProvider } from "../../../src/models/providers/openai-provider.js";
import { LocalProvider } from "../../../src/models/providers/local-provider.js";

describe("Model Provider Session ID Tracking", () => {
  describe("AnthropicProvider", () => {
    describe("Session ID Generation", () => {
      test("should generate UUID when no conversation ID provided", () => {
        const provider = new AnthropicProvider();
        const messages = [{ role: "user", content: "test message" }];

        const sessionId1 = provider.getOrCreateSessionId(null, messages);
        const sessionId2 = provider.getOrCreateSessionId(null, messages);

        // Should be valid UUIDs
        assert.match(
          sessionId1,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );

        // Same conversation should return same session ID
        assert.strictEqual(sessionId1, sessionId2);
      });

      test("should use provided conversation ID when available", () => {
        const provider = new AnthropicProvider();
        const messages = [{ role: "user", content: "test message" }];
        const providedId = "custom-conversation-123";

        const sessionId = provider.getOrCreateSessionId(providedId, messages);

        assert.strictEqual(sessionId, providedId);
      });

      test("should generate different session IDs for different conversations", () => {
        const provider = new AnthropicProvider();
        const messages1 = [{ role: "user", content: "first conversation" }];
        const messages2 = [{ role: "user", content: "second conversation" }];

        const sessionId1 = provider.getOrCreateSessionId(null, messages1);
        const sessionId2 = provider.getOrCreateSessionId(null, messages2);

        assert.notStrictEqual(sessionId1, sessionId2);
      });

      test("should handle messages without user role", () => {
        const provider = new AnthropicProvider();
        const messages = [{ role: "system", content: "system message only" }];

        const sessionId = provider.getOrCreateSessionId(null, messages);

        // Should still generate a valid UUID
        assert.match(
          sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });
    });

    describe("Conversation Key Generation", () => {
      test("should generate consistent keys for same first user message", () => {
        const provider = new AnthropicProvider();
        const messages = [
          { role: "system", content: "system prompt" },
          { role: "user", content: "hello world" },
        ];

        const key1 = provider.generateConversationKey(messages);
        const key2 = provider.generateConversationKey(messages);

        assert.strictEqual(key1, key2);
        assert.strictEqual(key1, "conv_hello_world");
      });

      test("should truncate long user messages in key", () => {
        const provider = new AnthropicProvider();
        const longMessage = "a".repeat(100);
        const messages = [{ role: "user", content: longMessage }];

        const key = provider.generateConversationKey(messages);

        assert.ok(key.length <= 55); // 'conv_' + 50 chars
        assert.ok(key.startsWith("conv_"));
      });

      test("should replace spaces with underscores in key", () => {
        const provider = new AnthropicProvider();
        const messages = [
          { role: "user", content: "hello world test message" },
        ];

        const key = provider.generateConversationKey(messages);

        assert.strictEqual(key, "conv_hello_world_test_message");
      });

      test("should fallback to timestamp-based key when no user message", () => {
        const provider = new AnthropicProvider();
        const messages = [{ role: "system", content: "system only" }];

        const key = provider.generateConversationKey(messages);

        assert.ok(key.startsWith("conv_"));
        assert.match(key, /^conv_\d+$/);
      });
    });

    describe("Session Tracking", () => {
      test("should maintain separate session maps per provider instance", () => {
        const provider1 = new AnthropicProvider();
        const provider2 = new AnthropicProvider();
        const messages = [{ role: "user", content: "test" }];

        const session1 = provider1.getOrCreateSessionId(null, messages);
        const session2 = provider2.getOrCreateSessionId(null, messages);

        // Different provider instances should generate different session IDs
        assert.notStrictEqual(session1, session2);
      });

      test("should track multiple conversations in same provider", () => {
        const provider = new AnthropicProvider();

        const session1 = provider.getOrCreateSessionId(null, [
          { role: "user", content: "first" },
        ]);
        const session2 = provider.getOrCreateSessionId(null, [
          { role: "user", content: "second" },
        ]);
        const session3 = provider.getOrCreateSessionId(null, [
          { role: "user", content: "first" },
        ]); // Same as first

        assert.notStrictEqual(session1, session2);
        assert.strictEqual(session1, session3); // Should reuse session for same conversation
      });
    });

    describe("Token Counting", () => {
      test("should have countTokens method", () => {
        const provider = new AnthropicProvider();
        assert.strictEqual(typeof provider.countTokens, "function");
      });

      test("should return proper structure from countTokens with mock", async () => {
        const provider = new AnthropicProvider();
        
        // Mock the client to avoid actual API calls
        provider.client = {
          beta: {
            messages: {
              countTokens: async (params) => ({
                input_tokens: 42,
              }),
            },
          },
        };

        const messages = [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello, how are you?" },
        ];

        const result = await provider.countTokens(messages);

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.inputTokens, 42);
        assert.strictEqual(result.totalTokens, 42);
        assert.ok(!result.error);
      });

      test("should handle countTokens errors gracefully", async () => {
        const provider = new AnthropicProvider();
        
        // Mock the client to simulate an error
        provider.client = {
          beta: {
            messages: {
              countTokens: async () => {
                throw new Error("API error");
              },
            },
          },
        };

        const messages = [{ role: "user", content: "test" }];
        const result = await provider.countTokens(messages);

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, "API error");
        assert.strictEqual(result.inputTokens, 0);
        assert.strictEqual(result.totalTokens, 0);
      });

      test("should pass correct parameters to countTokens API", async () => {
        const provider = new AnthropicProvider();
        let capturedParams = null;
        
        // Mock the client to capture parameters
        provider.client = {
          beta: {
            messages: {
              countTokens: async (params) => {
                capturedParams = params;
                return { input_tokens: 10 };
              },
            },
          },
        };

        const messages = [
          { role: "system", content: "System prompt" },
          { role: "user", content: "User message" },
        ];
        const tools = [{ name: "test_tool", description: "Test tool" }];

        await provider.countTokens(messages, { 
          model: "claude-3-5-haiku-20241022", 
          tools 
        });

        assert.strictEqual(capturedParams.betas[0], "token-counting-2024-11-01");
        assert.strictEqual(capturedParams.model, "claude-3-5-haiku-20241022");
        assert.strictEqual(capturedParams.system, "System prompt");
        assert.strictEqual(capturedParams.messages.length, 1);
        assert.strictEqual(capturedParams.messages[0].content, "User message");
        assert.ok(capturedParams.tools);
      });
    });

    describe("Prompt Caching", () => {
      test("should add cache control to system prompts when caching enabled", async () => {
        const provider = new AnthropicProvider();
        let capturedParams = null;
        
        // Mock the client to capture parameters
        provider.client = {
          messages: {
            create: async (params) => {
              capturedParams = params;
              return { 
                content: [{ text: "response" }],
                usage: { input_tokens: 10, output_tokens: 5 }
              };
            },
          },
        };

        const messages = [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello" },
        ];

        await provider.chat(messages, { enableCaching: true });

        // Verify cache control was added
        assert.ok(capturedParams.extra_headers, "Should include extra headers for caching");
        assert.strictEqual(
          capturedParams.extra_headers["anthropic-beta"], 
          "prompt-caching-2024-07-31",
          "Should include prompt caching beta header"
        );
        
        // Verify system message formatting
        assert.ok(Array.isArray(capturedParams.system), "System should be formatted as array for caching");
        assert.strictEqual(capturedParams.system[0].type, "text");
        assert.strictEqual(capturedParams.system[0].text, "You are a helpful assistant.");
        assert.deepStrictEqual(capturedParams.system[0].cache_control, { type: "ephemeral" });
      });

      test("should not add cache control when caching disabled", async () => {
        const provider = new AnthropicProvider();
        let capturedParams = null;
        
        // Mock the client to capture parameters
        provider.client = {
          messages: {
            create: async (params) => {
              capturedParams = params;
              return { 
                content: [{ text: "response" }],
                usage: { input_tokens: 10, output_tokens: 5 }
              };
            },
          },
        };

        const messages = [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello" },
        ];

        await provider.chat(messages, { enableCaching: false });

        // Verify no cache control
        assert.ok(!capturedParams.extra_headers, "Should not include extra headers when caching disabled");
        assert.strictEqual(typeof capturedParams.system, "string", "System should be string when caching disabled");
        assert.strictEqual(capturedParams.system, "You are a helpful assistant.");
      });

      test("should include caching beta in countTokens when enabled", async () => {
        const provider = new AnthropicProvider();
        let capturedParams = null;
        
        // Mock the client for token counting
        provider.client = {
          beta: {
            messages: {
              countTokens: async (params) => {
                capturedParams = params;
                return { input_tokens: 42 };
              },
            },
          },
        };

        const messages = [
          { role: "system", content: "System prompt" },
          { role: "user", content: "User message" },
        ];

        await provider.countTokens(messages, { enableCaching: true });

        assert.ok(capturedParams.betas.includes("prompt-caching-2024-07-31"), 
          "Should include prompt caching beta in token counting");
        assert.ok(Array.isArray(capturedParams.system), "System should be array for caching");
        assert.deepStrictEqual(capturedParams.system[0].cache_control, { type: "ephemeral" });
      });
    });

    describe("Enhanced Streaming", () => {
      test("should handle thinking content blocks in streaming", async () => {
        const provider = new AnthropicProvider();
        const streamEvents = [];
        
        // Mock the stream with thinking events
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
            yield { type: "content_block_start", index: 0, content_block: { type: "thinking" } };
            yield { type: "content_block_delta", delta: { type: "thinking_delta", text: "Let me think..." } };
            yield { type: "content_block_stop", index: 0 };
            yield { type: "content_block_start", index: 1, content_block: { type: "text" } };
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "Here's my response" } };
            yield { type: "content_block_stop", index: 1 };
            yield { type: "message_stop", usage: { output_tokens: 5 } };
          }
        };
        
        const onTokenUpdate = (data) => streamEvents.push(data);
        const result = await provider.handleStreamResponse(mockStream, onTokenUpdate);
        
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.content, "Here's my response");
        
        // Check for thinking events
        const thinkingStartEvents = streamEvents.filter(e => e.thinkingStart);
        const thinkingTokenEvents = streamEvents.filter(e => e.thinkingToken);
        
        assert.strictEqual(thinkingStartEvents.length, 1, "Should have one thinking start event");
        assert.strictEqual(thinkingTokenEvents.length, 1, "Should have one thinking token event");
        assert.strictEqual(thinkingTokenEvents[0].thinkingToken, "Let me think...");
      });

      test("should handle enhanced tool use streaming events", async () => {
        const provider = new AnthropicProvider();
        const streamEvents = [];
        
        // Mock the stream with tool use events
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
            yield { 
              type: "content_block_start", 
              index: 0, 
              content_block: { type: "tool_use", id: "tool_123", name: "test_tool" } 
            };
            yield { 
              type: "content_block_delta", 
              delta: { type: "input_json_delta", partial_json: '{"param": "' } 
            };
            yield { 
              type: "content_block_delta", 
              delta: { type: "input_json_delta", partial_json: 'value"}' } 
            };
            yield { type: "content_block_stop", index: 0 };
            yield { type: "message_stop", usage: { output_tokens: 5 } };
          }
        };
        
        const onTokenUpdate = (data) => streamEvents.push(data);
        const result = await provider.handleStreamResponse(mockStream, onTokenUpdate);
        
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.toolCalls.length, 1);
        assert.strictEqual(result.toolCalls[0].name, "test_tool");
        assert.deepStrictEqual(result.toolCalls[0].input, { param: "value" });
        
        // Check for tool events
        const toolStartEvents = streamEvents.filter(e => e.toolUseStart);
        const toolInputEvents = streamEvents.filter(e => e.toolInputDelta);
        const toolCompleteEvents = streamEvents.filter(e => e.toolUseComplete);
        
        assert.strictEqual(toolStartEvents.length, 1, "Should have one tool start event");
        assert.strictEqual(toolInputEvents.length, 2, "Should have two tool input delta events");
        assert.strictEqual(toolCompleteEvents.length, 1, "Should have one tool complete event");
        
        assert.strictEqual(toolStartEvents[0].toolUseStart.name, "test_tool");
        assert.strictEqual(toolCompleteEvents[0].toolUseComplete.name, "test_tool");
      });

      test("should forward regular text tokens", async () => {
        const provider = new AnthropicProvider();
        const streamEvents = [];
        
        // Mock the stream with regular text
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
            yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } };
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "world!" } };
            yield { type: "content_block_stop", index: 0 };
            yield { type: "message_stop", usage: { output_tokens: 5 } };
          }
        };
        
        const onTokenUpdate = (data) => streamEvents.push(data);
        const result = await provider.handleStreamResponse(mockStream, onTokenUpdate);
        
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.content, "Hello world!");
        
        // Check for text token events
        const textTokenEvents = streamEvents.filter(e => e.token);
        assert.strictEqual(textTokenEvents.length, 2, "Should have two text token events");
        assert.strictEqual(textTokenEvents[0].token, "Hello ");
        assert.strictEqual(textTokenEvents[1].token, "world!");
      });
    });
  });

  describe("OpenAIProvider", () => {
    describe("Session ID Generation", () => {
      test("should generate UUID when no conversation ID provided", () => {
        const provider = new OpenAIProvider();
        const messages = [{ role: "user", content: "test message" }];

        const sessionId = provider.getOrCreateSessionId(null, messages);

        assert.match(
          sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });

      test("should use provided conversation ID when available", () => {
        const provider = new OpenAIProvider();
        const messages = [{ role: "user", content: "test message" }];
        const providedId = "openai-conversation-456";

        const sessionId = provider.getOrCreateSessionId(providedId, messages);

        assert.strictEqual(sessionId, providedId);
      });

      test("should generate consistent session IDs for same conversation", () => {
        const provider = new OpenAIProvider();
        const messages = [{ role: "user", content: "test message" }];

        const sessionId1 = provider.getOrCreateSessionId(null, messages);
        const sessionId2 = provider.getOrCreateSessionId(null, messages);

        assert.strictEqual(sessionId1, sessionId2);
      });
    });

    describe("Chat Method Integration", () => {
      test("should generate session ID in chat method", async () => {
        const provider = new OpenAIProvider();
        const messages = [{ role: "user", content: "test" }];

        try {
          await provider.chat(messages);
        } catch (error) {
          // Expected since OpenAI provider is not implemented
          assert.strictEqual(
            error.message,
            "OpenAI provider not yet implemented",
          );
        }

        // Verify session was created
        const sessionId = provider.getOrCreateSessionId(null, messages);
        assert.match(
          sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });
    });
  });

  describe("LocalProvider", () => {
    describe("Session ID Generation", () => {
      test("should generate UUID when no conversation ID provided", () => {
        const provider = new LocalProvider();
        const messages = [{ role: "user", content: "test message" }];

        const sessionId = provider.getOrCreateSessionId(null, messages);

        assert.match(
          sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });

      test("should use provided conversation ID when available", () => {
        const provider = new LocalProvider();
        const messages = [{ role: "user", content: "test message" }];
        const providedId = "local-conversation-789";

        const sessionId = provider.getOrCreateSessionId(providedId, messages);

        assert.strictEqual(sessionId, providedId);
      });

      test("should generate consistent session IDs for same conversation", () => {
        const provider = new LocalProvider();
        const messages = [{ role: "user", content: "test message" }];

        const sessionId1 = provider.getOrCreateSessionId(null, messages);
        const sessionId2 = provider.getOrCreateSessionId(null, messages);

        assert.strictEqual(sessionId1, sessionId2);
      });
    });

    describe("Chat Method Integration", () => {
      test("should generate session ID in chat method", async () => {
        const provider = new LocalProvider();
        const messages = [{ role: "user", content: "test" }];

        try {
          await provider.chat(messages);
        } catch (error) {
          // Expected since Local provider is not implemented
          assert.strictEqual(
            error.message,
            "Local provider not yet implemented",
          );
        }

        // Verify session was created
        const sessionId = provider.getOrCreateSessionId(null, messages);
        assert.match(
          sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });
    });
  });

  describe("Cross-Provider Session Isolation", () => {
    test("should maintain independent session tracking across providers", () => {
      const anthropic = new AnthropicProvider();
      const openai = new OpenAIProvider();
      const local = new LocalProvider();
      const messages = [{ role: "user", content: "same message" }];

      const sessionAnthropic = anthropic.getOrCreateSessionId(null, messages);
      const sessionOpenAI = openai.getOrCreateSessionId(null, messages);
      const sessionLocal = local.getOrCreateSessionId(null, messages);

      // All should be different UUIDs despite same input
      assert.notStrictEqual(sessionAnthropic, sessionOpenAI);
      assert.notStrictEqual(sessionAnthropic, sessionLocal);
      assert.notStrictEqual(sessionOpenAI, sessionLocal);

      // All should be valid UUIDs
      [sessionAnthropic, sessionOpenAI, sessionLocal].forEach((sessionId) => {
        assert.match(
          sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });
    });
  });
});
