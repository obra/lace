'use client';

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTasks, faUser } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import { Task } from '@/lib/core';

interface TaskBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  columns?: TaskColumn[];
  onTaskUpdate?: (task: Task) => void;
  onTaskCreate?: (task: Omit<Task, 'id'>) => void;
  onTaskClick?: (task: Task) => void;
}

interface TaskColumn {
  id: string;
  title: string;
  status: Task['status'];
  color: string;
}

const DEFAULT_TASK_COLUMNS: TaskColumn[] = [
  {
    id: 'todo',
    title: 'To Do',
    status: 'pending',
    color: 'bg-info/10 border-info/20',
  },
  {
    id: 'progress',
    title: 'In Progress',
    status: 'in_progress',
    color: 'bg-warning/10 border-warning/20',
  },
  {
    id: 'blocked',
    title: 'Blocked',
    status: 'blocked',
    color: 'bg-secondary/10 border-secondary/20',
  },
  {
    id: 'done',
    title: 'Done',
    status: 'completed',
    color: 'bg-success/10 border-success/20',
  },
];

export function TaskBoardModal({
  isOpen,
  onClose,
  tasks,
  columns = DEFAULT_TASK_COLUMNS,
  onTaskUpdate,
  onTaskCreate,
  onTaskClick,
}: TaskBoardModalProps) {
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium' as Task['priority'],
    assignedTo: '',
  });

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'high':
        return 'badge-error';
      case 'medium':
        return 'badge-warning';
      case 'low':
        return 'badge-success';
      default:
        return 'badge-neutral';
    }
  };

  const getTasksByStatus = (status: Task['status']) => {
    return tasks.filter((task) => task.status === status);
  };

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task);
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, newStatus: Task['status']) => {
    e.preventDefault();
    if (draggedTask && draggedTask.status !== newStatus) {
      const updatedTask = { ...draggedTask, status: newStatus };
      onTaskUpdate?.(updatedTask);
    }
    setDraggedTask(null);
    setIsDragging(false);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setIsDragging(false);
  };

  const handleTaskClick = (task: Task) => {
    // Only handle click if we're not dragging
    if (!isDragging && onTaskClick) {
      onTaskClick(task);
    }
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTask.title.trim()) {
      onTaskCreate?.({
        title: newTask.title,
        description: newTask.description,
        priority: newTask.priority,
        assignedTo: newTask.assignedTo || undefined,
        status: 'pending',
      } as Omit<Task, 'id'>);
      setNewTask({ title: '', description: '', priority: 'medium', assignedTo: '' });
      setShowNewTaskForm(false);
    }
  };

  const modalTitle = (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        <FontAwesomeIcon icon={faTasks} className="w-5 h-5 text-primary" />
        <span className="text-lg font-semibold">Project Tasks</span>
        <span className="badge badge-primary">{tasks.length}</span>
      </div>
      <button onClick={() => setShowNewTaskForm(true)} className="btn btn-primary btn-sm">
        <FontAwesomeIcon icon={faPlus} className="w-4 h-4 mr-1" />
        New Task
      </button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="full" className="h-[90vh]">
      <div className="flex flex-col" style={{ height: 'calc(90vh - 140px)' }}>

        {/* New task form */}
        {showNewTaskForm && (
          <div className="bg-base-200 p-4 rounded-lg mb-4">
            <form onSubmit={handleCreateTask} className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Task title"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  className="input input-bordered w-full"
                  required
                />
                <select
                  value={newTask.priority}
                  onChange={(e) =>
                    setNewTask({ ...newTask, priority: e.target.value as Task['priority'] })
                  }
                  className="select select-bordered w-full"
                >
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                </select>
              </div>

              <textarea
                placeholder="Task description (optional)"
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                className="textarea textarea-bordered w-full"
                rows={2}
              />

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowNewTaskForm(false)}
                  className="btn btn-ghost btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Create Task
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Kanban board */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 min-h-0">
          {columns.map((column) => {
            const columnTasks = getTasksByStatus(column.status);

            return (
              <div
                key={column.id}
                className="flex flex-col min-h-0"
                data-testid="task-column"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, column.status)}
              >
                {/* Column header */}
                <div className={`p-3 rounded-t-lg border-2 ${column.color} flex-shrink-0`}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-base-content">{column.title}</h3>
                    <span className="badge badge-sm">{columnTasks.length}</span>
                  </div>
                </div>

                {/* Column content */}
                <div className="flex-1 bg-base-100 border-2 border-t-0 border-base-300 rounded-b-lg p-3 overflow-y-auto min-h-0">
                  <div className="space-y-3">
                    {columnTasks.map((task) => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task)}
                        onDragEnd={handleDragEnd}
                        onClick={() => handleTaskClick(task)}
                        className="bg-base-200 border border-base-300 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between">
                            <h4 className="font-medium text-sm text-base-content leading-tight">
                              {task.title}
                            </h4>
                            <span
                              className={`badge badge-xs ${getPriorityColor(task.priority)}`}
                            >
                              {task.priority}
                            </span>
                          </div>

                          {task.description && (
                            <p className="text-xs text-base-content/70 line-clamp-2">
                              {task.description}
                            </p>
                          )}

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 text-xs text-base-content/60">
                              <FontAwesomeIcon icon={faUser} className="w-3 h-3" />
                              <span>{task.assignedTo || 'Unassigned'}</span>
                            </div>

                            <div className="text-xs text-base-content/50">Task #{task.id}</div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Empty state */}
                    {columnTasks.length === 0 && (
                      <div className="text-center text-base-content/40 py-8">
                        <div className="text-2xl mb-2">📋</div>
                        <div className="text-sm">No tasks</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
