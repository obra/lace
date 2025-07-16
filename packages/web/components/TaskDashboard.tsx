// ABOUTME: Task dashboard component for comprehensive task management
// ABOUTME: Main component that integrates all task-related functionality

import React, { useState } from 'react';
import type { Task } from '@/types/api';
import { useTaskManager } from '@/hooks/useTaskManager';
import { TaskSummary } from '@/components/TaskSummary';
import { TaskFilters } from '@/components/TaskFilters';
import { TaskList } from '@/components/TaskList';
import { TaskDetailModal } from '@/components/TaskDetailModal';
import { CreateTaskModal } from '@/components/CreateTaskModal';

interface TaskDashboardProps {
  sessionId: string;
}

export function TaskDashboard({ sessionId }: TaskDashboardProps) {
  const {
    tasks,
    isLoading,
    error,
    createTask,
    updateTask,
    deleteTask,
    addNote,
  } = useTaskManager(sessionId);

  const [statusFilter, setStatusFilter] = useState<Task['status'] | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Task['priority'] | 'all'>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Calculate summary from tasks
  const summary = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
  };

  // Filter tasks based on current filters
  const filteredTasks = tasks.filter((task) => {
    if (statusFilter !== 'all' && task.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
    if (assigneeFilter && task.assignedTo && !String(task.assignedTo).includes(assigneeFilter)) return false;
    return true;
  });

  const handleClearFilters = () => {
    setStatusFilter('all');
    setPriorityFilter('all');
    setAssigneeFilter('');
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
  };

  const handleStatusChange = async (taskId: string, status: Task['status']) => {
    try {
      await updateTask(taskId, { status });
    } catch (error) {
      console.error('Failed to update task status:', error);
    }
  };

  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    await updateTask(taskId, updates);
    // Update selected task if it's the one being edited
    if (selectedTask?.id === taskId) {
      const updatedTask = tasks.find((t) => t.id === taskId);
      if (updatedTask) {
        setSelectedTask(updatedTask);
      }
    }
  };

  const handleTaskDelete = async (taskId: string) => {
    await deleteTask(taskId);
    setSelectedTask(null);
  };

  const handleAddNote = async (taskId: string, content: string) => {
    await addNote(taskId, content);
    // Refresh selected task to show new note
    if (selectedTask?.id === taskId) {
      const updatedTask = tasks.find((t) => t.id === taskId);
      if (updatedTask) {
        setSelectedTask(updatedTask);
      }
    }
  };

  const handleCreateTask = async (taskData: {
    title: string;
    description?: string;
    prompt: string;
    priority?: Task['priority'];
    assignedTo?: string;
  }) => {
    try {
      await createTask(taskData);
      setShowCreateModal(false);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Task Management</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Create Task
        </button>
      </div>

      {/* Summary */}
      <TaskSummary summary={summary} loading={isLoading} />

      {/* Filters */}
      <TaskFilters
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
        assigneeFilter={assigneeFilter}
        onStatusChange={setStatusFilter}
        onPriorityChange={setPriorityFilter}
        onAssigneeChange={setAssigneeFilter}
        onClearFilters={handleClearFilters}
      />

      {/* Task List */}
      <div className="bg-white rounded-lg border p-4">
        <TaskList
          tasks={filteredTasks}
          onTaskClick={handleTaskClick}
          onStatusChange={handleStatusChange}
          loading={isLoading}
          error={error ?? undefined}
        />
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleTaskUpdate}
          onAddNote={handleAddNote}
          onDelete={handleTaskDelete}
        />
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <CreateTaskModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateTask}
        />
      )}
    </div>
  );
}