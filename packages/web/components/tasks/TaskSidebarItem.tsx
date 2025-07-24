// ABOUTME: Individual task item for sidebar display
// ABOUTME: Compact task representation with priority and status indicators

'use client';

import React from 'react';
import type { Task } from '@/types/api';

interface TaskSidebarItemProps {
  task: Task;
  onClick?: () => void;
}

export function TaskSidebarItem({ task, onClick }: TaskSidebarItemProps) {
  const priorityColor = {
    high: 'text-red-500',
    medium: 'text-yellow-500', 
    low: 'text-green-500'
  }[task.priority];

  const getAssignmentText = (assignedTo?: string): string => {
    if (!assignedTo) return 'Unassigned';
    if (assignedTo === 'human') return 'Assigned to you';
    return 'Assigned to agent';
  };

  return (
    <div 
      className="px-2 py-1 hover:bg-base-200 rounded cursor-pointer group transition-colors"
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
      <div className="flex items-start gap-2">
        {/* Priority Indicator */}
        <div 
          className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${priorityColor}`}
          role="presentation"
          aria-label={`${task.priority} priority`}
        />
        
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-base-content truncate">
            {task.title}
          </div>
          <div className="text-xs text-base-content/60 truncate">
            {getAssignmentText(task.assignedTo)}
          </div>
        </div>
        
        {/* Status Indicator */}
        <div 
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            task.status === 'pending' ? 'bg-blue-500' :
            task.status === 'in_progress' ? 'bg-yellow-500' :
            task.status === 'blocked' ? 'bg-purple-500' :
            task.status === 'completed' ? 'bg-green-500' :
            'bg-gray-400'
          }`}
          role="presentation"
          aria-label={`Status: ${task.status.replace('_', ' ')}`}
        />
      </div>
    </div>
  );
}