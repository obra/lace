// ABOUTME: Tests for bulk task creation feature in TaskCreateTool
// ABOUTME: Validates both single task and tasks array formats with proper validation

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskCreateTool } from '~/tools/implementations/task-manager/tools';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';

describe('Bulk Task Creation', () => {
  const _tempLaceDir = setupCoreTest();
  let tool: TaskCreateTool;
  let session: Session;
  let project: Project;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create real provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create session with TaskManager like real usage
    project = Project.create('Test Project', 'Test project description', '/tmp/test-bulk-tasks', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    session = Session.create({
      name: 'Bulk Test Session',
      projectId: project.getId(),
      configuration: {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      },
    });

    // Create tool that gets TaskManager from context
    tool = new TaskCreateTool();
  });

  afterEach(async () => {
    session?.destroy();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
    // Test cleanup handled by setupCoreTest
    cleanupTestProviderDefaults();
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
      {
        threadId: session.getId(),
        session, // TaskManager is accessed via session.getTaskManager()
      }
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
      {
        threadId: session.getId(),
        session, // TaskManager is accessed via session.getTaskManager()
      }
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
      {
        threadId: session.getId(),
        session, // TaskManager is accessed via session.getTaskManager()
      }
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot create more than 20 tasks at once');
  });

  it('should handle single task in array', async () => {
    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'Single Task',
            prompt: 'Single task prompt',
            priority: 'medium' as const,
          },
        ],
      },
      {
        threadId: session.getId(),
        session, // TaskManager is accessed via session.getTaskManager()
      }
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Created task');
    expect(result.content[0].text).toContain('Single Task');
  });

  it('should validate all assignees before creating any tasks', async () => {
    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'Valid Task',
            prompt: 'This task has valid assignment',
            priority: 'medium' as const,
            assignedTo: 'new:anthropic/claude-3-5-haiku-20241022',
          },
          {
            title: 'Invalid Task',
            prompt: 'This task has invalid assignment',
            priority: 'medium' as const,
            assignedTo: 'invalid-format',
          },
        ],
      },
      {
        threadId: session.getId(),
        session, // TaskManager is accessed via session.getTaskManager()
      }
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid assignee format');
  });

  it('should create tasks with mixed priorities and assignments', async () => {
    const result = await tool.execute(
      {
        tasks: [
          {
            title: 'High Priority Task',
            prompt: 'Urgent work needed',
            priority: 'high' as const,
          },
          {
            title: 'Delegated Task',
            prompt: 'Work for subagent',
            priority: 'medium' as const,
            assignedTo: session.getId(), // Assign to current session instead of spawning agent
          },
          {
            title: 'Low Priority Task',
            prompt: 'Can wait',
            priority: 'low' as const,
            description: 'Optional task with description',
          },
        ],
      },
      {
        threadId: session.getId(),
        session, // TaskManager is accessed via session.getTaskManager()
      }
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Created 3 tasks');
    expect(result.content[0].text).toContain('High Priority Task');
    expect(result.content[0].text).toContain(`Delegated Task → ${session.getId()}`);
    expect(result.content[0].text).toContain('Low Priority Task');
  });
});
