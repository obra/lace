// ABOUTME: Task list component for displaying and managing tasks
// ABOUTME: Provides filtering, sorting, and interaction with tasks

import React from 'react';
import type { Task } from '@/types/api';
import { TaskListItem } from '@/components/TaskListItem';

interface TaskListProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onStatusChange?: (taskId: string, status: Task['status']) => void;
  loading?: boolean;
  error?: string;
}

export function TaskList({ tasks, onTaskClick, onStatusChange, loading, error }: TaskListProps) {
  // Sort tasks by priority and creation date
  const sortedTasks = [...tasks].sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (priorityDiff !== 0) return priorityDiff;

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div
          className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
          role="progressbar"
        ></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-900 border border-red-700 rounded-lg">
        <p className="text-red-400">Error: {error}</p>
      </div>
    );
  }

  if (sortedTasks.length === 0) {
    return (
      <div className="text-center p-8 text-gray-400">
        <p>No tasks found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortedTasks.map((task) => (
        <TaskListItem
          key={task.id}
          task={task}
          onClick={onTaskClick}
          onStatusChange={onStatusChange}
        />
      ))}
    </div>
  );
}
