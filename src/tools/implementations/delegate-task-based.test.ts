// ABOUTME: Integration tests for task-based delegate tool implementation
// ABOUTME: Tests real delegation flow using Session, Project, and TaskManager integration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DelegateTool } from '~/tools/implementations/delegate';
import { ToolContext } from '~/tools/types';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse, ProviderToolCall } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ProviderRegistry } from '~/providers/registry';
import { ApprovalDecision } from '~/tools/approval-types';

// Mock provider for testing delegation - responds with task_complete tool calls
class MockProvider extends BaseMockProvider {
  private responses: string[] = [];
  private responseIndex = 0;

  constructor() {
    super({});
  }

  get providerName(): string {
    return 'anthropic';
  }

  get defaultModel(): string {
    return 'claude-3-5-haiku-20241022';
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
    // Look for task assignment message to extract task ID
    const taskAssignmentMessage = messages.find(
      (m) =>
        m.content &&
        typeof m.content === 'string' &&
        m.content.includes('You have been assigned task')
    );

    let taskId = 'unknown';
    if (taskAssignmentMessage && typeof taskAssignmentMessage.content === 'string') {
      const match = taskAssignmentMessage.content.match(/assigned task '([^']+)'/);
      if (match) {
        taskId = match[1];
      }
    }

    // Get the current response or use default
    const response = this.responses[this.responseIndex] || 'Task completed successfully';
    if (this.responseIndex < this.responses.length - 1) {
      this.responseIndex++;
    }

    // Create a tool call to complete the task
    const toolCall: ProviderToolCall = {
      id: 'task_complete_call',
      name: 'task_complete',
      input: {
        id: taskId,
        message: response,
      },
    };

    return Promise.resolve({
      content: `I'll complete the task now.`,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [toolCall],
    });
  }
}

describe('Task-Based DelegateTool Integration', () => {
  const _tempDirContext = useTempLaceDir();
  let delegateTool: DelegateTool;
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
      approvalCallback: {
        requestApproval: async () => Promise.resolve(ApprovalDecision.ALLOW_ONCE), // Auto-approve all tool calls for testing
      },
    });

    // Create delegate tool and inject TaskManager
    delegateTool = new DelegateTool();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (delegateTool as any).getTaskManager = () => session.getTaskManager();

    context = {
      threadId: session.getId(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    session?.destroy();
    teardownTestPersistence();
  });

  describe('Integration Tests', () => {
    it('should create task and wait for completion via real delegation', async () => {
      // Set up mock provider to respond with task completion
      mockProvider.setMockResponses(['Integration test completed successfully']);

      const result = await delegateTool.execute(
        {
          title: 'Integration Test Task',
          prompt: 'Complete this integration test',
          expected_response: 'Test completed successfully',
          model: 'anthropic:claude-3-5-haiku-20241022',
        },
        context
      );

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Integration test completed successfully');
    }, 15000); // Increase timeout to 15 seconds

    it('should handle parallel delegations without conflicts', async () => {
      // Set up mock provider to respond with different responses for parallel tasks
      mockProvider.setMockResponses(['Result 1', 'Result 2', 'Result 3']);

      // Create three separate delegate tool instances with same TaskManager
      const tool1 = new DelegateTool();
      const tool2 = new DelegateTool();
      const tool3 = new DelegateTool();

      // Inject TaskManager for each tool
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (tool1 as any).getTaskManager = () => session.getTaskManager();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (tool2 as any).getTaskManager = () => session.getTaskManager();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (tool3 as any).getTaskManager = () => session.getTaskManager();

      // Execute all three delegations in parallel
      const [result1, result2, result3] = await Promise.all([
        tool1.execute(
          {
            title: 'Task 1',
            prompt: 'First task',
            expected_response: 'Result 1',
            model: 'anthropic:claude-3-5-haiku-20241022',
          },
          context
        ),
        tool2.execute(
          {
            title: 'Task 2',
            prompt: 'Second task',
            expected_response: 'Result 2',
            model: 'anthropic:claude-3-5-haiku-20241022',
          },
          context
        ),
        tool3.execute(
          {
            title: 'Task 3',
            prompt: 'Third task',
            expected_response: 'Result 3',
            model: 'anthropic:claude-3-5-haiku-20241022',
          },
          context
        ),
      ]);

      // Assert all succeeded independently
      expect(result1.isError).toBe(false);
      expect(result2.isError).toBe(false);
      expect(result3.isError).toBe(false);

      expect(result1.content[0].text).toContain('Result 1');
      expect(result2.content[0].text).toContain('Result 2');
      expect(result3.content[0].text).toContain('Result 3');
    });

    it('should handle task failures gracefully', async () => {
      // Change the mock provider to simulate task blocking instead of completion
      mockProvider.createResponse = async (
        messages: ProviderMessage[],
        _tools: Tool[]
      ): Promise<ProviderResponse> => {
        // Look for task assignment message to extract task ID
        const taskAssignmentMessage = messages.find(
          (m) =>
            m.content &&
            typeof m.content === 'string' &&
            m.content.includes('You have been assigned task')
        );

        let taskId = 'unknown';
        if (taskAssignmentMessage && typeof taskAssignmentMessage.content === 'string') {
          const match = taskAssignmentMessage.content.match(/assigned task '([^']+)'/);
          if (match) {
            taskId = match[1];
          }
        }

        // Create a tool call to update task to blocked status instead of completing it
        const toolCall: ProviderToolCall = {
          id: 'task_update_call',
          name: 'task_update',
          input: {
            taskId: taskId,
            status: 'blocked',
          },
        };

        return Promise.resolve({
          content: `I encountered an issue and cannot complete this task.`,
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          toolCalls: [toolCall],
        });
      };

      const result = await delegateTool.execute(
        {
          title: 'This will be blocked',
          prompt: 'This task will fail',
          expected_response: 'Error',
          model: 'anthropic:claude-3-5-haiku-20241022',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('is blocked');
    });

    it('should require TaskManager for delegation', async () => {
      // Create a delegate tool without TaskManager injection
      const toolWithoutTaskManager = new DelegateTool();
      // Do NOT inject getTaskManager - it should remain undefined

      const result = await toolWithoutTaskManager.execute(
        {
          title: 'Test Task',
          prompt: 'This should fail',
          expected_response: 'Error',
          model: 'anthropic:claude-3-haiku',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('TaskManager is required for delegation');
    });
  });
});
