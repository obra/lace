// ABOUTME: Task formatter utility for displaying tasks in CLI-friendly format
// ABOUTME: Provides formatting for task lists and individual tasks with various display options

import { Task } from '~/tools/implementations/task-manager/types';
import { ThreadId, AssigneeId } from '~/threads/types';

export interface FormatOptions {
  showAssignee?: boolean;
  showNotes?: boolean;
  groupBy?: 'status' | 'assignee' | 'priority';
  threadMetadata?: Map<ThreadId, { displayName?: string }>;
}

export class TaskFormatter {
  static formatTaskList(tasks: Task[], options?: FormatOptions): string {
    if (tasks.length === 0) {
      return 'No tasks found';
    }

    const opts = options || {};

    if (opts.groupBy) {
      return this.formatGroupedTasks(tasks, opts);
    }

    return this.formatFlatTasks(tasks, opts);
  }

  private static formatFlatTasks(tasks: Task[], options: FormatOptions): string {
    const lines: string[] = [];

    for (const task of tasks) {
      lines.push(this.formatTaskLine(task, options));
    }

    return lines.join('\n');
  }

  private static formatGroupedTasks(tasks: Task[], options: FormatOptions): string {
    const lines: string[] = [];
    const groups = new Map<string, Task[]>();

    // Group tasks
    for (const task of tasks) {
      let groupKey: string;
      switch (options.groupBy) {
        case 'status':
          groupKey = task.status;
          break;
        case 'priority':
          groupKey = task.priority;
          break;
        case 'assignee':
          groupKey = task.assignedTo || 'unassigned';
          break;
        default:
          groupKey = 'all';
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(task);
    }

    // Sort groups
    const sortedGroups = Array.from(groups.entries());
    if (options.groupBy === 'priority') {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      sortedGroups.sort((a, b) => {
        const aPriority = priorityOrder[a[0] as keyof typeof priorityOrder] ?? 999;
        const bPriority = priorityOrder[b[0] as keyof typeof priorityOrder] ?? 999;
        return aPriority - bPriority;
      });
    } else if (options.groupBy === 'status') {
      const statusOrder = { pending: 0, in_progress: 1, blocked: 2, completed: 3 };
      sortedGroups.sort((a, b) => {
        const aStatus = statusOrder[a[0] as keyof typeof statusOrder] ?? 999;
        const bStatus = statusOrder[b[0] as keyof typeof statusOrder] ?? 999;
        return aStatus - bStatus;
      });
    } else {
      sortedGroups.sort((a, b) => a[0].localeCompare(b[0]));
    }

    // Format groups
    for (const [groupKey, groupTasks] of sortedGroups) {
      lines.push(''); // Empty line before group

      // Format group header
      let header: string;
      if (options.groupBy === 'priority') {
        header = `## ${groupKey.charAt(0).toUpperCase() + groupKey.slice(1)} Priority`;
      } else if (options.groupBy === 'status') {
        header = `## Status: ${groupKey}`;
      } else {
        header = `## Assignee: ${this.formatAssignee(groupKey as AssigneeId, options.threadMetadata)}`;
      }

      lines.push(header);
      lines.push('');

      // Add tasks in group
      for (const task of groupTasks) {
        lines.push(this.formatTaskLine(task, options));
      }
    }

    return lines.join('\n').trim();
  }

  private static formatTaskLine(task: Task, options: FormatOptions): string {
    const status = this.getStatusIcon(task.status);
    let line = `${status} ${task.id} [${task.priority}] ${task.title}`;

    if (options.showAssignee && task.assignedTo) {
      line += ` → ${this.formatAssignee(task.assignedTo, options.threadMetadata)}`;
    }

    if (task.status !== 'pending' && task.status !== 'completed') {
      line += ` [${task.status}]`;
    }

    if (options.showNotes && task.notes.length > 0) {
      line += ` (${task.notes.length} note${task.notes.length === 1 ? '' : 's'})`;
    }

    return line;
  }

  static formatTask(task: Task, detailed?: boolean): string {
    const lines: string[] = [];

    // Basic info
    lines.push(`Task: ${task.id}`);
    lines.push(`Title: ${task.title}`);
    lines.push(`Status: ${this.getStatusIcon(task.status)} ${task.status}`);
    lines.push(`Priority: ${task.priority}`);

    if (detailed) {
      if (task.description) {
        lines.push(`\nDescription: ${task.description}`);
      }

      lines.push(`\nPrompt:\n${task.prompt}`);

      lines.push(`\nCreated by: ${task.createdBy}`);
      lines.push(`Created at: ${task.createdAt.toLocaleDateString()}`);
      lines.push(`Updated at: ${task.updatedAt.toLocaleDateString()}`);

      if (task.assignedTo) {
        lines.push(`\nAssigned to: ${this.formatAssignee(task.assignedTo)}`);
      }

      if (task.notes.length > 0) {
        lines.push('\nNotes:');
        task.notes.forEach((note, i) => {
          lines.push(`  ${i + 1}. [${note.author}] ${note.timestamp.toLocaleString()}`);
          lines.push(`     ${note.content}`);
        });
      }
    }

    return lines.join('\n');
  }

  private static getStatusIcon(status: Task['status']): string {
    switch (status) {
      case 'pending':
        return '○';
      case 'in_progress':
        return '◐';
      case 'completed':
        return '✓';
      case 'blocked':
        return '⊗';
    }
  }

  // Make this protected instead of private so tests can access it
  protected static formatAssignee(
    assignee: AssigneeId,
    metadata?: Map<ThreadId, { displayName?: string }>
  ): string {
    // Handle "new:provider/model" format
    if (assignee.startsWith('new:')) {
      return assignee;
    }

    const threadId = assignee as ThreadId;
    const displayName = metadata?.get(threadId)?.displayName;

    if (displayName) {
      return displayName;
    }

    // Extract last part of hierarchical thread ID
    const parts = threadId.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : threadId;
  }
}
