// ABOUTME: Tests for bulk task creation functionality in TaskCreateTool
// ABOUTME: Validates both single task and bulk task creation scenarios with proper validation

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskCreateTool } from '~/tools/implementations/task-manager/tools';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ProviderRegistry } from '~/providers/registry';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock provider for testing
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
      content: 'Mock response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });
  }
}

describe('Bulk Task Creation', () => {
  let tool: TaskCreateTool;
  let session: Session;
  let project: Project;
  let mockProvider: MockProvider;

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
    project = Project.create('Test Project', '/tmp/test-bulk-tasks');

    // Create session with anthropic - the provider will be mocked
    session = Session.create({
      name: 'Bulk Test Session',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      projectId: project.getId(),
    });

    // Get tool from session agent's toolExecutor
    const agent = session.getAgent(session.getId());
    const toolExecutor = agent!.toolExecutor;
    tool = toolExecutor.getTool('task_add') as TaskCreateTool;
  });

  afterEach(() => {
    vi.clearAllMocks();
    session?.destroy();
    teardownTestPersistence();
  });

  it('should create multiple tasks from tasks array', async () => {
    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'Task 1',
            prompt: 'First task prompt',
            priority: 'high' as const,
          },
          {
            title: 'Task 2',
            prompt: 'Second task prompt',
            priority: 'medium' as const,
          },
          {
            title: 'Task 3',
            prompt: 'Third task prompt',
            priority: 'low' as const,
          },
        ],
      },
      { threadId: session.getId() }
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Created 3 tasks');
    expect(result.content[0].text).toContain('Task 1');
    expect(result.content[0].text).toContain('Task 2');
    expect(result.content[0].text).toContain('Task 3');
  });

  it('should validate minimum 1 task in array', async () => {
    const result = await tool.execute(
      {
        tasks: [],
      },
      { threadId: session.getId() }
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('at least 1');
  });

  it('should validate maximum 20 tasks in array', async () => {
    const tasks = Array.from({ length: 21 }, (_, i) => ({
      title: `Task ${i + 1}`,
      prompt: `Prompt ${i + 1}`,
      priority: 'medium' as const,
    }));

    const result = await tool.execute(
      {
        tasks,
      },
      { threadId: session.getId() }
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot create more than 20 tasks');
  });

  it('should handle single task object (backward compatibility)', async () => {
    const result = await tool.execute(
      {
        title: 'Single Task',
        prompt: 'Single task prompt',
        priority: 'medium' as const,
      },
      { threadId: session.getId() }
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Created task');
    expect(result.content[0].text).toContain('Single Task');
  });
});
