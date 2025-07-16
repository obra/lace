// ABOUTME: Core task management system for session-scoped task operations
// ABOUTME: Provides CRUD operations, filtering, and note management for tasks

import { DatabasePersistence } from '~/persistence/database';
import { Task, CreateTaskRequest, TaskFilters, TaskContext, TaskSummary } from '~/tasks/types';
import { ThreadId, AssigneeId, asThreadId } from '~/threads/types';

export class TaskManager {
  constructor(
    private sessionId: ThreadId,
    private persistence: DatabasePersistence
  ) {}

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
      createdBy: asThreadId(context.actor),
      threadId: this.sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    // Save to database
    await this.persistence.saveTask(task);

    return task;
  }

  getTasks(filters?: TaskFilters): Task[] {
    // Get all tasks for this session
    let tasks = this.persistence.loadTasksByThread(this.sessionId);

    // Apply filters
    if (filters) {
      if (filters.status) {
        tasks = tasks.filter((task) => task.status === filters.status);
      }
      if (filters.priority) {
        tasks = tasks.filter((task) => task.priority === filters.priority);
      }
      if (filters.assignedTo) {
        tasks = tasks.filter((task) => task.assignedTo === filters.assignedTo);
      }
      if (filters.createdBy) {
        tasks = tasks.filter((task) => task.createdBy === filters.createdBy);
      }
    }

    // Sort by creation date (newest first)
    return tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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

  async updateTask(taskId: string, updates: Partial<Task>, _context: TaskContext): Promise<Task> {
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

    // Save to database
    await this.persistence.updateTask(taskId, updates);

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
      author: asThreadId(context.actor),
      content: noteContent.trim(),
      timestamp: new Date(),
    };

    // Save to database
    await this.persistence.addNote(taskId, noteData);

    // Update task timestamp
    await this.updateTask(taskId, { updatedAt: new Date() }, context);
  }

  deleteTask(taskId: string, _context: TaskContext): void {
    // Verify task exists and belongs to this session
    const task = this.getTaskById(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Delete from database
    // TODO: Implement deleteTask in DatabasePersistence
    throw new Error('Delete not implemented yet');
  }

  getTaskSummary(): TaskSummary {
    const tasks = this.getTasks();

    const summary: TaskSummary = {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
    };

    return summary;
  }

  private generateTaskId(): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 8);
    return `task_${dateStr}_${random}`;
  }

  private generateNoteId(): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 8);
    return `note_${dateStr}_${random}`;
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
          .filter((t) => t.threadId === this.sessionId);
        break;

      case 'created':
        // Tasks created by the actor in this session
        tasks = this.persistence
          .loadTasksByThread(this.sessionId)
          .filter((t) => t.createdBy === context.actor);
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
}
