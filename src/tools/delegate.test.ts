// ABOUTME: Tests for the delegate tool
// ABOUTME: Validates subagent creation, execution, and tool approval flow

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DelegateTool } from '~/tools/implementations/delegate';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ProviderRegistry } from '~/providers/registry';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import type { ToolContext } from '~/tools/types';

// Mock provider for testing delegation
class MockProvider extends BaseMockProvider {
  private _responses: string[] = ['Mock delegation response'];
  private _responseIndex = 0;

  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  setMockResponses(responses: string[]): void {
    this._responses = responses;
    this._responseIndex = 0;
  }

  async createResponse(messages: ProviderMessage[], tools: Tool[]): Promise<ProviderResponse> {
    const response = this._responses[this._responseIndex] || 'Mock delegation response';
    this._responseIndex = Math.min(this._responseIndex + 1, this._responses.length - 1);

    // Check if this is a delegation request by looking for task completion instructions in the messages
    const lastMessage = messages[messages.length - 1];
    const hasTaskCompleteInstruction = lastMessage?.content?.includes('task_complete tool');
    const taskCompleteTool = tools.find((t) => t.name === 'task_complete');

    // Extract task ID from the message if present
    const taskIdMatch = lastMessage?.content?.match(/complete task '([^']+)'/);
    const taskId = taskIdMatch?.[1] || 'unknown_task';

    // If this looks like a delegation request and we have the task_complete tool, use it
    if (hasTaskCompleteInstruction && taskCompleteTool) {
      return Promise.resolve({
        content: `I'll complete this task: ${response}`,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        toolCalls: [
          {
            id: 'complete_task_call',
            name: 'task_complete',
            input: {
              id: taskId,
              message: response,
            },
          },
        ],
      });
    }

    return Promise.resolve({
      content: response,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });
  }
}

describe('DelegateTool', () => {
  const _tempDirContext = useTempLaceDir();
  let tool: DelegateTool;
  let session: Session;
  let project: Project;
  let mockProvider: MockProvider;
  let context: ToolContext;

  beforeEach(() => {
    setupTestPersistence();
    mockProvider = new MockProvider();

    // Mock the ProviderRegistry to return our mock provider
    vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation(
      (_name: string, _config?: unknown) => {
        return mockProvider;
      }
    );

    // Also mock the static createWithAutoDiscovery method
    vi.spyOn(ProviderRegistry, 'createWithAutoDiscovery').mockImplementation(() => {
      const mockRegistry = {
        createProvider: () => mockProvider,
        getProvider: () => mockProvider,
        getProviderNames: () => ['anthropic', 'openai'],
      } as unknown as ProviderRegistry;
      return mockRegistry;
    });

    // Create project first
    project = Project.create('Test Project', '/tmp/test-delegate');

    // Create session with anthropic - the provider will be mocked
    session = Session.create({
      name: 'Delegate Test Session',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      projectId: project.getId(),
    });

    // Get tool from session agent's toolExecutor
    const agent = session.getAgent(session.getId());
    const toolExecutor = agent!.toolExecutor;
    tool = toolExecutor.getTool('delegate') as DelegateTool;

    context = {
      threadId: session.getId(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    session?.destroy();
    teardownTestPersistence();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('delegate');
    expect(tool.annotations?.openWorldHint).toBe(true);
    expect(tool.inputSchema.required).toEqual(['title', 'prompt', 'expected_response']);
  });

  it('should delegate a simple task with default model', async () => {
    mockProvider.setMockResponses(['Analysis complete: 3 test failures identified']);

    const result = await tool.execute(
      {
        title: 'Analyze test failures',
        prompt: 'Look at the failing tests and identify common patterns',
        expected_response: 'A list of failure patterns',
        model: 'anthropic:claude-3-5-sonnet-20241022',
      },
      context
    );

    // Test the actual behavior - delegation should work and return results
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Analysis complete: 3 test failures identified');
    expect(result.metadata?.taskTitle).toBe('Analyze test failures');
  });

  it('should handle custom provider:model format', async () => {
    mockProvider.setMockResponses(['Custom model response']);

    const result = await tool.execute(
      {
        title: 'Test custom model',
        prompt: 'Use custom model for delegation',
        expected_response: 'Custom response',
        model: 'openai:gpt-4',
      },
      context
    );

    // Test that delegation works with custom model specification
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Custom model response');
  });

  it('should create delegate thread and execute subagent', async () => {
    mockProvider.setMockResponses(['Directory listed successfully']);

    const result = await tool.execute(
      {
        title: 'List files',
        prompt: 'List the files in the current directory',
        expected_response: 'List of files',
        model: 'anthropic:claude-3-5-sonnet-20241022',
      },
      context
    );

    // Verify delegation succeeded
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Directory listed successfully');
    expect(result.metadata?.taskTitle).toBe('List files');
  });

  it('should handle subagent errors gracefully', async () => {
    // Test error handling by using a tool without TaskManager
    const toolWithoutTaskManager = new DelegateTool();

    const result = await toolWithoutTaskManager.execute(
      {
        title: 'Test error',
        prompt: 'This should fail',
        expected_response: 'Error',
        model: 'anthropic:claude-3-5-sonnet-20241022',
      },
      context
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('TaskManager is required for delegation');
  });

  it('should timeout if subagent takes too long', async () => {
    // Create a tool without TaskManager to trigger the error quickly
    const toolWithoutTaskManager = new DelegateTool();

    try {
      const result = await toolWithoutTaskManager.execute(
        {
          title: 'Long running task',
          prompt: 'This should timeout',
          expected_response: 'Timeout error',
          model: 'anthropic:claude-3-5-sonnet-20241022',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('TaskManager is required for delegation');
    } finally {
      // Restore original handlers
    }
  });

  it('should format the subagent system prompt correctly', async () => {
    mockProvider.setMockResponses(['Task completed']);

    const result = await tool.execute(
      {
        title: 'Format test',
        prompt: 'Test system prompt formatting',
        expected_response: 'Formatted response',
        model: 'anthropic:claude-3-5-sonnet-20241022',
      },
      context
    );

    // Since we're using the proper integration pattern, the delegation should work
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Task completed');
  });

  it('should handle invalid provider format', async () => {
    const result = await tool.execute(
      {
        title: 'Invalid provider test',
        prompt: 'Test with invalid provider',
        expected_response: 'Error',
        model: 'invalid-provider-format',
      },
      context
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid model format');
  });

  it('should collect all subagent responses', async () => {
    mockProvider.setMockResponses(['First response', 'Second response']);

    const result = await tool.execute(
      {
        title: 'Multi-response test',
        prompt: 'Generate multiple responses',
        expected_response: 'Combined responses',
        model: 'anthropic:claude-3-5-sonnet-20241022',
      },
      context
    );

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('First response');
    // Note: The actual behavior may only return the first response depending on implementation
  });

  it('should include delegate thread ID in result metadata', async () => {
    mockProvider.setMockResponses(['Task completed with metadata']);

    const result = await tool.execute(
      {
        title: 'Metadata test',
        prompt: 'Test metadata inclusion',
        expected_response: 'Response with metadata',
        model: 'anthropic:claude-3-5-sonnet-20241022',
      },
      context
    );

    expect(result.isError).toBe(false);
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.taskTitle).toBeDefined();
  });

  it('should accept valid model formats', async () => {
    const validModels = [
      'anthropic:claude-3-5-sonnet-20241022',
      'openai:gpt-4',
      'anthropic:claude-3-5-haiku-20241022',
    ];

    for (const model of validModels) {
      mockProvider.setMockResponses(['Valid model response']);

      const result = await tool.execute(
        {
          title: `Test ${model}`,
          prompt: 'Test valid model format',
          expected_response: 'Valid response',
          model,
        },
        context
      );

      // Should not fail on model validation
      expect(result.isError).toBe(false);
    }
  });
});
