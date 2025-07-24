// ABOUTME: Sidebar task list component for session task overview
// ABOUTME: Shows read-only list of tasks with priority and status indicators

'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTasks, faPlus, faSearch } from '@/lib/fontawesome';
import { SidebarButton } from '@/components/layout/Sidebar';
import { useTaskManager } from '@/hooks/useTaskManager';
import { TaskSidebarItem } from './TaskSidebarItem';
import type { Task } from '@/types/api';

// Task display limits for each status section
const TASK_DISPLAY_LIMITS = {
  in_progress: 3,
  pending: 2,
  blocked: 1,
} as const;

// Debounce delay for search input (in milliseconds)
const SEARCH_DEBOUNCE_DELAY = 300;

interface TaskListSidebarProps {
  projectId: string;
  sessionId: string;
  onTaskClick?: (taskId: string) => void;
  onOpenTaskBoard?: () => void;
  onCreateTask?: () => void;
}

export function TaskListSidebar({ 
  projectId, 
  sessionId, 
  onTaskClick, 
  onOpenTaskBoard,
  onCreateTask
}: TaskListSidebarProps) {
  const { tasks, isLoading, error } = useTaskManager(projectId, sessionId);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  // Debounce search term to improve performance
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, SEARCH_DEBOUNCE_DELAY);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Pre-compute tasks with lowercase search fields for better performance
  const tasksWithSearchData = useMemo(() => {
    return tasks.map((task) => ({
      ...task,
      searchableTitle: task.title.toLowerCase(),
      searchableDescription: task.description?.toLowerCase() || '',
    }));
  }, [tasks]);

  // Filter tasks based on debounced search term
  const filteredTasks = useMemo(() => {
    if (!debouncedSearchTerm.trim()) return tasks;
    const searchLower = debouncedSearchTerm.toLowerCase();
    return tasksWithSearchData
      .filter(
        (task) =>
          task.searchableTitle.includes(searchLower) ||
          task.searchableDescription.includes(searchLower)
      )
      .map(({ searchableTitle, searchableDescription, ...task }) => task);
  }, [tasks, tasksWithSearchData, debouncedSearchTerm]);
  
  const tasksByStatus = useMemo(() => ({
    pending: filteredTasks.filter(t => t.status === 'pending'),
    in_progress: filteredTasks.filter(t => t.status === 'in_progress'),
    blocked: filteredTasks.filter(t => t.status === 'blocked'),
    completed: filteredTasks.filter(t => t.status === 'completed'),
  }), [filteredTasks]);

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
        <div className="text-xs text-base-content/60">{error.message || 'An error occurred'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Quick Actions */}
      <div className="flex gap-1">
        <SidebarButton 
          onClick={onOpenTaskBoard} 
          variant="primary" 
          size="sm"
          className="flex-1"
        >
          <FontAwesomeIcon icon={faTasks} className="w-4 h-4" />
          Open Kanban Board
        </SidebarButton>
        <SidebarButton 
          onClick={onCreateTask} 
          variant="ghost" 
          size="sm"
          className="px-2"
          aria-label="Create new task"
        >
          <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
        </SidebarButton>
      </div>

      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search tasks..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full text-xs pl-7 pr-2 py-1.5 bg-base-100 border border-base-300 rounded focus:outline-none focus:border-primary"
        />
        <FontAwesomeIcon 
          icon={faSearch} 
          className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-base-content/40" 
        />
      </div>

      {/* Task Summary */}
      <div className="text-xs text-base-content/60 px-2">
        {filteredTasks.length} tasks • {tasksByStatus.in_progress.length} in progress
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
          {tasksByStatus.pending.slice(0, TASK_DISPLAY_LIMITS.pending).map(task => (
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
          {tasksByStatus.blocked.slice(0, TASK_DISPLAY_LIMITS.blocked).map(task => (
            <TaskSidebarItem 
              key={task.id} 
              task={task} 
              onClick={() => onTaskClick?.(task.id)} 
            />
          ))}
        </div>
      )}

      {/* View All Link */}
      {tasks.length > 5 && !searchTerm && (
        <SidebarButton 
          onClick={onOpenTaskBoard} 
          variant="ghost" 
          size="sm"
        >
          View all {tasks.length} tasks
        </SidebarButton>
      )}

      {/* Empty Search Results */}
      {searchTerm && filteredTasks.length === 0 && (
        <div className="text-center py-4">
          <div className="text-xs text-base-content/40">
            No tasks match your search
          </div>
        </div>
      )}

      {/* Empty State */}
      {tasks.length === 0 && !searchTerm && (
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