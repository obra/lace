// ABOUTME: Task summary component for displaying task statistics
// ABOUTME: Shows count of tasks by status with visual indicators

import React from 'react';

export interface TaskSummaryData {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
}

interface TaskSummaryProps {
  summary: TaskSummaryData | null;
  loading?: boolean;
}

export function TaskSummary({ summary, loading }: TaskSummaryProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-white rounded-lg border p-4">
        <p className="text-gray-500">No task summary available</p>
      </div>
    );
  }

  const statusCounts = [
    { label: 'Pending', count: summary.pending, color: 'text-gray-600 bg-gray-50' },
    { label: 'In Progress', count: summary.in_progress, color: 'text-blue-600 bg-blue-50' },
    { label: 'Completed', count: summary.completed, color: 'text-green-600 bg-green-50' },
    { label: 'Blocked', count: summary.blocked, color: 'text-red-600 bg-red-50' },
  ];

  return (
    <div className="bg-white rounded-lg border p-4">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Task Summary</h3>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statusCounts.map(({ label, count, color }) => (
          <div key={label} className={`p-3 rounded-lg ${color}`}>
            <div className="text-2xl font-bold">{count}</div>
            <div className="text-sm">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-sm text-gray-500">Total: {summary.total} tasks</div>
    </div>
  );
}