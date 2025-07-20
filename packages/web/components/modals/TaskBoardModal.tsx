'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTasks, faUser } from '~/lib/fontawesome';
import { Modal } from '~/components/ui/Modal';
import { Task } from '~/types';

interface TaskBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  onTaskUpdate?: (task: Task) => void;
  onTaskCreate?: (task: Omit<Task, 'id'>) => void;
}

interface TaskColumn {
  id: string;
  title: string;
  status: Task['status'];
  color: string;
}

const taskColumns: TaskColumn[] = [
  {
    id: 'todo',
    title: 'To Do',
    status: 'pending',
    color: 'bg-blue-100 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800',
  },
  {
    id: 'progress',
    title: 'In Progress',
    status: 'in_progress',
    color: 'bg-yellow-100 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800',
  },
  {
    id: 'review',
    title: 'Review',
    status: 'review',
    color: 'bg-purple-100 border-purple-200 dark:bg-purple-900/20 dark:border-purple-800',
  },
  {
    id: 'done',
    title: 'Done',
    status: 'completed',
    color: 'bg-green-100 border-green-200 dark:bg-green-900/20 dark:border-green-800',
  },
];

export function TaskBoardModal({
  isOpen,
  onClose,
  tasks,
  onTaskUpdate,
  onTaskCreate,
}: TaskBoardModalProps) {
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium' as Task['priority'],
    assignee: '',
  });

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTasksByStatus = (status: Task['status']) => {
    return tasks.filter((task) => task.status === status);
  };

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task);
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
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTask.title.trim()) {
      onTaskCreate?.({
        title: newTask.title,
        description: newTask.description,
        priority: newTask.priority,
        assignee: newTask.assignee || 'Unassigned',
        status: 'pending',
      });
      setNewTask({ title: '', description: '', priority: 'medium', assignee: '' });
      setShowNewTaskForm(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Task Board" size="full" className="h-[90vh]">
      <div className="h-full flex flex-col">
        {/* Header with actions */}
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-base-300">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faTasks} className="w-5 h-5 text-primary" />
            <span className="text-lg font-medium">Project Tasks</span>
            <span className="badge badge-primary">{tasks.length}</span>
          </div>

          <button onClick={() => setShowNewTaskForm(true)} className="btn btn-primary btn-sm">
            <FontAwesomeIcon icon={faPlus} className="w-4 h-4 mr-1" />
            New Task
          </button>
        </div>

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
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 overflow-hidden">
          {taskColumns.map((column) => {
            const columnTasks = getTasksByStatus(column.status);

            return (
              <div
                key={column.id}
                className="flex flex-col h-full"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, column.status)}
              >
                {/* Column header */}
                <div className={`p-3 rounded-t-lg border-2 ${column.color}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-base-content">{column.title}</h3>
                    <span className="badge badge-sm">{columnTasks.length}</span>
                  </div>
                </div>

                {/* Column content */}
                <div className="flex-1 bg-base-100 border-2 border-t-0 border-base-300 rounded-b-lg p-3 overflow-y-auto min-h-[200px]">
                  <div className="space-y-3">
                    {columnTasks.map((task) => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task)}
                        className="bg-base-200 border border-base-300 rounded-lg p-3 cursor-move hover:shadow-md transition-shadow"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between">
                            <h4 className="font-medium text-sm text-base-content leading-tight">
                              {task.title}
                            </h4>
                            <span
                              className={`px-1.5 py-0.5 text-xs rounded border ${getPriorityColor(task.priority)}`}
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
                              <span>{task.assignee}</span>
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
