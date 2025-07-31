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
  faUser
} from '@fortawesome/free-solid-svg-icons';
import type { ToolRenderer, ToolResult } from './types';
import type { Task } from '@/types/api';

/**
 * Priority badge component for consistent priority display
 */
const PriorityBadge: React.FC<{ priority: string }> = ({ priority }) => {
  const priorityStyles = {
    high: 'bg-error/10 text-error border-error/20',
    medium: 'bg-warning/10 text-warning border-warning/20', 
    low: 'bg-info/10 text-info border-info/20',
  };
  
  const style = priorityStyles[priority as keyof typeof priorityStyles] || priorityStyles.medium;
  
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${style}`}>
      {priority}
    </span>
  );
};

/**
 * Status badge component for task status display
 */
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusStyles = {
    pending: 'bg-base-200 text-base-content/70 border-base-300',
    in_progress: 'bg-primary/10 text-primary border-primary/20',
    completed: 'bg-success/10 text-success border-success/20',
    cancelled: 'bg-base-300 text-base-content/50 border-base-400',
  };
  
  const style = statusStyles[status as keyof typeof statusStyles] || statusStyles.pending;
  
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${style}`}>
      {status.replace('_', ' ')}
    </span>
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
    
    // DEBUG: Show raw data dump for debugging metadata flow
    const debugData = {
      resultStructure: {
        isError: result.isError,
        contentLength: result.content?.length,
        hasMetadata: !!result.metadata,
        metadataKeys: result.metadata ? Object.keys(result.metadata) : [],
        metadataType: typeof result.metadata,
      },
      resultMetadata: result.metadata,
      rawResult: result,
      timestamp: new Date().toISOString(),
    };
    
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
    
    // DEBUG: Show detailed data dump when no task data found
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <div className="font-semibold text-yellow-800 mb-2">
          🔍 DEBUG: Task Metadata Flow
        </div>
        <div className="text-xs">
          <details className="mb-2">
            <summary className="cursor-pointer text-yellow-700 font-medium">
              Click to expand raw data dump
            </summary>
            <pre className="mt-2 p-2 bg-white border rounded text-xs overflow-auto max-h-96 whitespace-pre-wrap">
              {JSON.stringify(debugData, null, 2)}
            </pre>
          </details>
          <div className="text-yellow-600">
            Expected: Task metadata in result.metadata.task or result.metadata.tasks
          </div>
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
    
    if (!parsed) {
      return (
        <div className="text-sm text-base-content/60 italic">
          No tasks available
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
    
    const data = parsed as { tasks?: Array<{ id: string; title: string; status: string; priority: string; assignedTo?: string }>; totalCount?: number };
    
    if (!data.tasks || data.tasks.length === 0) {
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
            {data.totalCount ? `${data.totalCount} tasks` : `${data.tasks.length} tasks`}
          </div>
        </div>
        
        <div className="divide-y divide-base-300">
          {data.tasks.map((task, index) => (
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
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'taskId' in args) {
      const taskId = (args as { taskId?: unknown }).taskId;
      if (typeof taskId === 'string') {
        return `Complete task: ${taskId}`;
      }
    }
    return 'Complete task';
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
          Task completed
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
    
    const task = parsed as { taskId?: string; title?: string; status?: string; completedAt?: string };
    
    return (
      <div className="bg-success/5 border border-success/20 rounded-lg p-4">
        <div className="flex items-center gap-2 text-success text-sm font-medium mb-3">
          <FontAwesomeIcon icon={faCheck} className="w-4 h-4" />
          Task completed successfully
        </div>
        
        <div className="space-y-2">
          {task.title && (
            <div className="font-medium text-base-content">
              {task.title}
            </div>
          )}
          
          <div className="flex items-center gap-3 text-sm">
            {task.taskId && (
              <span className="font-mono text-base-content/60">
                ID: {task.taskId}
              </span>
            )}
            
            {task.status && <StatusBadge status={task.status} />}
          </div>
          
          {task.completedAt && (
            <div className="text-xs text-base-content/50">
              Completed: {new Date(task.completedAt).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    );
  },

  getIcon: () => faCheck,
};

/**
 * Task Update Tool Renderer - Update task properties
 */
const taskUpdateRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'taskId' in args) {
      const taskId = (args as { taskId?: unknown }).taskId;
      if (typeof taskId === 'string') {
        return `Update task: ${taskId}`;
      }
    }
    return 'Update task';
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
          Task updated
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
    
    const task = parsed as { taskId?: string; title?: string; status?: string; priority?: string; updatedAt?: string };
    
    return (
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
        <div className="flex items-center gap-2 text-primary text-sm font-medium mb-3">
          <FontAwesomeIcon icon={faEdit} className="w-4 h-4" />
          Task updated successfully
        </div>
        
        <div className="space-y-2">
          {task.title && (
            <div className="font-medium text-base-content">
              {task.title}
            </div>
          )}
          
          <div className="flex items-center gap-3 text-sm">
            {task.taskId && (
              <span className="font-mono text-base-content/60">
                ID: {task.taskId}
              </span>
            )}
            
            {task.status && <StatusBadge status={task.status} />}
            {task.priority && <PriorityBadge priority={task.priority} />}
          </div>
          
          {task.updatedAt && (
            <div className="text-xs text-base-content/50">
              Updated: {new Date(task.updatedAt).toLocaleString()}
            </div>
          )}
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