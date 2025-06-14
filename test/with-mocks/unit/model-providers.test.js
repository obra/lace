// ABOUTME: Unit tests for model provider session ID tracking functionality
// ABOUTME: Tests conversation ID generation, session tracking, and UUID creation

import { test, describe } from "@jest/globals";
import assert from "node:assert";
import { AnthropicProvider } from "../../../src/models/providers/anthropic-provider.js";
import { OpenAIProvider } from "../../../src/models/providers/openai-provider.js";
import { LocalProvider } from "../../../src/models/providers/local-provider.js";

// Import new mock factories
import { createMockAnthropicClient } from "../__mocks__/standard-mocks.js";

describe("Model Provider Session ID Tracking", () => {
  describe("AnthropicProvider", () => {
    describe("Session ID Generation", () => {
      test("should generate UUID at construction", () => {
        const provider = new AnthropicProvider();

        // Should have a valid UUID sessionId
        assert.match(
          provider.sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });

      test("should generate different session IDs for different instances", () => {
        const provider1 = new AnthropicProvider();
        const provider2 = new AnthropicProvider();

        assert.notStrictEqual(provider1.sessionId, provider2.sessionId);
      });

      test("should allow setting session ID", () => {
        const provider = new AnthropicProvider();
        const customSessionId = "custom-session-123";

        provider.setSessionId(customSessionId);

        assert.strictEqual(provider.sessionId, customSessionId);
      });
    });


    describe("Token Counting", () => {
      test("should have countTokens method", () => {
        const provider = new AnthropicProvider();
        assert.strictEqual(typeof provider.countTokens, "function");
      });

      test("should return proper structure from countTokens with mock", async () => {
        const provider = new AnthropicProvider();
        
        // Use mock factory to avoid actual API calls
        provider.client = createMockAnthropicClient({ 
          countTokensResponse: { input_tokens: 42 } 
        });

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
        
        // Use mock factory to simulate an error
        provider.client = createMockAnthropicClient({ shouldSucceed: false });

        const messages = [{ role: "user", content: "test" }];
        const result = await provider.countTokens(messages);

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, "Token counting error");
        assert.strictEqual(result.inputTokens, 0);
        assert.strictEqual(result.totalTokens, 0);
      });

      test("should pass correct parameters to countTokens API", async () => {
        const provider = new AnthropicProvider();
        let capturedParams = null;
        
        // Mock the client to capture parameters
        const mockClient = createMockAnthropicClient({ 
          countTokensResponse: { input_tokens: 10 } 
        });
        mockClient.beta.messages.countTokens.mockImplementation(async (params) => {
          capturedParams = params;
          return { input_tokens: 10 };
        });
        provider.client = mockClient;

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
        const mockClient = createMockAnthropicClient();
        mockClient.messages.create.mockImplementation(async (params) => {
          capturedParams = params;
          return { 
            content: [{ text: "response" }],
            usage: { input_tokens: 10, output_tokens: 5 }
          };
        });
        provider.client = mockClient;

        const messages = [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello" },
        ];

        await provider.chat(messages, { enableCaching: true });

        // Verify system message formatting for caching
        // Note: Headers are now set at client level, not per-request
        assert.ok(Array.isArray(capturedParams.system), "System should be formatted as array for caching");
        assert.strictEqual(capturedParams.system[0].type, "text");
        assert.strictEqual(capturedParams.system[0].text, "You are a helpful assistant.");
        assert.deepStrictEqual(capturedParams.system[0].cache_control, { type: "ephemeral" });
      });

      test("should not add cache control when caching disabled", async () => {
        const provider = new AnthropicProvider();
        let capturedParams = null;
        
        // Mock the client to capture parameters
        const mockClient = createMockAnthropicClient();
        mockClient.messages.create.mockImplementation(async (params) => {
          capturedParams = params;
          return { 
            content: [{ text: "response" }],
            usage: { input_tokens: 10, output_tokens: 5 }
          };
        });
        provider.client = mockClient;

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
        const mockClient = createMockAnthropicClient({ 
          countTokensResponse: { input_tokens: 42 } 
        });
        mockClient.beta.messages.countTokens.mockImplementation(async (params) => {
          capturedParams = params;
          return { input_tokens: 42 };
        });
        provider.client = mockClient;

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
      test("should generate UUID at construction", () => {
        const provider = new OpenAIProvider();

        assert.match(
          provider.sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });

      test("should generate different session IDs for different instances", () => {
        const provider1 = new OpenAIProvider();
        const provider2 = new OpenAIProvider();

        assert.notStrictEqual(provider1.sessionId, provider2.sessionId);
      });

      test("should allow setting session ID", () => {
        const provider = new OpenAIProvider();
        const customSessionId = "openai-session-456";

        provider.setSessionId(customSessionId);

        assert.strictEqual(provider.sessionId, customSessionId);
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

        // Provider should have a session ID
        assert.match(
          provider.sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });
    });
  });

  describe("LocalProvider", () => {
    describe("Session ID Generation", () => {
      test("should generate UUID at construction", () => {
        const provider = new LocalProvider();

        assert.match(
          provider.sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });

      test("should generate different session IDs for different instances", () => {
        const provider1 = new LocalProvider();
        const provider2 = new LocalProvider();

        assert.notStrictEqual(provider1.sessionId, provider2.sessionId);
      });

      test("should allow setting session ID", () => {
        const provider = new LocalProvider();
        const customSessionId = "local-session-789";

        provider.setSessionId(customSessionId);

        assert.strictEqual(provider.sessionId, customSessionId);
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

        // Provider should have a session ID
        assert.match(
          provider.sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });
    });
  });

  describe("Cross-Provider Session Isolation", () => {
    test("should maintain independent session IDs across provider instances", () => {
      const anthropic = new AnthropicProvider();
      const openai = new OpenAIProvider();
      const local = new LocalProvider();

      // Each provider instance should have its own unique session ID
      assert.notStrictEqual(anthropic.sessionId, openai.sessionId);
      assert.notStrictEqual(anthropic.sessionId, local.sessionId);
      assert.notStrictEqual(openai.sessionId, local.sessionId);

      // All should be valid UUIDs
      [anthropic.sessionId, openai.sessionId, local.sessionId].forEach((sessionId) => {
        assert.match(
          sessionId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });
    });
  });
});
