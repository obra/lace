// ABOUTME: Mock provider that returns file-read tool calls to trigger approval modals
// ABOUTME: Used in E2E tests to test tool approval modal functionality - extends TestProvider

import { TestProvider } from '~/test-utils/test-provider';
import type { ProviderResponse } from '~/providers/base-provider';

export class ToolApprovalMockProvider extends TestProvider {
  private configuredResponse?: ProviderResponse;
  private hasReturnedToolCalls = false;

  constructor() {
    super({});
  }

  get providerName(): string {
    return 'tool-approval-mock';
  }

  get defaultModel(): string {
    return 'tool-approval-mock-model';
  }

  setResponse(response: Partial<ProviderResponse>): void {
    this.configuredResponse = {
      content: response.content || "I'll read the file for you.",
      toolCalls: response.toolCalls || [],
      usage: response.usage || { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      stopReason: response.stopReason || 'end_turn',
    };
    this.hasReturnedToolCalls = false;
  }

  async createResponse(
    ...args: Parameters<TestProvider['createResponse']>
  ): Promise<ProviderResponse> {
    if (this.configuredResponse) {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Return tool calls only once, then return regular responses
      if (this.configuredResponse.toolCalls.length > 0 && !this.hasReturnedToolCalls) {
        this.hasReturnedToolCalls = true;
        return this.configuredResponse;
      } else {
        // Return response without tool calls for subsequent requests
        return {
          content: this.configuredResponse.content,
          toolCalls: [],
          usage: this.configuredResponse.usage,
          stopReason: this.configuredResponse.stopReason,
        };
      }
    }

    // Default behavior - always return a file-read tool call on first user message
    const [messages] = args;
    const hasUserMessage = messages.some((m) => m.role === 'user');
    const hasToolResult = messages.some((m) => m.role === 'tool');

    if (hasUserMessage && !hasToolResult && !this.hasReturnedToolCalls) {
      this.hasReturnedToolCalls = true;
      
      return {
        content: "I'll read the package.json file for you.",
        toolCalls: [
          {
            id: 'file-read-call-1',
            name: 'file-read',
            input: {
              path: 'package.json'
            },
          },
        ],
        usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
        stopReason: 'end_turn',
      };
    }

    // After tool execution, return regular response
    return {
      content: 'File read completed successfully.',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      stopReason: 'end_turn',
    };
  }
}