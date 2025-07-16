// ABOUTME: Task filters component for filtering task list
// ABOUTME: Provides controls for filtering by status, priority, and assignee

import React from 'react';
import type { Task } from '@/types/api';

interface TaskFiltersProps {
  statusFilter: Task['status'] | 'all';
  priorityFilter: Task['priority'] | 'all';
  assigneeFilter: string;
  onStatusChange: (status: Task['status'] | 'all') => void;
  onPriorityChange: (priority: Task['priority'] | 'all') => void;
  onAssigneeChange: (assignee: string) => void;
  onClearFilters: () => void;
}

export function TaskFilters({
  statusFilter,
  priorityFilter,
  assigneeFilter,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onClearFilters,
}: TaskFiltersProps) {
  const hasFilters = statusFilter !== 'all' || priorityFilter !== 'all' || assigneeFilter;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-300">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value as Task['status'] | 'all')}
            className="px-3 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-300">Priority:</label>
          <select
            value={priorityFilter}
            onChange={(e) => onPriorityChange(e.target.value as Task['priority'] | 'all')}
            className="px-3 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-300">Assignee:</label>
          <input
            type="text"
            value={assigneeFilter}
            onChange={(e) => onAssigneeChange(e.target.value)}
            placeholder="Thread ID or agent name"
            className="px-3 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {hasFilters && (
          <button
            onClick={onClearFilters}
            className="px-3 py-1 text-sm text-gray-300 hover:text-gray-200 border border-gray-600 rounded hover:bg-gray-700"
          >
            Clear Filters
          </button>
        )}
      </div>
    </div>
  );
}