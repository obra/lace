// ABOUTME: Core task management system for session-scoped task operations
// ABOUTME: Provides CRUD operations, filtering, and note management for tasks

import { EventEmitter } from 'events';
import { DatabasePersistence } from '~/persistence/database';
import { Task, CreateTaskRequest, TaskFilters, TaskContext, TaskSummary } from '~/tasks/types';
import { ThreadId, AssigneeId, isNewAgentSpec, parseNewAgentSpec } from '~/threads/types';
import { logger } from '~/utils/logger';

// Type for agent creation callback
export type AgentCreationCallback = (
  persona: string,
  provider: string,
  model: string,
  task: Task
) => Promise<ThreadId>;

export class TaskManager extends EventEmitter {
  private instanceId: string;

  constructor(
    private sessionId: ThreadId,
    private persistence: DatabasePersistence,
    private createAgent?: AgentCreationCallback
  ) {
    super();
    this.instanceId = Math.random().toString(36).substring(2, 8);
    logger.debug('TaskManager created', { sessionId, instanceId: this.instanceId });
  }

  setAgentCreationCallback(callback: AgentCreationCallback): void {
    this.createAgent = callback;
  }

  async createTask(request: CreateTaskRequest, context: TaskContext): Promise<Task> {
    // Validate request
    if (!request.title?.trim() || !request.prompt?.trim()) {
      throw new Error('Title and prompt are required');
    }

    // Generate task ID
    const taskId = this.generateTaskId();

    // Create task object
    const task: Task = {
      id: taskId,
      title: request.title.trim(),
      description: request.description?.trim() || '',
      prompt: request.prompt.trim(),
      status: 'pending',
      priority: request.priority || 'medium',
      assignedTo: request.assignedTo as AssigneeId | undefined,
      createdBy: context.actor,
      threadId: this.sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    // Handle agent spawning if assigned to "new:persona:provider/model"
    if (task.assignedTo && isNewAgentSpec(task.assignedTo)) {
      await this.handleAgentSpawning(task);
    }

    // Save to database
    await this.persistence.saveTask(task);

    // Emit event for real-time updates
    this.emit('task:created', {
      type: 'task:created',
      task,
      context,
      timestamp: new Date(),
    });

    return task;
  }

  getTasks(filters?: TaskFilters): Task[] {
    // Get all tasks for this session
    let tasks = this.persistence.loadTasksByThread(this.sessionId);

    // Apply filters
    if (filters) {
      if (filters.status) {
        tasks = tasks.filter((task: Task) => task.status === filters.status);
      }
      if (filters.priority) {
        tasks = tasks.filter((task: Task) => task.priority === filters.priority);
      }
      if (filters.assignedTo) {
        tasks = tasks.filter((task: Task) => task.assignedTo === filters.assignedTo);
      }
      if (filters.createdBy) {
        tasks = tasks.filter((task: Task) => task.createdBy === filters.createdBy);
      }
    }

    // Sort by creation date (newest first)
    return tasks.sort((a: Task, b: Task) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getTaskById(taskId: string): Task | null {
    const task = this.persistence.loadTask(taskId);

    // Verify task belongs to this session
    if (task && task.threadId === this.sessionId) {
      // Notes are already loaded by loadTask
      return task;
    }

    return null;
  }

  async updateTask(taskId: string, updates: Partial<Task>, context: TaskContext): Promise<Task> {
    // Load existing task
    const existingTask = this.getTaskById(taskId);
    if (!existingTask) {
      throw new Error('Task not found');
    }

    // Apply updates
    const updatedTask: Task = {
      ...existingTask,
      ...updates,
      id: existingTask.id, // Prevent ID changes
      threadId: existingTask.threadId, // Prevent thread changes
      createdBy: existingTask.createdBy, // Prevent creator changes
      createdAt: existingTask.createdAt, // Prevent creation date changes
      updatedAt: new Date(),
      notes: existingTask.notes, // Preserve notes
    };

    // Handle agent spawning if assignedTo is being updated to "new:persona:provider/model"
    if (updates.assignedTo && isNewAgentSpec(updates.assignedTo)) {
      await this.handleAgentSpawning(updatedTask);
      // handleAgentSpawning modifies updatedTask.assignedTo to the spawned agent thread ID
      // Update our database with the final task state including the spawned agent assignment
      await this.persistence.updateTask(taskId, {
        ...updates,
        assignedTo: updatedTask.assignedTo,
        status: updatedTask.status,
        updatedAt: updatedTask.updatedAt,
      });
    } else {
      // Save to database with original updates
      await this.persistence.updateTask(taskId, updates);
    }

    // Emit event for real-time updates
    logger.debug('TaskManager emitting task:updated event', {
      instanceId: this.instanceId,
      taskId: updatedTask.id,
      status: updatedTask.status,
      actor: context.actor,
    });

    this.emit('task:updated', {
      type: 'task:updated',
      task: updatedTask,
      context,
      timestamp: new Date(),
    });

    return updatedTask;
  }

  async addNote(taskId: string, noteContent: string, context: TaskContext): Promise<void> {
    // Verify task exists and belongs to this session
    const task = this.getTaskById(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Create note without ID (database will assign it)
    const noteData = {
      author: context.actor,
      content: noteContent.trim(),
      timestamp: new Date(),
    };

    // Save to database
    await this.persistence.addNote(taskId, noteData);

    // Get updated task with new note
    const updatedTask = this.getTaskById(taskId);
    if (updatedTask) {
      // Emit event for real-time updates
      this.emit('task:note_added', {
        type: 'task:note_added',
        task: updatedTask,
        context,
        timestamp: new Date(),
      });
    }

    // Update task timestamp
    await this.updateTask(taskId, { updatedAt: new Date() }, context);
  }

  async deleteTask(taskId: string, context: TaskContext): Promise<void> {
    // Verify task exists and belongs to this session
    const task = this.getTaskById(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Delete from database
    await this.persistence.deleteTask(taskId);

    // Emit event for real-time updates
    this.emit('task:deleted', {
      type: 'task:deleted',
      taskId,
      task,
      context,
      timestamp: new Date(),
    });
  }

  getTaskSummary(): TaskSummary {
    const tasks = this.getTasks();

    const summary: TaskSummary = {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
      archived: tasks.filter((t) => t.status === 'archived').length,
    };

    return summary;
  }

  private generateTaskId(): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 8);
    return `task_${dateStr}_${random}`;
  }

  getTask(taskId: string, _context: TaskContext): Task | null {
    return this.getTaskById(taskId);
  }

  listTasks(
    filter: 'mine' | 'created' | 'thread' | 'all',
    includeCompleted: boolean,
    context: TaskContext
  ): Task[] {
    let tasks: Task[] = [];

    switch (filter) {
      case 'mine':
        // Tasks assigned to the actor
        tasks = this.persistence
          .loadTasksByAssignee(context.actor as AssigneeId)
          .filter((t: Task) => t.threadId === this.sessionId);
        break;

      case 'created':
        // Tasks created by the actor in this session
        tasks = this.persistence
          .loadTasksByThread(this.sessionId)
          .filter((t: Task) => t.createdBy === context.actor);
        break;

      case 'thread':
      case 'all':
        // All tasks in this session
        tasks = this.persistence.loadTasksByThread(this.sessionId);
        break;
    }

    // Filter completed if needed
    if (!includeCompleted) {
      tasks = tasks.filter((t) => t.status !== 'completed');
    }

    // Sort by priority and creation date
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    tasks.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return tasks;
  }

  /**
   * Handle agent spawning for tasks assigned to "new:persona:provider/model"
   * Updates the task's assignedTo field with the actual agent thread ID
   */
  private async handleAgentSpawning(task: Task): Promise<void> {
    if (!task.assignedTo || !isNewAgentSpec(task.assignedTo)) {
      return;
    }

    if (!this.createAgent) {
      throw new Error('Agent creation callback not provided - cannot spawn agents');
    }

    // Parse "new:persona:provider/model" format using proper parser
    const parsed = parseNewAgentSpec(task.assignedTo);
    const { persona, provider, model } = parsed;

    try {
      // Create the agent and get its thread ID
      const agentThreadId = await this.createAgent(persona, provider, model, task);

      // Update the task assignment to the actual thread ID
      task.assignedTo = agentThreadId;

      // Update status to in_progress since we now have an assigned agent
      task.status = 'in_progress';
      task.updatedAt = new Date();

      // Emit agent spawning event
      this.emit('agent:spawned', {
        type: 'agent:spawned',
        taskId: task.id,
        agentThreadId,
        provider,
        model,
        timestamp: new Date(),
      });
    } catch (error) {
      // If agent creation fails, keep task as pending with original assignment
      throw new Error(
        `Failed to spawn agent for task ${task.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
