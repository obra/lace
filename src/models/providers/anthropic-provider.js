// ABOUTME: Anthropic API provider with tool calling support
// ABOUTME: Handles Claude models for reasoning, planning, and execution tasks

import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

export class AnthropicProvider {
  constructor(config = {}) {
    this.config = config;
    this.client = null;
    this.apiKey = null;
    this.sessionId = randomUUID(); // One session per provider instance

    // Model information with context windows and pricing
    this.modelInfo = {
      // Claude 4 models
      "claude-4-opus": {
        contextWindow: 200000,
        inputPricePerMillion: 15.0,
        outputPricePerMillion: 75.0,
      },
      "claude-4-sonnet": {
        contextWindow: 200000,
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      },

      // Claude 3.7 models
      "claude-3-7-sonnet": {
        contextWindow: 200000,
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      },

      // Claude 3.5 models
      "claude-3-5-sonnet-20241022": {
        contextWindow: 200000,
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      },
      "claude-3-5-sonnet-20240620": {
        contextWindow: 200000,
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      },
      "claude-3-5-sonnet-latest": {
        contextWindow: 200000,
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      },
      "claude-3-5-haiku-20241022": {
        contextWindow: 200000,
        inputPricePerMillion: 0.8,
        outputPricePerMillion: 4.0,
      },
      "claude-3-5-haiku-latest": {
        contextWindow: 200000,
        inputPricePerMillion: 0.8,
        outputPricePerMillion: 4.0,
      },

      // Claude 3 models
      "claude-3-opus-20240229": {
        contextWindow: 200000,
        inputPricePerMillion: 15.0,
        outputPricePerMillion: 75.0,
      },
      "claude-3-opus-latest": {
        contextWindow: 200000,
        inputPricePerMillion: 15.0,
        outputPricePerMillion: 75.0,
      },
      "claude-3-sonnet-20240229": {
        contextWindow: 200000,
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      },
      "claude-3-haiku-20240307": {
        contextWindow: 200000,
        inputPricePerMillion: 0.25,
        outputPricePerMillion: 1.25,
      },

      // Legacy models (fallback values)
      "claude-2.1": {
        contextWindow: 200000,
        inputPricePerMillion: 8.0,
        outputPricePerMillion: 24.0,
      },
      "claude-2.0": {
        contextWindow: 100000,
        inputPricePerMillion: 8.0,
        outputPricePerMillion: 24.0,
      },
      "claude-instant-1.2": {
        contextWindow: 100000,
        inputPricePerMillion: 0.8,
        outputPricePerMillion: 2.4,
      },
    };
  }

  async initialize() {
    // Load API key from ~/.lace/api-keys/anthropic
    try {
      const keyPath = join(homedir(), ".lace", "api-keys", "anthropic");
      this.apiKey = (await fs.readFile(keyPath, "utf8")).trim();
    } catch (error) {
      throw new Error(
        `Failed to load Anthropic API key from ~/.lace/api-keys/anthropic: ${error.message}`,
      );
    }

    this.client = new Anthropic({
      apiKey: this.apiKey,
    });
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  async chat(messages, options = {}) {
    const {
      model = "claude-3-5-sonnet-20241022",
      tools = [],
      maxTokens = 4096,
      temperature = 0.7,
      onTokenUpdate = null,
      enableCaching = false,
    } = options;

    try {
      const { systemMessage, userMessages } =
        this.separateSystemMessage(messages);

      const params = {
        model,
        messages: userMessages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
      };

      // Add prompt caching beta header if enabled
      if (enableCaching) {
        params.extra_headers = {
          "anthropic-beta": "prompt-caching-2024-07-31",
        };
      }

      // Add system message if present
      if (systemMessage) {
        if (enableCaching) {
          // Format system message for caching
          params.system = [
            {
              type: "text",
              text: systemMessage,
              cache_control: { type: "ephemeral" },
            },
          ];
        } else {
          params.system = systemMessage;
        }
      }

      // Add tools if provided
      if (tools.length > 0) {
        params.tools = this.convertTools(tools);
      }

      const stream = await this.client.messages.create(params);

      const result = await this.handleStreamResponse(stream, onTokenUpdate);
      // Add session ID to successful responses
      if (result.success) {
        result.sessionId = this.sessionId;
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        sessionId: this.sessionId,
      };
    }
  }


  separateSystemMessage(messages) {
    let systemMessage = null;
    const userMessages = [];

    for (const message of messages) {
      if (message.role === "system") {
        systemMessage = message.content;
      } else {
        userMessages.push({
          role: message.role,
          content: message.content,
        });
      }
    }

    return { systemMessage, userMessages };
  }

  convertTools(tools) {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object",
        properties: tool.parameters || {},
        required: tool.required || [],
      },
    }));
  }

  async handleStreamResponse(stream, onTokenUpdate) {
    const result = {
      success: true,
      content: "",
      toolCalls: [],
      usage: null,
    };

    let currentToolCall = null;
    let toolCallInput = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;
    let currentContentBlockIndex = 0;

    try {
      for await (const chunk of stream) {
        if (chunk.type === "message_start") {
          inputTokens = chunk.message.usage.input_tokens;
          cacheCreationInputTokens = chunk.message.usage.cache_creation_input_tokens || 0;
          cacheReadInputTokens = chunk.message.usage.cache_read_input_tokens || 0;
          if (onTokenUpdate) {
            onTokenUpdate({ inputTokens, outputTokens: 0, streaming: true });
          }
        } else if (chunk.type === "content_block_start") {
          currentContentBlockIndex = chunk.index;
          
          if (chunk.content_block.type === "tool_use") {
            currentToolCall = {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              input: {},
            };
            toolCallInput = "";
            
            // Notify about tool use start if callback available
            if (onTokenUpdate) {
              onTokenUpdate({ 
                inputTokens, 
                outputTokens, 
                streaming: true,
                toolUseStart: {
                  id: chunk.content_block.id,
                  name: chunk.content_block.name
                }
              });
            }
          } else if (chunk.content_block.type === "thinking") {
            // Support for thinking content blocks
            if (onTokenUpdate) {
              onTokenUpdate({ 
                inputTokens, 
                outputTokens, 
                streaming: true,
                thinkingStart: true
              });
            }
          }
        } else if (chunk.type === "content_block_delta") {
          if (chunk.delta.type === "text_delta") {
            result.content += chunk.delta.text;
            if (onTokenUpdate) {
              outputTokens += this.estimateTokens(chunk.delta.text);
              onTokenUpdate({ 
                inputTokens, 
                outputTokens, 
                streaming: true,
                token: chunk.delta.text
              });
            }
          } else if (chunk.delta.type === "input_json_delta") {
            toolCallInput += chunk.delta.partial_json;
            
            // Notify about tool input progress
            if (onTokenUpdate && currentToolCall) {
              onTokenUpdate({ 
                inputTokens, 
                outputTokens, 
                streaming: true,
                toolInputDelta: {
                  id: currentToolCall.id,
                  partialJson: chunk.delta.partial_json
                }
              });
            }
          } else if (chunk.delta.type === "thinking_delta") {
            // Handle thinking content separately from main content
            if (onTokenUpdate) {
              outputTokens += this.estimateTokens(chunk.delta.text);
              onTokenUpdate({ 
                inputTokens, 
                outputTokens, 
                streaming: true,
                thinkingToken: chunk.delta.text
              });
            }
          }
        } else if (chunk.type === "content_block_stop") {
          if (currentToolCall) {
            try {
              currentToolCall.input = JSON.parse(toolCallInput);
              result.toolCalls.push(currentToolCall);
              
              // Notify about tool use completion
              if (onTokenUpdate) {
                onTokenUpdate({ 
                  inputTokens, 
                  outputTokens, 
                  streaming: true,
                  toolUseComplete: {
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    input: currentToolCall.input
                  }
                });
              }
            } catch (error) {
              console.warn("Failed to parse tool call input:", toolCallInput);
              
              // Notify about tool parsing error
              if (onTokenUpdate) {
                onTokenUpdate({ 
                  inputTokens, 
                  outputTokens, 
                  streaming: true,
                  toolUseError: {
                    id: currentToolCall.id,
                    error: "Failed to parse tool input"
                  }
                });
              }
            }
            currentToolCall = null;
            toolCallInput = "";
          } else {
            // Handle other content block types (e.g., thinking blocks)
            if (onTokenUpdate) {
              onTokenUpdate({ 
                inputTokens, 
                outputTokens, 
                streaming: true,
                contentBlockStop: {
                  index: currentContentBlockIndex
                }
              });
            }
          }
        } else if (chunk.type === "message_delta") {
          if (chunk.usage) {
            outputTokens = chunk.usage.output_tokens;
            if (onTokenUpdate) {
              onTokenUpdate({ inputTokens, outputTokens, streaming: true });
            }
          }
        } else if (chunk.type === "message_stop") {
          result.usage = {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
            cache_creation_input_tokens: cacheCreationInputTokens,
            cache_read_input_tokens: cacheReadInputTokens,
          };
          if (onTokenUpdate) {
            onTokenUpdate({ inputTokens, outputTokens, streaming: false });
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return result;
  }

  // Rough token estimation for streaming updates
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  async countTokens(messages, options = {}) {
    const { model = "claude-3-5-sonnet-20241022", tools = [], enableCaching = false } = options;

    try {
      const { systemMessage, userMessages } = this.separateSystemMessage(messages);

      const params = {
        betas: ["token-counting-2024-11-01"],
        model,
        messages: userMessages,
      };

      // Add prompt caching beta if enabled
      if (enableCaching) {
        params.betas.push("prompt-caching-2024-07-31");
      }

      // Add system message if present
      if (systemMessage) {
        if (enableCaching) {
          // Format system message for caching in token counting
          params.system = [
            {
              type: "text",
              text: systemMessage,
              cache_control: { type: "ephemeral" },
            },
          ];
        } else {
          params.system = systemMessage;
        }
      }

      // Add tools if provided
      if (tools.length > 0) {
        params.tools = this.convertTools(tools);
      }

      const response = await this.client.beta.messages.countTokens(params);
      return {
        success: true,
        inputTokens: response.input_tokens,
        totalTokens: response.input_tokens, // Only input tokens for pre-call counting
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        inputTokens: 0,
        totalTokens: 0,
      };
    }
  }

  convertResponse(response) {
    const result = {
      success: true,
      content: "",
      toolCalls: [],
      usage: response.usage,
    };

    for (const contentBlock of response.content) {
      if (contentBlock.type === "text") {
        result.content += contentBlock.text;
      } else if (contentBlock.type === "tool_use") {
        result.toolCalls.push({
          id: contentBlock.id,
          name: contentBlock.name,
          input: contentBlock.input,
        });
      }
    }

    return result;
  }

  getContextWindow(model) {
    const modelInfo = this.modelInfo[model];
    return modelInfo ? modelInfo.contextWindow : 200000; // Default fallback
  }

  calculateCost(model, inputTokens, outputTokens) {
    const modelInfo = this.modelInfo[model];
    if (!modelInfo) {
      return null;
    }

    const inputCost = (inputTokens / 1000000) * modelInfo.inputPricePerMillion;
    const outputCost =
      (outputTokens / 1000000) * modelInfo.outputPricePerMillion;

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      inputTokens,
      outputTokens,
    };
  }

  getContextUsage(model, totalTokens) {
    const contextWindow = this.getContextWindow(model);
    return {
      used: totalTokens,
      total: contextWindow,
      percentage: (totalTokens / contextWindow) * 100,
      remaining: contextWindow - totalTokens,
    };
  }

  getInfo() {
    return {
      name: "anthropic",
      models: Object.keys(this.modelInfo),
      capabilities: [
        "chat",
        "tool_calling",
        "function_calling",
        "reasoning",
        "context_tracking",
        "cost_calculation",
      ],
    };
  }

  getMetadata() {
    return {
      name: "anthropic",
      description: "High-quality language models from Anthropic with strong reasoning capabilities",
      usage_guidance: `Use Anthropic models when you need:
- High-quality reasoning and analysis
- Complex problem-solving tasks  
- Code generation and review
- Detailed explanations and documentation
- Tool calling and function execution

STRENGTHS:
- Excellent reasoning capabilities
- Strong code understanding
- Reliable tool calling
- Good instruction following
- Advanced prompt caching

MODELS:
- claude-3-5-sonnet: Best balance of speed and capability (200K context, $3/$15 per million tokens)
- claude-3-5-haiku: Fast and efficient for simple tasks (200K context, $0.8/$4 per million tokens) 
- claude-3-opus: Most capable for complex reasoning (200K context, $15/$75 per million tokens)

Best for: Most general-purpose AI tasks, reasoning, coding, analysis.`,
      supportedModels: this.modelInfo,
      capabilities: [
        "streaming",
        "tool_calling", 
        "system_messages",
        "prompt_caching",
        "thinking",
        "reasoning",
        "code_generation",
        "analysis"
      ],
      defaultModel: "claude-3-5-sonnet-20241022",
      strengths: [
        "reasoning",
        "code_understanding", 
        "tool_calling",
        "instruction_following",
        "analysis"
      ],
      contextWindow: this.getContextWindow()
    };
  }
}
