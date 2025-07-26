// ABOUTME: Tests for bulk task creation functionality in TaskCreateTool
// ABOUTME: Validates both single task and bulk task creation scenarios with proper validation

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskCreateTool } from '~/tools/implementations/task-manager/tools';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

describe('Bulk Task Creation', () => {
  let tool: TaskCreateTool;
  let session: Session;
  let project: Project;

  beforeEach(() => {
    setupTestPersistence();

    // Create session with TaskManager like real usage
    project = Project.create('Test Project', '/tmp/test-bulk-tasks');

    session = Session.create({
      name: 'Bulk Test Session',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      projectId: project.getId(),
    });

    // Get tool with proper TaskManager injection
    tool = new TaskCreateTool();
    const taskManager = session.getTaskManager();
    const taskTool = tool as unknown as {
      getTaskManager?: () => import('~/tasks/task-manager').TaskManager;
    };
    taskTool.getTaskManager = () => taskManager;
  });

  afterEach(() => {
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
    expect(result.content[0].text).toContain('maximum');
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
