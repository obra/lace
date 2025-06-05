// ABOUTME: Anthropic API provider with tool calling support
// ABOUTME: Handles Claude models for reasoning, planning, and execution tasks

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export class AnthropicProvider {
  constructor(config = {}) {
    this.config = config;
    this.client = null;
    this.apiKey = null;
  }

  async initialize() {
    // Load API key from ~/.lace/api-keys/anthropic
    try {
      const keyPath = join(homedir(), '.lace', 'api-keys', 'anthropic');
      this.apiKey = (await fs.readFile(keyPath, 'utf8')).trim();
    } catch (error) {
      throw new Error(`Failed to load Anthropic API key from ~/.lace/api-keys/anthropic: ${error.message}`);
    }

    this.client = new Anthropic({
      apiKey: this.apiKey
    });
  }

  async chat(messages, options = {}) {
    const {
      model = 'claude-3-5-sonnet-20241022',
      tools = [],
      maxTokens = 4096,
      temperature = 0.7
    } = options;

    try {
      const { systemMessage, userMessages } = this.separateSystemMessage(messages);
      
      const params = {
        model,
        messages: userMessages,
        max_tokens: maxTokens,
        temperature
      };

      // Add system message if present
      if (systemMessage) {
        params.system = systemMessage;
      }

      // Add tools if provided
      if (tools.length > 0) {
        params.tools = this.convertTools(tools);
      }

      const response = await this.client.messages.create(params);
      
      return this.convertResponse(response);
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  separateSystemMessage(messages) {
    let systemMessage = null;
    const userMessages = [];

    for (const message of messages) {
      if (message.role === 'system') {
        systemMessage = message.content;
      } else {
        userMessages.push({
          role: message.role,
          content: message.content
        });
      }
    }

    return { systemMessage, userMessages };
  }

  convertTools(tools) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.parameters || {},
        required: tool.required || []
      }
    }));
  }

  convertResponse(response) {
    const result = {
      success: true,
      content: '',
      toolCalls: [],
      usage: response.usage
    };

    for (const contentBlock of response.content) {
      if (contentBlock.type === 'text') {
        result.content += contentBlock.text;
      } else if (contentBlock.type === 'tool_use') {
        result.toolCalls.push({
          id: contentBlock.id,
          name: contentBlock.name,
          input: contentBlock.input
        });
      }
    }

    return result;
  }

  getInfo() {
    return {
      name: 'anthropic',
      models: [
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229'
      ],
      capabilities: [
        'chat',
        'tool_calling',
        'function_calling',
        'reasoning'
      ]
    };
  }
}