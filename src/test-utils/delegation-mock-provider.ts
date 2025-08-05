// ABOUTME: Shared mock provider for delegation testing with task completion support
// ABOUTME: Provides consistent task assignment detection and immediate completion for tests

import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse, ProviderToolCall } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';

export class DelegationMockProvider extends BaseMockProvider {
  private responses: string[] = [];
  private responseIndex = 0;

  constructor(providerName = 'anthropic', defaultModel = 'claude-3-5-haiku-20241022') {
    super({});
    this._providerName = providerName;
    this._defaultModel = defaultModel;
  }

  private _providerName: string;
  private _defaultModel: string;

  get providerName(): string {
    return this._providerName;
  }

  get defaultModel(): string {
    return this._defaultModel;
  }

  get contextWindow(): number {
    return 200000; // Large context window for testing
  }

  get maxOutputTokens(): number {
    return 4096;
  }

  setMockResponses(responses: string[]): void {
    this.responses = responses;
    this.responseIndex = 0;
  }

  async createResponse(messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    const response = this.responses.length > 0 ? this.responses[this.responseIndex] : 'Mock delegation response';
    
    // Only increment for actual responses, not fallback
    if (this.responses.length > 0) {
      this.responseIndex = (this.responseIndex + 1) % this.responses.length;
    }

    // Look for task assignment message - support multiple patterns
    const taskMessage = messages.find(
      (m) =>
        m.content &&
        typeof m.content === 'string' &&
        (m.content.includes('You have been assigned task') ||
         m.content.includes('LACE TASK SYSTEM') ||
         m.content.includes('TASK DETAILS'))
    );

    if (taskMessage) {
      // Extract task ID from task assignment message - try multiple patterns
      const match = taskMessage.content.match(/assigned task '([^']+)'/) || 
                   taskMessage.content.match(/task[:\s]+([a-zA-Z0-9_-]+)/);
      const taskId = match ? match[1] : 'unknown';

      // Immediately complete the task with the mock response
      const toolCall: ProviderToolCall = {
        id: 'delegation_task_complete',
        name: 'task_complete',
        input: {
          id: taskId,
          message: response,
        },
      };

      return Promise.resolve({
        content: `I'll complete this task: ${response}`,
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        toolCalls: [toolCall],
      });
    }

    // Non-delegation response
    return Promise.resolve({
      content: response,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });
  }
}
