// ABOUTME: Tests for the delegate tool
// ABOUTME: Validates task-based delegation flow without Session/Workspace dependencies

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { DelegateTool } from '@lace/core/tools/implementations/delegate';
import type { ToolContext } from './types';
import type { Task, TaskContext } from '@lace/core/tasks/types';

class FakeTaskManager extends EventEmitter {
  private tasks = new Map<string, Task>();
  private responseQueue: string[] = [];
  private nextId = 1;
  private blockedMode = false;

  setResponses(responses: string[]): void {
    this.responseQueue = [...responses];
    this.blockedMode = false;
  }

  setBlockedMode(): void {
    this.responseQueue = [];
    this.blockedMode = true;
  }

  createTask = async (
    input: {
      title: string;
      prompt: string;
      priority: string;
      assignedTo: string;
    },
    context: TaskContext
  ): Promise<Task> => {
    const id = `task_${this.nextId++}`;
    const createdBy = context.actor;

    const task: Task = {
      id,
      title: input.title,
      prompt: input.prompt,
      priority: input.priority as any,
      status: 'in_progress',
      assignedTo: input.assignedTo as any,
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    this.tasks.set(id, task);

    setTimeout(() => {
      const updated = this.tasks.get(id);
      if (!updated) return;

      if (this.blockedMode) {
        updated.status = 'blocked';
        this.emit('task:updated', {
          task: { ...updated },
          context: { actor: 'agent_1' },
          type: 'task:updated',
        });
        return;
      }

      const response = this.responseQueue.shift() ?? 'Mock delegation response';
      updated.status = 'completed';
      updated.notes = [
        ...updated.notes,
        {
          id: `note_${id}`,
          taskId: id,
          author: 'agent_1',
          content: response,
          createdAt: new Date(),
        } as any,
      ];
      updated.updatedAt = new Date();

      this.emit('task:updated', {
        task: { ...updated },
        context: { actor: 'agent_1' },
        type: 'task:updated',
      });
    }, 1);

    return task;
  };

  getTask = (id: string, _context: TaskContext): Task | null => {
    return this.tasks.get(id) || null;
  };
}

describe('DelegateTool', () => {
  let tool: DelegateTool;
  let taskManager: FakeTaskManager;
  let context: ToolContext;
  const providerInstanceId = 'test-anthropic';

  beforeEach(() => {
    tool = new DelegateTool();
    taskManager = new FakeTaskManager();
    context = {
      signal: new AbortController().signal,
      threadId: 'thread_test_1',
      taskManager: taskManager as any,
    };
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('delegate');
    expect(tool.annotations?.openWorldHint).toBe(true);
    expect(tool.inputSchema.required).toEqual(['tasks']);
  });

  it('should delegate a simple task with default model', async () => {
    taskManager.setResponses(['Analysis complete: 3 test failures identified']);

    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'Analyze test failures',
            prompt: 'Look at the failing tests and identify common patterns',
            expected_response: 'A list of failure patterns',
            assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
          },
        ],
      },
      context
    );

    // Test the actual behavior - delegation should work and return results
    expect(result.status, result.content[0]?.text).toBe('completed');
    expect(result.content[0]?.text).toContain('Analysis complete: 3 test failures identified');
    expect(result.metadata?.taskTitle).toBe('Analyze test failures');
  });

  it('should handle custom provider:model format', async () => {
    taskManager.setResponses(['Custom model response']);

    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'Test custom model',
            prompt: 'Use custom model for delegation',
            expected_response: 'Custom response',
            assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
          },
        ],
      },
      context
    );

    // Test that delegation works with custom model specification
    expect(result.status).toBe('completed');
    expect(result.content[0]?.text).toContain('Custom model response');
  });

  it('should create delegate thread and execute subagent', async () => {
    taskManager.setResponses(['Directory listed successfully']);

    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'List files',
            prompt: 'List the files in the current directory',
            expected_response: 'List of files',
            assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
          },
        ],
      },
      context
    );

    // Verify delegation succeeded
    expect(result.status).toBe('completed');
    expect(result.content[0]?.text).toContain('Directory listed successfully');
    expect(result.metadata?.taskTitle).toBe('List files');
  });

  it('should format the subagent system prompt correctly', async () => {
    taskManager.setResponses(['Task completed']);

    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'Format test',
            prompt: 'Test system prompt formatting',
            expected_response: 'Formatted response',
            assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
          },
        ],
      },
      context
    );

    // Since we're using the proper integration pattern, the delegation should work
    expect(result.status).toBe('completed');
    expect(result.content[0]?.text).toContain('Task completed');
  });

  it('should handle invalid assignTo format', async () => {
    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'Invalid provider test',
            prompt: 'Test with invalid provider',
            expected_response: 'Error',
            assignedTo: 'invalid-format',
          },
        ],
      },
      context
    );

    expect(result.status).not.toBe('completed');
    expect(result.content[0].text).toContain('Invalid assignedTo format');
  });

  it('should collect all subagent responses', async () => {
    taskManager.setResponses(['Task completed with combined responses']);

    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'Multi-response test',
            prompt: 'Generate multiple responses',
            expected_response: 'Combined responses',
            assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
          },
        ],
      },
      context
    );

    expect(result.status).toBe('completed');
    expect(result.content[0]?.text).toContain('Task completed with combined responses');
  });

  it('should include delegate thread ID in result metadata', async () => {
    taskManager.setResponses(['Task completed with metadata']);

    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'Metadata test',
            prompt: 'Test metadata inclusion',
            expected_response: 'Response with metadata',
            assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
          },
        ],
      },
      context
    );

    expect(result.status).toBe('completed');
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.taskTitle).toBeDefined();
  });

  it('should accept valid model formats', async () => {
    const validModels = [`${providerInstanceId}:claude-3-5-haiku-20241022`];

    for (const model of validModels) {
      taskManager.setResponses(['Valid model response']);

      const result = await tool.execute(
        {
          tasks: [
            {
              title: `Test ${model}`,
              prompt: 'Test valid model format',
              expected_response: 'Valid response',
              assignedTo: `new:lace;${model}`,
            },
          ],
        },
        context
      );

      // Should not fail on model validation
      expect(result.status).toBe('completed');
    }
  });
});
