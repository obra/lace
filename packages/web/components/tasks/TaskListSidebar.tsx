// ABOUTME: Sidebar task list component for session task overview
// ABOUTME: Shows read-only list of tasks with priority and status indicators

'use client';

import React, { useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTasks } from '@/lib/fontawesome';
import { SidebarButton } from '@/components/layout/Sidebar';
import { useTaskManager } from '@/hooks/useTaskManager';
import { TaskSidebarItem } from './TaskSidebarItem';
import type { Task } from '@/types/api';

interface TaskListSidebarProps {
  projectId: string;
  sessionId: string;
  onTaskClick?: (taskId: string) => void;
  onOpenTaskBoard?: () => void;
}

export function TaskListSidebar({ 
  projectId, 
  sessionId, 
  onTaskClick, 
  onOpenTaskBoard 
}: TaskListSidebarProps) {
  const { tasks, isLoading } = useTaskManager(projectId, sessionId);
  
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

  return (
    <div className="space-y-2">
      {/* Quick Actions */}
      <SidebarButton 
        onClick={onOpenTaskBoard} 
        variant="primary" 
        size="sm"
      >
        <FontAwesomeIcon icon={faTasks} className="w-4 h-4" />
        Open Kanban Board
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
          {tasksByStatus.in_progress.slice(0, 3).map(task => (
            <TaskSidebarItem 
              key={task.id} 
              task={task} 
              onClick={() => onTaskClick?.(task.id)} 
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
          {tasksByStatus.pending.slice(0, 2).map(task => (
            <TaskSidebarItem 
              key={task.id} 
              task={task} 
              onClick={() => onTaskClick?.(task.id)} 
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
          {tasksByStatus.blocked.slice(0, 1).map(task => (
            <TaskSidebarItem 
              key={task.id} 
              task={task} 
              onClick={() => onTaskClick?.(task.id)} 
            />
          ))}
        </div>
      )}

      {/* View All Link */}
      {tasks.length > 5 && (
        <SidebarButton 
          onClick={onOpenTaskBoard} 
          variant="ghost" 
          size="sm"
        >
          View all {tasks.length} tasks
        </SidebarButton>
      )}

      {/* Empty State */}
      {tasks.length === 0 && (
        <div className="text-center py-4">
          <div className="text-xs text-base-content/40">
            No tasks yet
          </div>
          <SidebarButton 
            onClick={onOpenTaskBoard} 
            variant="ghost" 
            size="sm"
            className="mt-2"
          >
            Create your first task
          </SidebarButton>
        </div>
      )}
    </div>
  );
}