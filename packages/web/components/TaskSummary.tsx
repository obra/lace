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
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-700 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <p className="text-gray-400">No task summary available</p>
      </div>
    );
  }

  const statusCounts = [
    { label: 'Pending', count: summary.pending, color: 'text-gray-300 bg-gray-700' },
    { label: 'In Progress', count: summary.in_progress, color: 'text-blue-400 bg-blue-900' },
    { label: 'Completed', count: summary.completed, color: 'text-green-400 bg-green-900' },
    { label: 'Blocked', count: summary.blocked, color: 'text-red-400 bg-red-900' },
  ];

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <h3 className="text-lg font-medium text-gray-100 mb-4">Task Summary</h3>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statusCounts.map(({ label, count, color }) => (
          <div key={label} className={`p-3 rounded-lg ${color}`}>
            <div className="text-2xl font-bold">{count}</div>
            <div className="text-sm">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-sm text-gray-400">Total: {summary.total} tasks</div>
    </div>
  );
}