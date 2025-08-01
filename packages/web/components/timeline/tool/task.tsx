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
  faArrowRight
} from '@fortawesome/free-solid-svg-icons';
import type { ToolRenderer, ToolResult } from './types';
import type { ToolAggregatedEventData } from '@/types/api';
import type { Task } from '@/types/api';
import Badge from '@/components/ui/Badge';
import InlineCode from '@/components/ui/InlineCode';

/**
 * Priority badge component using design system Badge
 */
const PriorityBadge: React.FC<{ priority: string }> = ({ priority }) => {
  const getVariant = (priority: string) => {
    switch (priority) {
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'warning';
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
      case 'completed': return 'success';
      case 'in_progress': return 'primary';
      case 'cancelled': return 'outline';
      default: return 'default';
    }
  };
  
  return (
    <Badge variant={getVariant(status)} size="xs">
      {status.replace('_', ' ')}
    </Badge>
  );
};

/**
 * Parse structured tool result content
 */
function parseToolResult(result: ToolResult): unknown {
  if (!result.content || result.content.length === 0) return null;
  
  const rawOutput = result.content
    .map(block => block.text || '')
    .join('');
    
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
    
    if (result.isError) {
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
    if (result.isError) return true;
    
    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    const parsed = parseToolResult(result);
    
    // Handle errors only
    if (result.isError || (typeof parsed === 'object' && parsed !== null && 'error' in parsed)) {
      const error = parsed as { error: string; code?: string };
      return (
        <div className="bg-error/10 border border-error/20 rounded-lg p-3 mt-2">
          <div className="flex items-center gap-2 text-error text-sm font-medium mb-1">
            <FontAwesomeIcon icon={faExclamationTriangle} className="w-4 h-4" />
            Failed to create task
          </div>
          <div className="text-error/80 text-sm">{error?.error || 'Unknown error'}</div>
          {error?.code && (
            <div className="text-error/60 text-xs mt-1">Code: {error.code}</div>
          )}
        </div>
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
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <div className="text-yellow-600 text-sm">
          No task metadata found
        </div>
      </div>
    );
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
    if (result.isError) return true;
    
    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    const parsed = parseToolResult(result);
    
    // Handle errors first
    if (result.isError || (typeof parsed === 'object' && parsed !== null && 'error' in parsed)) {
      const error = parsed as { error: string };
      return (
        <div className="bg-error/10 border border-error/20 rounded-lg p-3">
          <div className="text-error text-sm">{error?.error || 'Unknown error'}</div>
        </div>
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
                  <div className="font-medium text-base-content truncate">
                    {task.title}
                  </div>
                  <div className="text-xs text-base-content/60 font-mono mt-1">
                    {task.id}
                  </div>
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

  getSummary: (args: unknown): string => {
    // We can't get the result here, so just use a generic summary
    // The actual task title will be shown in the renderResult
    if (typeof args === 'object' && args !== null && 'id' in args) {
      const taskId = (args as { id?: unknown }).id;
      if (typeof taskId === 'string') {
        return `Mark task ${taskId} as completed`;
      }
    }
    return 'Mark task as completed';
  },

  isError: (result: ToolResult): boolean => {
    if (result.isError) return true;
    
    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult, metadata?: ToolAggregatedEventData): React.ReactNode => {
    const parsed = parseToolResult(result);
    
    // Handle errors
    if (result.isError || (typeof parsed === 'object' && parsed !== null && 'error' in parsed)) {
      const error = parsed as { error: string };
      return (
        <div className="alert alert-error">
          <FontAwesomeIcon icon={faExclamationTriangle} className="w-4 h-4" />
          <div>
            <div className="font-bold">Failed to complete task</div>
            <div className="text-sm">{error?.error || 'Unknown error'}</div>
          </div>
        </div>
      );
    }
    
    // Get task data from metadata (structured data from task tools)
    const resultMetadata = result.metadata as { task?: Task } | undefined;
    const task = resultMetadata?.task;
    
    // Extract task title from result content 
    // The result content contains: "Completed task task_20250731_n9q0qi: Remove unused build artifacts from _build directory"
    let taskTitle: string | null = null;
    if (result.content && result.content.length > 0) {
      const textContent = result.content.map(block => block.text || '').join('').trim();
      // Extract title after the colon
      const match = textContent.match(/Completed task [^:]+:\s*(.+)$/);
      if (match) {
        taskTitle = match[1];
      }
    }
    
    // Get completion message from tool arguments
    // From Technical Details: Arguments: { "id": "...", "message": "Successfully cleaned up..." }
    let completionMessage: string | null = null;
    if (metadata?.arguments && typeof metadata.arguments === 'object' && metadata.arguments !== null && 'message' in metadata.arguments) {
      completionMessage = (metadata.arguments as { message: string }).message;
    }
    
    return (
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body p-4">
          {/* Show task title prominently */}
          {taskTitle && (
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-base-content">{taskTitle}</h3>
              {task?.id && (
                <a
                  href={`#/tasks/${task.id}`}
                  className="btn btn-ghost btn-xs gap-1"
                >
                  <FontAwesomeIcon icon={faEye} className="w-3 h-3" />
                  View
                </a>
              )}
            </div>
          )}
          
          {/* Show completion message if available */}
          {completionMessage && (
            <div className="bg-base-200/50 rounded-lg p-3 text-sm text-base-content mb-3">
              {completionMessage}
            </div>
          )}
          
          {/* Show metadata */}
          <div className="flex items-center gap-2 text-xs">
            {task?.id && (
              <span className="font-mono text-base-content/50">
                {task.id}
              </span>
            )}
            <StatusBadge status="completed" />
            {task?.priority && <PriorityBadge priority={task.priority} />}
          </div>
        </div>
      </div>
    );
  },

  getIcon: () => faCheck,
};

/**
 * Task Update Tool Renderer - Update task properties with change tracking
 */
const taskUpdateRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'taskId' in args) {
      const taskId = (args as { taskId?: unknown }).taskId;
      if (typeof taskId === 'string') {
        return `Updated task ${taskId}`;
      }
    }
    return 'Updated task';
  },

  isError: (result: ToolResult): boolean => {
    if (result.isError) return true;
    
    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    const parsed = parseToolResult(result);
    
    // Handle errors
    if (result.isError || (typeof parsed === 'object' && parsed !== null && 'error' in parsed)) {
      const error = parsed as { error: string };
      return (
        <div className="alert alert-error">
          <FontAwesomeIcon icon={faExclamationTriangle} className="w-4 h-4" />
          <div>
            <div className="font-bold">Failed to update task</div>
            <div className="text-sm">{error?.error || 'Unknown error'}</div>
          </div>
        </div>
      );
    }
    
    // Get task data from metadata (structured data from task tools)
    const resultMetadata = result.metadata as { task?: Task; changes?: Record<string, { from: unknown; to: unknown }> } | undefined;
    const task = resultMetadata?.task;
    const changes = resultMetadata?.changes;
    
    return (
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FontAwesomeIcon icon={faEdit} className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-base-content">Task Updated</h3>
            </div>
            {task?.id && (
              <a
                href={`#/tasks/${task.id}`}
                className="btn btn-ghost btn-xs gap-1"
              >
                <FontAwesomeIcon icon={faEye} className="w-3 h-3" />
                View
              </a>
            )}
          </div>
          
          {task?.title && (
            <div className="font-medium text-base-content mb-3">
              {task.title}
            </div>
          )}
          
          {/* Show what changed */}
          {changes && Object.keys(changes).length > 0 && (
            <div className="bg-base-200/50 rounded-lg p-3 mb-3">
              <div className="text-sm font-medium text-base-content/70 mb-2">Changes:</div>
              <div className="space-y-2">
                {Object.entries(changes).map(([field, change]) => (
                  <div key={field} className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-base-content/80 capitalize mb-1">
                        {field.replace(/([A-Z])/g, ' $1').trim()}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <InlineCode code={String(change.from) || '(empty)'} className="text-xs bg-base-300" />
                        <FontAwesomeIcon icon={faArrowRight} className="w-3 h-3 text-base-content/40" />
                        <InlineCode code={String(change.to) || '(empty)'} className="text-xs bg-primary/10 text-primary" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="flex items-center gap-2 flex-wrap">
            {task?.id && (
              <div className="text-xs text-base-content/50 font-mono">
                {task.id}
              </div>
            )}
            {task?.status && <StatusBadge status={task.status} />}
            {task?.priority && <PriorityBadge priority={task.priority} />}
          </div>
        </div>
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
    if (result.isError) return true;
    
    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    const parsed = parseToolResult(result);
    
    if (!parsed) {
      return (
        <div className="text-sm text-base-content/60 italic">
          Note added to task
        </div>
      );
    }
    
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const error = parsed as { error: string };
      return (
        <div className="bg-error/10 border border-error/20 rounded-lg p-3">
          <div className="text-error text-sm">{error.error}</div>
        </div>
      );
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
              <span className="font-mono text-base-content/60">
                Task: {data.taskId}
              </span>
            )}
            
            {data.noteId && (
              <span className="font-mono text-base-content/60">
                Note ID: {data.noteId}
              </span>
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
    if (result.isError) return true;
    
    const parsed = parseToolResult(result);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    const parsed = parseToolResult(result);
    
    if (!parsed) {
      return (
        <div className="text-sm text-base-content/60 italic">
          Task details not available
        </div>
      );
    }
    
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const error = parsed as { error: string; code?: string };
      return (
        <div className="bg-error/10 border border-error/20 rounded-lg p-3">
          <div className="flex items-center gap-2 text-error text-sm font-medium mb-1">
            <FontAwesomeIcon icon={faExclamationTriangle} className="w-4 h-4" />
            Task not found
          </div>
          <div className="text-error/80 text-sm">{error.error}</div>
          {error.code && (
            <div className="text-error/60 text-xs mt-1">Code: {error.code}</div>
          )}
        </div>
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
            <div className="bg-base-200/50 rounded p-3 text-sm">
              {task.description}
            </div>
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
                  <div key={note.id || index} className="bg-info/5 border border-info/20 rounded p-3">
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