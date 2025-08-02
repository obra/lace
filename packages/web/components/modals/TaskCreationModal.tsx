// ABOUTME: Modal for creating new tasks with full field support
// ABOUTME: Includes agent assignment dropdown and all task properties

'use client';

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faUser, faFlag, faClipboard } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import type { ApiAgent } from '@/types/api';
import type { Task, AssigneeId, TaskPriority } from '@/types/core';

interface TaskCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'notes' | 'createdBy' | 'threadId'>) => void;
  agents?: ApiAgent[];
  loading?: boolean;
}

interface NewTaskData {
  title: string;
  description: string;
  prompt: string;
  priority: TaskPriority;
  assignedTo: AssigneeId | '';
  status: Task['status'];
}

export function TaskCreationModal({
  isOpen,
  onClose,
  onCreateTask,
  agents = [],
  loading = false,
}: TaskCreationModalProps) {
  const [taskData, setTaskData] = useState<NewTaskData>({
    title: '',
    description: '',
    prompt: '',
    priority: 'medium',
    assignedTo: '',
    status: 'pending',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleInputChange = (field: keyof NewTaskData, value: string | TaskPriority | Task['status'] | AssigneeId) => {
    setTaskData(prev => ({ ...prev, [field]: value as NewTaskData[typeof field] }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!taskData.title.trim()) {
      newErrors.title = 'Title is required';
    }

    if (!taskData.prompt.trim()) {
      newErrors.prompt = 'Prompt is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    const newTask = {
      title: taskData.title.trim(),
      description: taskData.description.trim() || '',
      prompt: taskData.prompt.trim(),
      priority: taskData.priority,
      assignedTo: taskData.assignedTo || undefined,
      status: taskData.status,
    };

    onCreateTask(newTask);
    handleClose();
  };

  const handleClose = () => {
    setTaskData({
      title: '',
      description: '',
      prompt: '',
      priority: 'medium',
      assignedTo: '',
      status: 'pending',
    });
    setErrors({});
    onClose();
  };

  const getPriorityColor = (priority: TaskPriority) => {
    switch (priority) {
      case 'high':
        return 'text-red-600';
      case 'medium':
        return 'text-yellow-600';
      case 'low':
        return 'text-green-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={handleClose} 
      title="Create New Task" 
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Title Field */}
        <div>
          <label className="label">
            <span className="label-text font-medium">Title *</span>
          </label>
          <input
            type="text"
            value={taskData.title}
            onChange={(e) => handleInputChange('title', e.target.value)}
            className={`input input-bordered w-full ${errors.title ? 'input-error' : ''}`}
            placeholder="Enter task title"
            disabled={loading}
          />
          {errors.title && (
            <label className="label">
              <span className="label-text-alt text-error">{errors.title}</span>
            </label>
          )}
        </div>

        {/* Description Field */}
        <div>
          <label className="label">
            <span className="label-text font-medium">Description</span>
          </label>
          <textarea
            value={taskData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            className="textarea textarea-bordered w-full"
            placeholder="Enter task description (optional)"
            rows={3}
            disabled={loading}
          />
        </div>

        {/* Prompt Field */}
        <div>
          <label className="label">
            <span className="label-text font-medium">
              <FontAwesomeIcon icon={faClipboard} className="w-4 h-4 mr-2" />
              Agent Prompt *
            </span>
          </label>
          <textarea
            value={taskData.prompt}
            onChange={(e) => handleInputChange('prompt', e.target.value)}
            className={`textarea textarea-bordered w-full ${errors.prompt ? 'textarea-error' : ''}`}
            placeholder="Enter detailed instructions for the agent"
            rows={4}
            disabled={loading}
          />
          {errors.prompt && (
            <label className="label">
              <span className="label-text-alt text-error">{errors.prompt}</span>
            </label>
          )}
        </div>

        {/* Priority and Status Row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">
              <span className="label-text font-medium">
                <FontAwesomeIcon icon={faFlag} className="w-4 h-4 mr-2" />
                Priority
              </span>
            </label>
            <select
              value={taskData.priority}
              onChange={(e) => handleInputChange('priority', e.target.value as TaskPriority)}
              className="select select-bordered w-full"
              disabled={loading}
            >
              <option value="low">🟢 Low Priority</option>
              <option value="medium">🟡 Medium Priority</option>
              <option value="high">🔴 High Priority</option>
            </select>
          </div>

          <div>
            <label className="label">
              <span className="label-text font-medium">Initial Status</span>
            </label>
            <select
              value={taskData.status}
              onChange={(e) => handleInputChange('status', e.target.value as Task['status'])}
              className="select select-bordered w-full"
              disabled={loading}
            >
              <option value="pending">📋 Pending</option>
              <option value="in_progress">⚡ In Progress</option>
              <option value="blocked">🚫 Blocked</option>
            </select>
          </div>
        </div>

        {/* Assign To Field */}
        <div>
          <label className="label">
            <span className="label-text font-medium">
              <FontAwesomeIcon icon={faUser} className="w-4 h-4 mr-2" />
              Assign To
            </span>
          </label>
          <select
            value={taskData.assignedTo}
            onChange={(e) => handleInputChange('assignedTo', e.target.value)}
            className="select select-bordered w-full"
            disabled={loading}
          >
            <option value="">👤 Unassigned</option>
            <option value="human">👨‍💻 Human</option>
            {agents.map((agent) => (
              <option key={agent.threadId} value={agent.threadId}>
                🤖 {agent.name} ({agent.model})
              </option>
            ))}
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end pt-4 border-t border-base-300">
          <button
            type="button"
            onClick={handleClose}
            className="btn btn-ghost"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="loading loading-spinner loading-sm"></span>
                Creating...
              </>
            ) : (
              <>
                <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                Create Task
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}