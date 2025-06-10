// ABOUTME: Anthropic API provider with tool calling support
// ABOUTME: Handles Claude models for reasoning, planning, and execution tasks

import Anthropic from '@anthropic-ai/sdk'
import { promises as fs } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

export class AnthropicProvider {
  constructor (config = {}) {
    this.config = config
    this.client = null
    this.apiKey = null
    this.conversationSessions = new Map() // Track conversation session IDs

    // Model information with context windows and pricing
    this.modelInfo = {
      // Claude 4 models
      'claude-4-opus': {
        contextWindow: 200000,
        inputPricePerMillion: 15.00,
        outputPricePerMillion: 75.00
      },
      'claude-4-sonnet': {
        contextWindow: 200000,
        inputPricePerMillion: 3.00,
        outputPricePerMillion: 15.00
      },

      // Claude 3.7 models
      'claude-3-7-sonnet': {
        contextWindow: 200000,
        inputPricePerMillion: 3.00,
        outputPricePerMillion: 15.00
      },

      // Claude 3.5 models
      'claude-3-5-sonnet-20241022': {
        contextWindow: 200000,
        inputPricePerMillion: 3.00,
        outputPricePerMillion: 15.00
      },
      'claude-3-5-sonnet-20240620': {
        contextWindow: 200000,
        inputPricePerMillion: 3.00,
        outputPricePerMillion: 15.00
      },
      'claude-3-5-sonnet-latest': {
        contextWindow: 200000,
        inputPricePerMillion: 3.00,
        outputPricePerMillion: 15.00
      },
      'claude-3-5-haiku-20241022': {
        contextWindow: 200000,
        inputPricePerMillion: 0.80,
        outputPricePerMillion: 4.00
      },
      'claude-3-5-haiku-latest': {
        contextWindow: 200000,
        inputPricePerMillion: 0.80,
        outputPricePerMillion: 4.00
      },

      // Claude 3 models
      'claude-3-opus-20240229': {
        contextWindow: 200000,
        inputPricePerMillion: 15.00,
        outputPricePerMillion: 75.00
      },
      'claude-3-opus-latest': {
        contextWindow: 200000,
        inputPricePerMillion: 15.00,
        outputPricePerMillion: 75.00
      },
      'claude-3-sonnet-20240229': {
        contextWindow: 200000,
        inputPricePerMillion: 3.00,
        outputPricePerMillion: 15.00
      },
      'claude-3-haiku-20240307': {
        contextWindow: 200000,
        inputPricePerMillion: 0.25,
        outputPricePerMillion: 1.25
      },

      // Legacy models (fallback values)
      'claude-2.1': {
        contextWindow: 200000,
        inputPricePerMillion: 8.00,
        outputPricePerMillion: 24.00
      },
      'claude-2.0': {
        contextWindow: 100000,
        inputPricePerMillion: 8.00,
        outputPricePerMillion: 24.00
      },
      'claude-instant-1.2': {
        contextWindow: 100000,
        inputPricePerMillion: 0.80,
        outputPricePerMillion: 2.40
      }
    }
  }

  async initialize () {
    // Load API key from ~/.lace/api-keys/anthropic
    try {
      const keyPath = join(homedir(), '.lace', 'api-keys', 'anthropic')
      this.apiKey = (await fs.readFile(keyPath, 'utf8')).trim()
    } catch (error) {
      throw new Error(`Failed to load Anthropic API key from ~/.lace/api-keys/anthropic: ${error.message}`)
    }

    this.client = new Anthropic({
      apiKey: this.apiKey
    })
  }

  async chat (messages, options = {}) {
    const {
      model = 'claude-3-5-sonnet-20241022',
      tools = [],
      maxTokens = 4096,
      temperature = 0.7,
      onTokenUpdate = null,
      conversationId = null
    } = options

    // Get or create conversation session ID
    const sessionId = this.getOrCreateSessionId(conversationId, messages)

    try {
      const { systemMessage, userMessages } = this.separateSystemMessage(messages)

      const params = {
        model,
        messages: userMessages,
        max_tokens: maxTokens,
        temperature,
        stream: true
      }

      // Add system message if present
      if (systemMessage) {
        params.system = systemMessage
      }

      // Add tools if provided
      if (tools.length > 0) {
        params.tools = this.convertTools(tools)
      }

      const stream = await this.client.messages.create(params)

      const result = await this.handleStreamResponse(stream, onTokenUpdate)
      // Add session ID to successful responses
      if (result.success) {
        result.sessionId = sessionId
      }
      return result
    } catch (error) {
      return {
        success: false,
        error: error.message,
        sessionId
      }
    }
  }

  getOrCreateSessionId (conversationId, messages) {
    // Use provided conversation ID if available
    if (conversationId) {
      return conversationId
    }

    // Generate a conversation key based on the first user message or create a unique key
    const conversationKey = this.generateConversationKey(messages)

    // Check if we already have a session ID for this conversation
    if (this.conversationSessions.has(conversationKey)) {
      return this.conversationSessions.get(conversationKey)
    }

    // Generate new session ID
    const sessionId = randomUUID()
    this.conversationSessions.set(conversationKey, sessionId)

    return sessionId
  }

  generateConversationKey (messages) {
    // Use the first non-system message as the conversation key
    // In practice, this could be more sophisticated (e.g., hash of multiple messages)
    const firstUserMessage = messages.find(msg => msg.role === 'user')
    if (firstUserMessage) {
      // Create a simple hash-like key from the first user message
      return `conv_${firstUserMessage.content.slice(0, 50).replace(/\s+/g, '_')}`
    }

    // Fallback to timestamp-based key
    return `conv_${Date.now()}`
  }

  separateSystemMessage (messages) {
    let systemMessage = null
    const userMessages = []

    for (const message of messages) {
      if (message.role === 'system') {
        systemMessage = message.content
      } else {
        userMessages.push({
          role: message.role,
          content: message.content
        })
      }
    }

    return { systemMessage, userMessages }
  }

  convertTools (tools) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.parameters || {},
        required: tool.required || []
      }
    }))
  }

  async handleStreamResponse (stream, onTokenUpdate) {
    const result = {
      success: true,
      content: '',
      toolCalls: [],
      usage: null
    }

    let currentToolCall = null
    let toolCallInput = ''
    let inputTokens = 0
    let outputTokens = 0

    try {
      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          inputTokens = chunk.message.usage.input_tokens
          if (onTokenUpdate) {
            onTokenUpdate({ inputTokens, outputTokens: 0, streaming: true })
          }
        } else if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'tool_use') {
            currentToolCall = {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              input: {}
            }
            toolCallInput = ''
          }
        } else if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            result.content += chunk.delta.text
            if (onTokenUpdate) {
              outputTokens += this.estimateTokens(chunk.delta.text)
              onTokenUpdate({ inputTokens, outputTokens, streaming: true })
            }
          } else if (chunk.delta.type === 'input_json_delta') {
            toolCallInput += chunk.delta.partial_json
          }
        } else if (chunk.type === 'content_block_stop') {
          if (currentToolCall) {
            try {
              currentToolCall.input = JSON.parse(toolCallInput)
              result.toolCalls.push(currentToolCall)
            } catch (error) {
              console.warn('Failed to parse tool call input:', toolCallInput)
            }
            currentToolCall = null
            toolCallInput = ''
          }
        } else if (chunk.type === 'message_delta') {
          if (chunk.usage) {
            outputTokens = chunk.usage.output_tokens
            if (onTokenUpdate) {
              onTokenUpdate({ inputTokens, outputTokens, streaming: true })
            }
          }
        } else if (chunk.type === 'message_stop') {
          result.usage = {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens
          }
          if (onTokenUpdate) {
            onTokenUpdate({ inputTokens, outputTokens, streaming: false })
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }

    return result
  }

  // Rough token estimation for streaming updates
  estimateTokens (text) {
    return Math.ceil(text.length / 4)
  }

  convertResponse (response) {
    const result = {
      success: true,
      content: '',
      toolCalls: [],
      usage: response.usage
    }

    for (const contentBlock of response.content) {
      if (contentBlock.type === 'text') {
        result.content += contentBlock.text
      } else if (contentBlock.type === 'tool_use') {
        result.toolCalls.push({
          id: contentBlock.id,
          name: contentBlock.name,
          input: contentBlock.input
        })
      }
    }

    return result
  }

  getContextWindow (model) {
    const modelInfo = this.modelInfo[model]
    return modelInfo ? modelInfo.contextWindow : 200000 // Default fallback
  }

  calculateCost (model, inputTokens, outputTokens) {
    const modelInfo = this.modelInfo[model]
    if (!modelInfo) {
      return null
    }

    const inputCost = (inputTokens / 1000000) * modelInfo.inputPricePerMillion
    const outputCost = (outputTokens / 1000000) * modelInfo.outputPricePerMillion

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      inputTokens,
      outputTokens
    }
  }

  getContextUsage (model, totalTokens) {
    const contextWindow = this.getContextWindow(model)
    return {
      used: totalTokens,
      total: contextWindow,
      percentage: (totalTokens / contextWindow) * 100,
      remaining: contextWindow - totalTokens
    }
  }

  getInfo () {
    return {
      name: 'anthropic',
      models: Object.keys(this.modelInfo),
      capabilities: [
        'chat',
        'tool_calling',
        'function_calling',
        'reasoning',
        'context_tracking',
        'cost_calculation'
      ]
    }
  }
}
