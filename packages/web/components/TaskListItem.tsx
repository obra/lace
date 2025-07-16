// ABOUTME: Task list item component for displaying individual tasks
// ABOUTME: Shows task details with status icons and priority badges

import React from 'react';
import type { Task } from '@/types/api';

interface TaskListItemProps {
  task: Task;
  onClick: (task: Task) => void;
  onStatusChange?: (taskId: string, status: Task['status']) => void;
}

export function TaskListItem({ task, onClick, onStatusChange }: TaskListItemProps) {
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString();
  };

  const formatAssignee = (assignedTo?: string) => {
    if (!assignedTo) return 'Unassigned';
    if (assignedTo.startsWith('new:')) return assignedTo;
    // Extract the last part of the thread ID (e.g., "agent1" from "lace_20240101_agent1")
    const parts = assignedTo.split('_');
    return parts.length > 1 ? parts[parts.length - 1] : assignedTo;
  };

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'high':
        return 'text-red-600 bg-red-50';
      case 'medium':
        return 'text-yellow-600 bg-yellow-50';
      case 'low':
        return 'text-green-600 bg-green-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'in_progress':
        return '🔄';
      case 'completed':
        return '✅';
      case 'blocked':
        return '🚫';
      default:
        return '❓';
    }
  };

  return (
    <div
      className="border border-gray-700 rounded-lg p-4 hover:bg-gray-700 cursor-pointer transition-colors"
      onClick={() => onClick(task)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{getStatusIcon(task.status)}</span>
            <h3 className="font-medium text-gray-100">{task.title}</h3>
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${getPriorityColor(
                task.priority
              )}`}
            >
              {task.priority.toUpperCase()}
            </span>
          </div>

          {task.description && (
            <p className="text-sm text-gray-400 mb-2">{task.description}</p>
          )}

          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>Assigned to: {formatAssignee(task.assignedTo ? String(task.assignedTo) : undefined)}</span>
            <span>Created: {formatDate(task.createdAt)}</span>
            {task.notes.length > 0 && <span>{task.notes.length} notes</span>}
          </div>
        </div>

        {onStatusChange && (
          <select
            value={task.status}
            onChange={(e) => {
              e.stopPropagation();
              if (onStatusChange) {
                onStatusChange(task.id, e.target.value as Task['status']);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="ml-4 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100"
          >
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="blocked">Blocked</option>
          </select>
        )}
      </div>
    </div>
  );
}