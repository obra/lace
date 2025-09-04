// ABOUTME: Individual task item for sidebar display
// ABOUTME: Compact task representation with priority and status indicators

'use client';

import React from 'react';
import type { Task } from '@/types/core';

interface TaskSidebarItemProps {
  task: Task;
  onClick?: () => void;
}

export function TaskSidebarItem({ task, onClick }: TaskSidebarItemProps) {
  const priorityColor = {
    high: 'text-red-500',
    medium: 'text-yellow-500',
    low: 'text-green-500',
  }[task.priority];

  const getAssignmentText = (assignedTo?: string): string => {
    if (!assignedTo) return ''; // Don't show "Unassigned" in tasks section since all tasks there are unassigned
    if (assignedTo === 'human') return 'Assigned to you';
    return 'Assigned to agent';
  };

  return (
    <div
      className="pr-2 py-2.5 hover:bg-base-200/80 hover:shadow-sm rounded-xl cursor-pointer group transition-all duration-200 hover:scale-[1.02] border border-transparent hover:border-base-300/40"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="flex items-start gap-y-2">
        {/* Priority Indicator */}
        <div className="flex items-center justify-center">
          <div
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm ${priorityColor} group-hover:scale-110 transition-transform duration-200`}
            role="presentation"
            aria-label={`${task.priority} priority`}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-base-content truncate group-hover:text-base-content/90 transition-colors">
            {task.title}
          </div>
          {getAssignmentText(task.assignedTo) && (
            <div className="text-xs text-base-content/60 truncate group-hover:text-base-content/70 transition-colors">
              {getAssignmentText(task.assignedTo)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
