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
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ProviderRegistry } from '~/providers/registry';

// Mock provider for testing delegation
class MockProvider extends BaseMockProvider {
  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return Promise.resolve({
      content: 'Mock delegation response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
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
      } as ProviderRegistry;
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
    it('should create task and wait for completion via events', async () => {
      const taskManager = session.getTaskManager();
      let createdTaskId: string;

      // Listen for task creation to capture the task ID
      taskManager.on('task:created', (event: { task: { id: string } }) => {
        createdTaskId = event.task.id;

        // Simulate task completion after a short delay
        setTimeout(() => {
          taskManager.emit('task:updated', {
            task: {
              id: createdTaskId,
              status: 'completed',
              notes: [
                {
                  id: 'completion_note',
                  author: 'mock_agent',
                  content: 'Task completed successfully',
                  timestamp: new Date(),
                },
              ],
            },
            creatorThreadId: context.threadId,
          });
        }, 100);
      });

      const result = await delegateTool.execute(
        {
          title: 'Integration Test Task',
          prompt: 'Complete this integration test',
          expected_response: 'Test completed successfully',
          model: 'anthropic:claude-3-haiku',
        },
        context
      );

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Task completed successfully');
    });

    it('should handle parallel delegations without conflicts', async () => {
      const taskManager = session.getTaskManager();

      // Track task creation and simulate completion for each
      taskManager.on('task:created', (event: { task: { id: string; title: string } }) => {
        const task = event.task;

        // Simulate completion with different responses based on task title
        setTimeout(
          () => {
            let response = 'Default response';
            if (task.title.includes('Task 1')) response = 'Result 1';
            else if (task.title.includes('Task 2')) response = 'Result 2';
            else if (task.title.includes('Task 3')) response = 'Result 3';

            taskManager.emit('task:updated', {
              task: {
                id: task.id,
                status: 'completed',
                notes: [
                  {
                    id: `note_${task.id}`,
                    author: 'mock_agent',
                    content: response,
                    timestamp: new Date(),
                  },
                ],
              },
              creatorThreadId: context.threadId,
            });
          },
          50 + Math.random() * 100
        ); // Stagger completions
      });

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
            model: 'anthropic:claude-3-haiku',
          },
          context
        ),
        tool2.execute(
          {
            title: 'Task 2',
            prompt: 'Second task',
            expected_response: 'Result 2',
            model: 'anthropic:claude-3-haiku',
          },
          context
        ),
        tool3.execute(
          {
            title: 'Task 3',
            prompt: 'Third task',
            expected_response: 'Result 3',
            model: 'anthropic:claude-3-haiku',
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
      const taskManager = session.getTaskManager();
      let createdTaskId: string;

      // Listen for task creation and simulate task being blocked
      taskManager.on('task:created', (event: { task: { id: string } }) => {
        createdTaskId = event.task.id;

        // Simulate task getting blocked
        setTimeout(() => {
          taskManager.emit('task:updated', {
            task: {
              id: createdTaskId,
              status: 'blocked',
              notes: [],
            },
            creatorThreadId: context.threadId,
          });
        }, 100);
      });

      const result = await delegateTool.execute(
        {
          title: 'This will be blocked',
          prompt: 'This task will fail',
          expected_response: 'Error',
          model: 'anthropic:claude-3-haiku',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(`Task ${createdTaskId} is blocked`);
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
