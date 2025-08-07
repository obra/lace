// ABOUTME: Shared utilities for delegation testing setup with real provider instances
// ABOUTME: Uses MSW HTTP mocking for realistic AI provider interaction testing

import { vi } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { ApprovalDecision } from '~/tools/approval-types';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import { ProviderRegistry } from '~/providers/registry';
import { AIProvider, ProviderConfig, ProviderInfo, ModelInfo } from '~/providers/base-provider';

export interface DelegationTestSetup {
  session: Session;
  project: Project;
  providerInstanceId: string;
  setMockResponses: (responses: string[]) => void;
  setupBlockedTaskResponse: () => void;
  cleanup: () => Promise<void>;
  // mswHelper removed - using direct provider mocking for now
}

// Global mock state that can be shared across all provider instances
let globalMockState = {
  responses: ['Integration test completed successfully'],
  index: 0,
  isBlockedMode: false,
};

export async function createDelegationTestSetup(options?: {
  sessionName?: string;
  projectName?: string;
  projectPath?: string;
  provider?: 'anthropic' | 'openai';
  model?: string;
  responses?: string[];
}): Promise<DelegationTestSetup> {
  const provider = options?.provider || 'anthropic';
  const model = options?.model || 'claude-3-5-haiku-20241022';

  // Set environment variables to ensure provider instances can be created
  if (provider === 'anthropic') {
    process.env.ANTHROPIC_KEY = 'test-anthropic-key';
  } else {
    process.env.OPENAI_API_KEY = 'test-openai-key';
  }

  // Create real provider instance for testing
  const providerInstanceId = await createTestProviderInstance({
    catalogId: provider,
    models: [model],
    displayName: `Test ${provider.charAt(0).toUpperCase() + provider.slice(1)} Delegation`,
    apiKey: provider === 'anthropic' ? 'test-anthropic-key' : 'test-openai-key',
  });

  // Initialize global mock state
  globalMockState = {
    responses: options?.responses || ['Integration test completed successfully'],
    index: 0,
    isBlockedMode: false,
  };

  // Create a proper mock provider class that extends AIProvider
  class MockProvider extends AIProvider {
    constructor(providerType: string, modelId: string) {
      super({
        model: modelId,
        maxTokens: 4096,
        systemPrompt: '',
        streaming: false,
      });
    }

    get providerName(): string {
      return `test-${this._config.model}`;
    }

    get defaultModel(): string {
      return this._config.model || 'claude-3-5-haiku-20241022';
    }

    async createResponse(messages: any, tools: any) {
      // Look for task assignment patterns (delegation-specific logic)
      const taskMessage = messages.find(
        (m: any) =>
          m.content &&
          typeof m.content === 'string' &&
          (m.content.includes('You have been assigned task') ||
            m.content.includes('LACE TASK SYSTEM') ||
            m.content.includes('TASK DETAILS'))
      );

      if (taskMessage && typeof taskMessage.content === 'string') {
        // Extract task ID from task assignment message
        const match =
          taskMessage.content.match(/assigned task '([^']+)'/) ||
          taskMessage.content.match(/task[:\s]+([a-zA-Z0-9_-]+)/);
        const taskId = match ? match[1] : 'unknown';

        // Check if we're in blocked mode
        if (globalMockState.isBlockedMode) {
          return {
            content: 'I encountered an issue and cannot complete this task.',
            usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
            toolCalls: [
              {
                id: 'task_update_call',
                name: 'task_update',
                input: { taskId, status: 'blocked' },
              },
            ],
          };
        }

        const response = this.getNextResponse();

        return {
          content: `I'll complete this task: ${response}`,
          usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
          toolCalls: [
            {
              id: 'delegation_task_complete',
              name: 'task_complete',
              input: { id: taskId, message: response },
            },
          ],
        };
      }

      // Non-delegation response
      const response = this.getNextResponse();

      return {
        content: response,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        toolCalls: [],
      };
    }

    private getNextResponse(): string {
      if (globalMockState.responses.length === 0) {
        return 'Mock delegation response';
      }
      const response =
        globalMockState.responses[globalMockState.index % globalMockState.responses.length];
      globalMockState.index++;
      return response;
    }

    isConfigured(): boolean {
      return true;
    }

    getProviderInfo(): ProviderInfo {
      return {
        name: this.providerName,
        displayName: 'Test Provider',
        requiresApiKey: false,
        configurationHint: 'No configuration needed for testing',
      };
    }

    getAvailableModels(): ModelInfo[] {
      return [
        {
          id: this.defaultModel,
          displayName: 'Test Model',
          description: 'Mock model for testing',
          contextWindow: 200000,
          maxOutputTokens: 4096,
          isDefault: true,
        },
      ];
    }

    cleanup(): Promise<void> {
      return Promise.resolve();
    }

    setSystemPrompt(prompt: string): void {
      this._systemPrompt = prompt;
    }

    countTokens(messages: any[], _tools: any[] = []): number {
      return messages.length * 10; // Simple mock calculation
    }
  }

  // Mock the createProvider method to return our AIProvider-based mock provider
  vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation(
    (providerType: string, config: any) => {
      return new MockProvider(providerType, model);
    }
  );

  // Initialize provider registry to make sure provider instances are loaded
  const registry = new ProviderRegistry();
  await registry.initialize();

  // Create project with real provider instance
  const project = Project.create(
    options?.projectName || 'Test Delegation Project',
    options?.projectPath || '/tmp/test-delegation',
    'Test project for delegation',
    {
      providerInstanceId,
      modelId: model,
    }
  );

  // Create session WITHOUT provider configuration - it inherits from project
  const session = Session.create({
    name: options?.sessionName || 'Delegation Test Session',
    projectId: project.getId(),
    approvalCallback: {
      requestApproval: async () => Promise.resolve(ApprovalDecision.ALLOW_ONCE), // Auto-approve all tool calls for testing
    },
  });

  // Helper functions for controlling mock behavior
  const setMockResponses = (responses: string[]) => {
    globalMockState.responses = responses;
    globalMockState.index = 0;
  };

  const setupBlockedTaskResponse = () => {
    // Instead of creating a new spy, just update the response state to use blocked responses
    // This is simpler and matches the old behavior better
    globalMockState.responses = ['blocked task response']; // This will be ignored since we handle task blocking specially
    globalMockState.index = 0;

    // Set a flag to indicate we want blocked responses
    globalMockState.isBlockedMode = true;
  };

  // Cleanup function to tear down test resources
  const cleanup = async () => {
    vi.restoreAllMocks();
    await cleanupTestProviderInstances([providerInstanceId]);
    if (provider === 'anthropic') {
      delete process.env.ANTHROPIC_KEY;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  };

  return {
    session,
    project,
    providerInstanceId,
    setMockResponses,
    setupBlockedTaskResponse,
    cleanup,
  };
}
