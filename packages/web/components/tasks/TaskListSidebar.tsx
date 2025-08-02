// ABOUTME: Sidebar task list component for session task overview
// ABOUTME: Shows read-only list of tasks with priority and status indicators

'use client';

import React, { useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@/lib/fontawesome';
import { SidebarButton } from '@/components/layout/Sidebar';
import type { useTaskManager } from '@/hooks/useTaskManager';
import { TaskSidebarItem } from './TaskSidebarItem';
import type { Task } from '@/types/core';

// Task display limits for each status section
const TASK_DISPLAY_LIMITS = {
  in_progress: 3,
  pending: 2,
  blocked: 1,
} as const;

interface TaskListSidebarProps {
  taskManager: ReturnType<typeof useTaskManager>;
  onTaskClick?: (taskId: string) => void;
  onOpenTaskBoard?: () => void;
  onCreateTask?: () => void;
}

export function TaskListSidebar({ 
  taskManager,
  onTaskClick, 
  onOpenTaskBoard,
  onCreateTask
}: TaskListSidebarProps) {
  const { tasks, isLoading, error } = taskManager;
  
  const tasksByStatus = useMemo(() => ({
    pending: tasks.filter(t => t.status === 'pending'),
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    blocked: tasks.filter(t => t.status === 'blocked'),
    completed: tasks.filter(t => t.status === 'completed'),
  }), [tasks]);

  if (isLoading) {
    return (
      <div className="p-2 flex justify-center">
        <div className="loading loading-spinner loading-sm" role="status"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-2 text-center">
        <div className="text-xs text-error mb-2">Failed to load tasks</div>
        <div className="text-xs text-base-content/60">{error || 'An error occurred'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Add Task Button */}
      <SidebarButton 
        onClick={() => onCreateTask?.()} 
        variant="ghost" 
        size="sm"
        className="w-full text-left justify-start"
      >
        <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
        Add task
      </SidebarButton>

      {/* Task Summary */}
      <div className="text-xs text-base-content/60 px-2">
        {tasks.length} tasks • {tasksByStatus.in_progress.length} in progress
      </div>

      {/* Active Tasks - In Progress */}
      {tasksByStatus.in_progress.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-base-content/80 px-2">
            In Progress
          </div>
          {tasksByStatus.in_progress.slice(0, TASK_DISPLAY_LIMITS.in_progress).map(task => (
            <TaskSidebarItem 
              key={task.id} 
              task={task} 
              onClick={() => onOpenTaskBoard?.()} 
            />
          ))}
        </div>
      )}

      {/* Pending Tasks */}
      {tasksByStatus.pending.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-base-content/80 px-2">
            Pending
          </div>
          {tasksByStatus.pending.slice(0, TASK_DISPLAY_LIMITS.pending).map(task => (
            <TaskSidebarItem 
              key={task.id} 
              task={task} 
              onClick={() => onOpenTaskBoard?.()} 
            />
          ))}
        </div>
      )}

      {/* Blocked Tasks */}
      {tasksByStatus.blocked.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-base-content/80 px-2">
            Blocked
          </div>
          {tasksByStatus.blocked.slice(0, TASK_DISPLAY_LIMITS.blocked).map(task => (
            <TaskSidebarItem 
              key={task.id} 
              task={task} 
              onClick={() => onOpenTaskBoard?.()} 
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {tasks.length === 0 && (
        <div className="text-center py-4">
          <div className="text-xs text-base-content/40">
            No tasks yet
          </div>
        </div>
      )}
    </div>
  );
}