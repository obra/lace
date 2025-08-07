// ABOUTME: Modal for viewing and editing task details with history
// ABOUTME: Shows task information, allows editing, and displays task notes/history

'use client';

import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faSave, 
  faUser, 
  faFlag, 
  faClipboard, 
  faClock, 
  faEdit,
  faComment,
  faPlus
} from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import type { AgentInfo } from '@/types/core';
import type { Task, AssigneeId, TaskPriority, TaskNote } from '@/types/core';

interface TaskDisplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onAddNote?: (taskId: string, content: string) => void;
  agents?: AgentInfo[];
  loading?: boolean;
}

interface TaskEditData {
  title: string;
  description: string;
  prompt: string;
  priority: TaskPriority;
  assignedTo: AssigneeId | '';
  status: Task['status'];
}

export function TaskDisplayModal({
  isOpen,
  onClose,
  task,
  onUpdateTask,
  onAddNote,
  agents = [],
  loading = false,
}: TaskDisplayModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [editData, setEditData] = useState<TaskEditData>({
    title: '',
    description: '',
    prompt: '',
    priority: 'medium',
    assignedTo: '',
    status: 'pending',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Update edit data when task changes
  useEffect(() => {
    if (task) {
      setEditData({
        title: task.title,
        description: task.description || '',
        prompt: task.prompt,
        priority: task.priority,
        assignedTo: task.assignedTo || '',
        status: task.status,
      });
    }
  }, [task]);

  const handleInputChange = (field: keyof TaskEditData, value: string | TaskPriority | Task['status'] | AssigneeId) => {
    setEditData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!editData.title.trim()) {
      newErrors.title = 'Title is required';
    }

    if (!editData.prompt.trim()) {
      newErrors.prompt = 'Prompt is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!task || !validateForm()) {
      return;
    }

    const updates = {
      title: editData.title.trim(),
      description: editData.description.trim() || undefined,
      prompt: editData.prompt.trim(),
      priority: editData.priority,
      assignedTo: editData.assignedTo || undefined,
      status: editData.status,
    };

    onUpdateTask(task.id, updates);
    setIsEditing(false);
  };

  const handleCancel = () => {
    if (task) {
      setEditData({
        title: task.title,
        description: task.description || '',
        prompt: task.prompt,
        priority: task.priority,
        assignedTo: task.assignedTo || '',
        status: task.status,
      });
    }
    setErrors({});
    setIsEditing(false);
  };

  const handleAddNote = () => {
    if (!task || !newNote.trim() || !onAddNote) {
      return;
    }

    onAddNote(task.id, newNote.trim());
    setNewNote('');
    setShowAddNote(false);
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'pending':
        return 'badge-info';
      case 'in_progress':
        return 'badge-warning';
      case 'completed':
        return 'badge-success';
      case 'blocked':
        return 'badge-error';
      default:
        return 'badge-neutral';
    }
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

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleString();
  };

  const getAssigneeName = (assigneeId?: AssigneeId) => {
    if (!assigneeId) return 'Unassigned';
    if (assigneeId === 'human') return 'Human';
    
    const agent = agents.find(a => a.threadId === assigneeId);
    return agent ? `${agent.name} (${agent.model})` : assigneeId;
  };

  const getAuthorName = (author: string) => {
    if (author === 'human') return 'Human';
    
    const agent = agents.find(a => a.threadId === author);
    return agent ? `${agent.name} (${agent.model})` : author;
  };

  if (!task) {
    return null;
  }

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={isEditing ? 'Edit Task' : 'Task Details'} 
      size="lg"
    >
      <div className="space-y-6">
        {/* Task Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {isEditing ? (
              <div>
                <input
                  type="text"
                  value={editData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  className={`input input-bordered w-full text-lg font-semibold ${errors.title ? 'input-error' : ''}`}
                  placeholder="Task title"
                  disabled={loading}
                />
                {errors.title && (
                  <div className="text-error text-sm mt-1">{errors.title}</div>
                )}
              </div>
            ) : (
              <h2 className="text-xl font-semibold text-base-content">{task.title}</h2>
            )}
            
            <div className="flex items-center gap-4 mt-2 text-sm text-base-content/60">
              <span>Task #{task.id}</span>
              <span>Created {formatDate(task.createdAt)}</span>
              {task.updatedAt !== task.createdAt && (
                <span>Updated {formatDate(task.updatedAt)}</span>
              )}
            </div>
          </div>

          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="btn btn-ghost btn-sm"
              disabled={loading}
            >
              <FontAwesomeIcon icon={faEdit} className="w-4 h-4" />
              Edit
            </button>
          )}
        </div>

        {/* Task Metadata */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-base-content/70">Status</label>
            {isEditing ? (
              <select
                value={editData.status}
                onChange={(e) => handleInputChange('status', e.target.value as Task['status'])}
                className="select select-bordered select-sm w-full mt-1"
                disabled={loading}
              >
                <option value="pending">📋 Pending</option>
                <option value="in_progress">⚡ In Progress</option>
                <option value="blocked">🚫 Blocked</option>
                <option value="completed">✅ Completed</option>
              </select>
            ) : (
              <div className="mt-1">
                <span className={`badge ${getStatusColor(task.status)}`}>
                  {task.status.replace('_', ' ')}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-base-content/70">Priority</label>
            {isEditing ? (
              <select
                value={editData.priority}
                onChange={(e) => handleInputChange('priority', e.target.value as TaskPriority)}
                className="select select-bordered select-sm w-full mt-1"
                disabled={loading}
              >
                <option value="low">🟢 Low Priority</option>
                <option value="medium">🟡 Medium Priority</option>
                <option value="high">🔴 High Priority</option>
              </select>
            ) : (
              <div className="mt-1">
                <FontAwesomeIcon 
                  icon={faFlag} 
                  className={`w-4 h-4 ${getPriorityColor(task.priority)}`} 
                />
                <span className="ml-2 capitalize">{task.priority}</span>
              </div>
            )}
          </div>

          <div className="col-span-2">
            <label className="text-sm font-medium text-base-content/70">
              <FontAwesomeIcon icon={faUser} className="w-4 h-4 mr-2" />
              Assigned To
            </label>
            {isEditing ? (
              <select
                value={editData.assignedTo}
                onChange={(e) => handleInputChange('assignedTo', e.target.value as AssigneeId | '')}
                className="select select-bordered select-sm w-full mt-1"
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
            ) : (
              <div className="mt-1 text-base-content">
                {getAssigneeName(task.assignedTo)}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        {(task.description || isEditing) && (
          <div>
            <label className="text-sm font-medium text-base-content/70">Description</label>
            {isEditing ? (
              <textarea
                value={editData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                className="textarea textarea-bordered w-full mt-1"
                placeholder="Task description (optional)"
                rows={3}
                disabled={loading}
              />
            ) : (
              <div className="mt-1 text-base-content whitespace-pre-wrap">
                {task.description || <span className="text-base-content/50 italic">No description</span>}
              </div>
            )}
          </div>
        )}

        {/* Agent Prompt */}
        <div>
          <label className="text-sm font-medium text-base-content/70">
            <FontAwesomeIcon icon={faClipboard} className="w-4 h-4 mr-2" />
            Agent Prompt
          </label>
          {isEditing ? (
            <div>
              <textarea
                value={editData.prompt}
                onChange={(e) => handleInputChange('prompt', e.target.value)}
                className={`textarea textarea-bordered w-full mt-1 ${errors.prompt ? 'textarea-error' : ''}`}
                placeholder="Instructions for the agent"
                rows={4}
                disabled={loading}
              />
              {errors.prompt && (
                <div className="text-error text-sm mt-1">{errors.prompt}</div>
              )}
            </div>
          ) : (
            <div className="mt-1 bg-base-200 p-3 rounded-lg text-base-content whitespace-pre-wrap">
              {task.prompt}
            </div>
          )}
        </div>

        {/* Task Notes/History */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-base-content/70">
              <FontAwesomeIcon icon={faComment} className="w-4 h-4 mr-2" />
              Notes & History ({task.notes.length})
            </label>
            {onAddNote && !showAddNote && (
              <button
                onClick={() => setShowAddNote(true)}
                className="btn btn-ghost btn-xs"
                disabled={loading}
              >
                <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                Add Note
              </button>
            )}
          </div>

          {/* Add Note Form */}
          {showAddNote && (
            <div className="bg-base-200 p-3 rounded-lg mb-3">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="textarea textarea-bordered w-full"
                placeholder="Add a note about this task..."
                rows={3}
                disabled={loading}
              />
              <div className="flex gap-2 justify-end mt-2">
                <button
                  onClick={() => {
                    setShowAddNote(false);
                    setNewNote('');
                  }}
                  className="btn btn-ghost btn-xs"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddNote}
                  className="btn btn-primary btn-xs"
                  disabled={loading || !newNote.trim()}
                >
                  Add Note
                </button>
              </div>
            </div>
          )}

          {/* Notes List */}
          <div className="space-y-3 max-h-60 overflow-y-auto">
            {task.notes.length === 0 ? (
              <div className="text-center text-base-content/50 py-4">
                No notes yet
              </div>
            ) : (
              task.notes.map((note) => (
                <div key={note.id} className="bg-base-100 border border-base-300 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm text-base-content/60 mb-2">
                    <FontAwesomeIcon icon={faClock} className="w-3 h-3" />
                    <span>{formatDate(note.timestamp)}</span>
                    <span>•</span>
                    <span>{getAuthorName(note.author)}</span>
                  </div>
                  <div className="text-base-content whitespace-pre-wrap">
                    {note.content}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end pt-4 border-t border-base-300">
          {isEditing ? (
            <>
              <button
                onClick={handleCancel}
                className="btn btn-ghost"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Saving...
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faSave} className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="btn btn-ghost"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}