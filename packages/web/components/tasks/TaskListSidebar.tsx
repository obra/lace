// ABOUTME: Sidebar task list component for session task overview
// ABOUTME: Shows read-only list of tasks with priority and status indicators

'use client';

import React, { useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faChevronRight, faChevronDown } from '@/lib/fontawesome';
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
  onCreateTask,
}: TaskListSidebarProps) {
  const { tasks, isLoading, error } = taskManager;
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['in_progress']) // Default to in_progress expanded
  );

  const tasksByStatus = useMemo(
    () => ({
      pending: tasks.filter((t) => t.status === 'pending'),
      in_progress: tasks.filter((t) => t.status === 'in_progress'),
      blocked: tasks.filter((t) => t.status === 'blocked'),
      completed: tasks.filter((t) => t.status === 'completed'),
      archived: tasks.filter((t) => t.status === 'archived'),
    }),
    [tasks]
  );

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };

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

  const TaskSection = ({
    status,
    title,
    tasks,
    limit,
  }: {
    status: string;
    title: string;
    tasks: Task[];
    limit: number;
  }) => {
    const isExpanded = expandedSections.has(status);

    return (
      <div className="space-y-1">
        <button
          onClick={() => toggleSection(status)}
          className="flex items-center gap-1.5 text-xs font-medium text-base-content/80 hover:text-base-content transition-colors w-full text-left"
        >
          <FontAwesomeIcon
            icon={isExpanded ? faChevronDown : faChevronRight}
            className="w-2.5 h-2.5"
          />
          <span>{title}</span>
        </button>
        {isExpanded && (
          <div className="ml-4 space-y-1">
            {tasks.slice(0, limit).map((task) => (
              <TaskSidebarItem key={task.id} task={task} onClick={() => onOpenTaskBoard?.()} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {/* In Progress Tasks */}
      {tasksByStatus.in_progress.length > 0 && (
        <TaskSection
          status="in_progress"
          title="In Progress"
          tasks={tasksByStatus.in_progress}
          limit={TASK_DISPLAY_LIMITS.in_progress}
        />
      )}

      {/* Pending Tasks */}
      {tasksByStatus.pending.length > 0 && (
        <TaskSection
          status="pending"
          title="Pending"
          tasks={tasksByStatus.pending}
          limit={TASK_DISPLAY_LIMITS.pending}
        />
      )}

      {/* Blocked Tasks */}
      {tasksByStatus.blocked.length > 0 && (
        <TaskSection
          status="blocked"
          title="Blocked"
          tasks={tasksByStatus.blocked}
          limit={TASK_DISPLAY_LIMITS.blocked}
        />
      )}
    </div>
  );
}
