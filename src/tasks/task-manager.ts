// ABOUTME: Core task management system for session-scoped task operations
// ABOUTME: Provides CRUD operations, filtering, and note management for tasks

import { DatabasePersistence } from '~/persistence/database';
import {
  Task,
  TaskNote,
  CreateTaskRequest,
  TaskFilters,
  TaskContext,
  TaskSummary,
} from '~/tasks/types';
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

  async addNote(taskId: string, content: string, context: TaskContext): Promise<TaskNote> {
    // Verify task exists and belongs to this session
    const task = this.getTaskById(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Create note without ID (database will assign it)
    const noteData = {
      author: asThreadId(context.actor),
      content: content.trim(),
      timestamp: new Date(),
    };

    // Save to database
    await this.persistence.addNote(taskId, noteData);

    // Update task timestamp
    await this.updateTask(taskId, { updatedAt: new Date() }, context);

    // Reload task to get the note with its database-assigned ID
    const updatedTask = this.getTaskById(taskId);
    const newNote = updatedTask?.notes[updatedTask.notes.length - 1];

    if (!newNote) {
      throw new Error('Failed to retrieve created note');
    }

    return newNote;
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
}
