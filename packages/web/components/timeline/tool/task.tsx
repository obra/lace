'use client';

// ABOUTME: Task tool renderers implementation with beautiful, fluent UI components
// ABOUTME: Provides custom display logic for all task management operations

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faClipboardList,
  faPlus,
  faCheck,
  faEdit,
  faStickyNote,
  faEye,
  faExclamationTriangle,
  faClock,
  faFlag,
  faUser,
  faArrowRight,
} from '@fortawesome/free-solid-svg-icons';
import type { ToolRenderer, ToolResult } from '@/components/timeline/tool/types';
import type { ToolAggregatedEventData } from '@/types/web-events';
import type { Task } from '@/types/core';
import { Badge } from '@/components/ui';
import { Alert } from '@/components/ui/Alert';
import InlineCode from '@/components/ui/InlineCode';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';

/**
 * Priority badge component using design system Badge
 */
const PriorityBadge: React.FC<{ priority: string }> = ({ priority }) => {
  const getVariant = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'info';
      default:
        return 'warning';
    }
  };

  return (
    <Badge variant={getVariant(priority)} size="xs">
      {priority}
    </Badge>
  );
};

/**
 * Status badge component using design system Badge
 */
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getVariant = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'in_progress':
        return 'primary';
      case 'cancelled':
        return 'outline';
      case 'failed':
        return 'error';
      case 'aborted':
        return 'warning';
      case 'denied':
        return 'outline';
      default:
        return 'default';
    }
  };

  return (
    <Badge variant={getVariant(status)} size="xs">
      {status.replaceAll('_', ' ')}
    </Badge>
  );
};

/**
 * Parse structured tool result content
 */
function parseToolResult(result: ToolResult): unknown {
  if (!result.content || result.content.length === 0) return null;

  const rawOutput = result.content.map((block) => block.text || '').join('');

  try {
    return JSON.parse(rawOutput);
  } catch {
    return rawOutput;
  }
}

/**
 * Task Add Tool Renderer - Create new tasks
 */
const taskAddRenderer: ToolRenderer = {
  getDisplayName: (toolName: string, result?: ToolResult): string => {
    if (!result) {
      return 'Creating task';
    }

    if (result.status !== 'completed') {
      return 'Failed to create task';
    }

    const parsed = parseToolResult(result);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      return 'Failed to create task';
    }

    return 'Created task';
  },

  getSummary: (args: unknown): string => {
    // Handle array-based args (main branch schema)
    if (typeof args === 'object' && args !== null && 'tasks' in args) {
      const tasks = (args as { tasks?: Array<{ title?: string }> }).tasks;
      if (Array.isArray(tasks) && tasks.length > 0) {
        if (tasks.length === 1) {
          return tasks[0].title || 'New task';
        } else {
          return `Create ${tasks.length} tasks`;
        }
      }
    }
    // Handle single task args (backwards compatibility)
    if (typeof args === 'object' && args !== null && 'title' in args) {
      const title = (args as { title?: string }).title;
      if (typeof title === 'string') {
        return title;
      }
    }
    return 'New task';
  },

  isError: (result: ToolResult): boolean => {
    if (result.status !== 'completed') return true;

    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    const parsed = parseToolResult(result);

    // Handle errors only
    if (
      result.status !== 'completed' ||
      (typeof parsed === 'object' && parsed !== null && 'error' in parsed)
    ) {
      const error = parsed as { error: string; code?: string };
      return (
        <Alert
          variant="error"
          title="Failed to create task"
          description={error?.error || 'Unknown error'}
          className="mt-2"
        >
          {error?.code && <div className="text-sm opacity-60">Code: {error.code}</div>}
        </Alert>
      );
    }

    // Success case - get task data from result metadata (structured data from task tools)
    const resultMetadata = result.metadata as { task?: Task; tasks?: Task[] } | undefined;

    // Handle single task metadata
    const singleTask = resultMetadata?.task;
    if (singleTask && singleTask.id) {
      return (
        <div className="p-3">
          <a
            href={`#/tasks/${singleTask.id}`}
            className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 hover:underline"
          >
            <FontAwesomeIcon icon={faEye} className="w-4 h-4" />
            View task
          </a>
        </div>
      );
    }

    // Handle multiple tasks metadata (array-based)
    const multipleTasks = resultMetadata?.tasks;
    if (Array.isArray(multipleTasks) && multipleTasks.length > 0) {
      return (
        <div className="p-3 space-y-2">
          {multipleTasks.map((task, index) => (
            <a
              key={task.id || index}
              href={`#/tasks/${task.id}`}
              className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 hover:underline block"
            >
              <FontAwesomeIcon icon={faEye} className="w-4 h-4" />
              View task: {task.title || task.id}
            </a>
          ))}
        </div>
      );
    }

    // Fallback: try to extract from parsed text (backwards compatibility)
    const task = parsed as { taskId?: string; title?: string; id?: string };
    const taskId = task.taskId || task.id;

    if (taskId) {
      return (
        <div className="p-3">
          <a
            href={`#/tasks/${taskId}`}
            className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 hover:underline"
          >
            <FontAwesomeIcon icon={faEye} className="w-4 h-4" />
            View task
          </a>
        </div>
      );
    }

    // Fallback: No task data found
    return <Alert variant="warning" title="No task metadata found" className="mt-2" style="soft" />;
  },

  getIcon: () => faPlus,
};

/**
 * Task List Tool Renderer - List and filter tasks
 */
const taskListRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'filter' in args) {
      const filter = (args as { filter?: unknown }).filter;
      if (typeof filter === 'string') {
        const filterNames = {
          mine: 'my tasks',
          created: 'created tasks',
          thread: 'thread tasks',
          all: 'all tasks',
        };
        return `List ${filterNames[filter as keyof typeof filterNames] || 'tasks'}`;
      }
    }
    return 'List tasks';
  },

  isError: (result: ToolResult): boolean => {
    if (result.status !== 'completed') return true;

    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    const parsed = parseToolResult(result);

    // Handle errors first
    if (
      result.status !== 'completed' ||
      (typeof parsed === 'object' && parsed !== null && 'error' in parsed)
    ) {
      const error = parsed as { error: string };
      return (
        <Alert
          variant="error"
          title="Failed to list tasks"
          description={error?.error || 'Unknown error'}
          className="mt-2"
        />
      );
    }

    // Get tasks from metadata (structured data from task tools)
    const resultMetadata = result.metadata as { tasks?: Task[] } | undefined;
    const tasks = resultMetadata?.tasks;

    if (!tasks || tasks.length === 0) {
      return (
        <div className="bg-base-100 border border-base-300 rounded-lg p-4 text-center">
          <div className="text-base-content/50 text-sm">No tasks found</div>
        </div>
      );
    }

    return (
      <div className="bg-base-100 border border-base-300 rounded-lg">
        <div className="p-3 border-b border-base-300 bg-base-200/50">
          <div className="flex items-center gap-2 text-sm font-medium text-base-content">
            <FontAwesomeIcon icon={faClipboardList} className="w-4 h-4" />
            {tasks.length} tasks
          </div>
        </div>

        <div className="divide-y divide-base-300">
          {tasks.map((task, index) => (
            <div key={task.id || index} className="p-4 hover:bg-base-50">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-base-content truncate">{task.title}</div>
                  <div className="text-xs text-base-content/60 font-mono mt-1">{task.id}</div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <StatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                </div>
              </div>

              {task.assignedTo && (
                <div className="flex items-center gap-1 mt-2 text-xs text-base-content/60">
                  <FontAwesomeIcon icon={faUser} className="w-3 h-3" />
                  {task.assignedTo}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  },

  getIcon: () => faClipboardList,
};

/**
 * Task Complete Tool Renderer - Mark tasks as completed
 */
const taskCompleteRenderer: ToolRenderer = {
  getDisplayName: (toolName: string, result?: ToolResult): string => {
    return 'Completed task';
  },

  getSummary: (args: unknown, result?: ToolResult): string => {
    // Extract task title from result content
    if (result?.content && result.content.length > 0) {
      const textContent = result.content
        .map((block) => block.text || '')
        .join('')
        .trim();
      // Extract title after the colon: "Completed task task_20250731_n9q0qi: Remove unused build artifacts from _build directory"
      const match = textContent.match(/Completed task [^:]+:\s*(.+)$/);
      if (match) {
        return `Task "${match[1]}" completed`;
      }
    }

    // Fallback
    if (typeof args === 'object' && args !== null && 'id' in args) {
      const taskId = (args as { id?: unknown }).id;
      if (typeof taskId === 'string') {
        return `Task ${taskId} completed`;
      }
    }
    return 'Task completed';
  },

  isError: (result: ToolResult): boolean => {
    if (result.status !== 'completed') return true;

    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult, metadata?: ToolAggregatedEventData): React.ReactNode => {
    const parsed = parseToolResult(result);

    // Handle errors
    if (
      result.status !== 'completed' ||
      (typeof parsed === 'object' && parsed !== null && 'error' in parsed)
    ) {
      const error = parsed as { error: string };
      return (
        <Alert
          variant="error"
          title="Failed to complete task"
          description={error?.error || 'Unknown error'}
        />
      );
    }

    // Get completion message from tool arguments for rich display
    let completionMessage: string | null = null;
    if (
      metadata?.arguments &&
      typeof metadata.arguments === 'object' &&
      metadata.arguments !== null &&
      'message' in metadata.arguments
    ) {
      completionMessage = (metadata.arguments as { message: string }).message;
    }

    // Show expanded format only if there's a completion message
    if (completionMessage) {
      return (
        <MarkdownRenderer
          content={completionMessage}
          maxLines={10}
          isRecentMessage={true}
          className="bg-success/5 border-success/20"
        />
      );
    }

    // Default compact format
    return <div className="text-sm text-success p-2">✓ Task completed</div>;
  },

  getIcon: () => faCheck,
};

/**
 * Task Update Tool Renderer - Update task properties with change tracking
 */
const taskUpdateRenderer: ToolRenderer = {
  getSummary: (args: unknown, result?: ToolResult): string => {
    // Get task title from result metadata for better summary
    const resultMetadata = result?.metadata as { task?: Task } | undefined;
    const task = resultMetadata?.task;

    if (task?.title) {
      return `Updated task: ${task.title}`;
    }

    if (typeof args === 'object' && args !== null && 'taskId' in args) {
      const taskId = (args as { taskId?: unknown }).taskId;
      if (typeof taskId === 'string') {
        return `Updated task ${taskId}`;
      }
    }
    return 'Updated task';
  },

  isError: (result: ToolResult): boolean => {
    if (result.status !== 'completed') return true;

    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    const parsed = parseToolResult(result);

    // Handle errors
    if (
      result.status !== 'completed' ||
      (typeof parsed === 'object' && parsed !== null && 'error' in parsed)
    ) {
      const error = parsed as { error: string };
      return (
        <Alert
          variant="error"
          title="Failed to update task"
          description={error?.error || 'Unknown error'}
        />
      );
    }

    // Get task data from metadata (structured data from task tools)
    const resultMetadata = result.metadata as
      | { task?: Task; changes?: Record<string, { from: unknown; to: unknown }> }
      | undefined;
    const task = resultMetadata?.task;
    const changes = resultMetadata?.changes;

    // For simple updates (no substantial changes), show compact format
    const hasSubstantialChanges =
      changes &&
      Object.keys(changes).some(
        (field) => field === 'title' || field === 'description' || field === 'assignedTo'
      );

    if (!hasSubstantialChanges) {
      return <div className="text-sm text-success p-2">✓ Task updated</div>;
    }

    // Show full format for substantial changes
    return (
      <div className="bg-base-100 border border-base-300 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faEdit} className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-base-content">Task Updated</h3>
          </div>
          {task?.id && (
            <a href={`#/tasks/${task.id}`} className="btn btn-ghost btn-xs gap-1">
              <FontAwesomeIcon icon={faEye} className="w-3 h-3" />
              View
            </a>
          )}
        </div>

        {task?.title && <div className="font-medium text-base-content mb-3">{task.title}</div>}

        {/* Show what changed */}
        {changes && Object.keys(changes).length > 0 && (
          <div className="bg-base-200/50 rounded-lg p-3">
            <div className="text-sm font-medium text-base-content/70 mb-2">Changes:</div>
            <div className="space-y-2">
              {Object.entries(changes).map(([field, change]) => (
                <div key={field} className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-base-content/80 capitalize mb-1">
                      {field.replace(/([A-Z])/g, ' $1').trim()}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <InlineCode
                        code={String(change.from) || '(empty)'}
                        className="text-xs bg-base-300"
                      />
                      <FontAwesomeIcon
                        icon={faArrowRight}
                        className="w-3 h-3 text-base-content/40"
                      />
                      <InlineCode
                        code={String(change.to) || '(empty)'}
                        className="text-xs bg-primary/10 text-primary"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },

  getIcon: () => faEdit,
};

/**
 * Task Add Note Tool Renderer - Add notes to tasks
 */
const taskAddNoteRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'taskId' in args) {
      const taskId = (args as { taskId?: unknown }).taskId;
      if (typeof taskId === 'string') {
        return `Add note to task: ${taskId}`;
      }
    }
    return 'Add note to task';
  },

  isError: (result: ToolResult): boolean => {
    if (result.status !== 'completed') return true;

    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    const parsed = parseToolResult(result);

    // Check for error statuses first
    if (
      result.status === 'failed' ||
      result.status === 'denied' ||
      result.status === 'aborted' ||
      (typeof parsed === 'object' && parsed !== null && 'error' in parsed)
    ) {
      const error = parsed as { error: string };
      return (
        <Alert
          variant="error"
          title="Failed to add note"
          description={error?.error || `Add note failed (${result.status})`}
          className="mt-2"
        />
      );
    }

    if (!parsed) {
      return <div className="text-sm text-base-content/60 italic">Note added to task</div>;
    }

    const data = parsed as { taskId?: string; noteId?: string; note?: string; addedAt?: string };

    return (
      <div className="bg-info/5 border border-info/20 rounded-lg p-4">
        <div className="flex items-center gap-2 text-info text-sm font-medium mb-3">
          <FontAwesomeIcon icon={faStickyNote} className="w-4 h-4" />
          Note added successfully
        </div>

        <div className="space-y-2">
          {data.note && (
            <div className="bg-base-100 border border-base-300 rounded p-3 text-sm">
              {data.note}
            </div>
          )}

          <div className="flex items-center gap-3 text-sm">
            {data.taskId && (
              <span className="font-mono text-base-content/60">Task: {data.taskId}</span>
            )}

            {data.noteId && (
              <span className="font-mono text-base-content/60">Note ID: {data.noteId}</span>
            )}
          </div>

          {data.addedAt && (
            <div className="text-xs text-base-content/50">
              Added: {new Date(data.addedAt).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    );
  },

  getIcon: () => faStickyNote,
};

/**
 * Task View Tool Renderer - View detailed task information
 */
const taskViewRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'taskId' in args) {
      const taskId = (args as { taskId?: unknown }).taskId;
      if (typeof taskId === 'string') {
        return `View task: ${taskId}`;
      }
    }
    return 'View task';
  },

  isError: (result: ToolResult): boolean => {
    if (result.status !== 'completed') return true;

    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    const parsed = parseToolResult(result);

    if (!parsed) {
      return <div className="text-sm text-base-content/60 italic">Task details not available</div>;
    }

    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const error = parsed as { error: string; code?: string };
      return (
        <Alert
          variant="error"
          title="Task not found"
          description={error.error}
          className="mt-2"
          style="soft"
        >
          {error.code && <div className="text-xs opacity-60">Code: {error.code}</div>}
        </Alert>
      );
    }

    const task = parsed as {
      id?: string;
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      createdAt?: string;
      assignedTo?: string;
      notes?: Array<{ id: string; content: string; addedAt: string }>;
    };

    return (
      <div className="bg-base-100 border border-base-300 rounded-lg">
        {/* Header */}
        <div className="p-4 border-b border-base-300 bg-base-200/50">
          <div className="flex items-center gap-2 text-base-content font-medium">
            <FontAwesomeIcon icon={faEye} className="w-4 h-4" />
            Task Details
          </div>
        </div>

        {/* Task Info */}
        <div className="p-4 space-y-4">
          {task.title && (
            <div>
              <h3 className="font-semibold text-base-content mb-1">{task.title}</h3>
              {task.id && (
                <div className="text-xs font-mono text-base-content/60">ID: {task.id}</div>
              )}
            </div>
          )}

          {task.description && (
            <div className="bg-base-200/50 rounded p-3 text-sm">{task.description}</div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            {task.status && <StatusBadge status={task.status} />}
            {task.priority && <PriorityBadge priority={task.priority} />}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {task.createdAt && (
              <div className="flex items-center gap-2 text-base-content/70">
                <FontAwesomeIcon icon={faClock} className="w-4 h-4" />
                Created: {new Date(task.createdAt).toLocaleString()}
              </div>
            )}

            {task.assignedTo && (
              <div className="flex items-center gap-2 text-base-content/70">
                <FontAwesomeIcon icon={faUser} className="w-4 h-4" />
                Assigned to: {task.assignedTo}
              </div>
            )}
          </div>

          {/* Notes Section */}
          {task.notes && task.notes.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-base-content mb-3">
                <FontAwesomeIcon icon={faStickyNote} className="w-4 h-4" />
                Notes ({task.notes.length})
              </div>

              <div className="space-y-3">
                {task.notes.map((note, index) => (
                  <div
                    key={note.id || index}
                    className="bg-info/5 border border-info/20 rounded p-3"
                  >
                    <div className="text-sm text-base-content">{note.content}</div>
                    <div className="text-xs text-base-content/50 mt-2">
                      {new Date(note.addedAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },

  getIcon: () => faEye,
};

/**
 * Export all task renderers
 */
export const taskRenderers = {
  task_add: taskAddRenderer,
  task_list: taskListRenderer,
  task_complete: taskCompleteRenderer,
  task_update: taskUpdateRenderer,
  task_add_note: taskAddNoteRenderer,
  task_view: taskViewRenderer,
};
