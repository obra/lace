// ABOUTME: Task detail modal component for viewing and editing tasks
// ABOUTME: Provides detailed view, editing capabilities, and note management

import React, { useState } from 'react';
import type { Task, AssigneeId } from '@/types/api';
import { TaskNotes } from '@/components/old/TaskNotes';

interface TaskDetailModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onAddNote: (taskId: string, content: string) => Promise<void>;
  onDelete?: (taskId: string) => Promise<void>;
}

export function TaskDetailModal({
  task,
  isOpen,
  onClose,
  onUpdate,
  onAddNote,
  onDelete,
}: TaskDetailModalProps) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: task.title,
    description: task.description ?? '',
    prompt: task.prompt,
    priority: task.priority,
    assignedTo: task.assignedTo ? String(task.assignedTo) : '',
    status: task.status,
  });
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updateData = {
        title: editForm.title,
        prompt: editForm.prompt,
        priority: editForm.priority,
        status: editForm.status,
        ...(editForm.description && { description: editForm.description }),
        ...(editForm.assignedTo && { assignedTo: editForm.assignedTo as AssigneeId }),
      };
      await onUpdate(task.id, updateData);
      setEditing(false);
    } catch (error) {
      console.error('Failed to update task:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditForm({
      title: task.title,
      description: task.description ?? '',
      prompt: task.prompt,
      priority: task.priority,
      assignedTo: task.assignedTo ? String(task.assignedTo) : '',
      status: task.status,
    });
    setEditing(false);
  };

  const handleAddNote = async (content: string) => {
    await onAddNote(task.id, content);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">
              {editing ? 'Edit Task' : 'Task Details'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Task details */}
          <div className="space-y-6">
            {editing ? (
              /* Edit form */
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, description: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Prompt (Agent Instructions)
                  </label>
                  <textarea
                    value={editForm.prompt}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, prompt: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                    <select
                      value={editForm.priority}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          priority: e.target.value as Task['priority'],
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select
                      value={editForm.status}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          status: e.target.value as Task['status'],
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Assigned To
                  </label>
                  <input
                    type="text"
                    value={editForm.assignedTo}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, assignedTo: e.target.value }))
                    }
                    placeholder="Thread ID or new:provider/model"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            ) : (
              /* View mode */
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{task.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        task.priority === 'high'
                          ? 'text-red-600 bg-red-50'
                          : task.priority === 'medium'
                            ? 'text-yellow-600 bg-yellow-50'
                            : 'text-green-600 bg-green-50'
                      }`}
                    >
                      {task.priority.toUpperCase()}
                    </span>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        task.status === 'completed'
                          ? 'text-green-600 bg-green-50'
                          : task.status === 'in_progress'
                            ? 'text-blue-600 bg-blue-50'
                            : task.status === 'blocked'
                              ? 'text-red-600 bg-red-50'
                              : 'text-gray-600 bg-gray-50'
                      }`}
                    >
                      {task.status.toUpperCase().replace('_', ' ')}
                    </span>
                  </div>
                </div>

                {task.description && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Description</h4>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{task.description}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-1">Agent Instructions</h4>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                    {task.prompt}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">Assigned to:</span>
                    <span className="ml-2 text-gray-600">
                      {task.assignedTo ? String(task.assignedTo) : 'Unassigned'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Created:</span>
                    <span className="ml-2 text-gray-600">
                      {new Date(task.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Notes section */}
            <div className="border-t pt-6">
              <TaskNotes notes={task.notes} onAddNote={handleAddNote} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center mt-6 pt-6 border-t">
            <div>
              {onDelete && (
                <button
                  onClick={() => onDelete(task.id)}
                  className="text-red-600 hover:text-red-700 text-sm"
                >
                  Delete Task
                </button>
              )}
            </div>

            <div className="flex gap-2">
              {editing ? (
                <>
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 text-gray-600 hover:text-gray-700"
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
