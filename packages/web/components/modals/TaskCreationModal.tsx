// ABOUTME: Modern task creation modal with intuitive controls and contemporary typography
// ABOUTME: Features priority buttons, status chips, and conversational agent prompting

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faUser, faRobot } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import type { Task, AssigneeId, TaskPriority, AgentInfo } from '@/types/core';

interface TaskCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateTask: (
    task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'notes' | 'createdBy' | 'threadId'>
  ) => void;
  agents?: AgentInfo[];
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
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Focus the title input when modal opens
  useEffect(() => {
    if (isOpen && titleInputRef.current) {
      // Small delay to ensure modal animation is complete
      const timer = setTimeout(() => {
        titleInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleTitleChange = (value: string) => {
    handleInputChange('title', value);
  };

  const handleInputChange = (
    field: keyof NewTaskData,
    value: string | TaskPriority | Task['status'] | AssigneeId
  ) => {
    setTaskData((prev) => ({ ...prev, [field]: value as NewTaskData[typeof field] }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!taskData.title.trim()) {
      newErrors.title = 'Please describe what needs to be done';
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
      prompt: taskData.prompt.trim() || taskData.title.trim(), // Use title as fallback prompt
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
        return 'text-error';
      case 'medium':
        return 'text-warning';
      case 'low':
        return 'text-success';
      default:
        return 'text-base-content/60';
    }
  };

  const getPriorityBorderColor = (priority: TaskPriority) => {
    switch (priority) {
      case 'high':
        return 'oklch(var(--er, 65.69% 0.199 27.33))'; // DaisyUI error
      case 'medium':
        return 'oklch(var(--wa, 84.71% 0.199 83.87))'; // DaisyUI warning
      case 'low':
        return 'oklch(var(--su, 64.8% 0.150 160))'; // DaisyUI success
      default:
        return 'rgb(156, 163, 175)'; // neutral gray
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create Task" size="lg">
      <div className="px-6 py-4">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Always Visible: Title Field */}
          <div className="space-y-3">
            <label className="block text-base font-medium text-base-content/90 leading-7 px-4">
              What needs to be done?
            </label>

            <div className="relative bg-base-200/60 rounded-lg px-4 py-2 border border-base-300/30">
              <input
                ref={titleInputRef}
                type="text"
                value={taskData.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className={`w-full bg-transparent text-lg leading-relaxed py-3 px-0 border-0 outline-none focus:ring-0 placeholder:text-base-content/50`}
                placeholder="Type your task here..."
                disabled={loading}
              />
              {errors.title && <p className="text-sm text-error mt-2 leading-5">{errors.title}</p>}
            </div>
          </div>

          {/* All Options */}
          <div className="space-y-6">
            {/* Description Field */}
            <div className="space-y-4">
              <label className="block text-base font-medium text-base-content/90 leading-7 px-4">
                More details{' '}
                <span className="text-base-content/50 font-normal text-sm">(optional)</span>
              </label>
              <div className="relative bg-base-200/60 rounded-lg px-4 py-2 border border-base-300/30">
                <textarea
                  value={taskData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  className="w-full bg-transparent text-lg leading-relaxed py-3 px-0 border-0 outline-none focus:ring-0 placeholder:text-base-content/50 resize-none min-h-[100px]"
                  placeholder="Add context, requirements, or additional details..."
                  rows={4}
                  disabled={loading}
                />
              </div>
            </div>

            {/* Priority Selection */}
            <div className="space-y-6">
              <label className="block text-base font-medium text-base-content/90 leading-7">
                Priority level
              </label>
              <div className="space-y-4">
                {/* Range Slider */}
                <div className="relative py-4">
                  <div className="mx-3 relative">
                    {/* Track background */}
                    <div className="w-full h-1.5 bg-base-200/40 rounded-full"></div>

                    {/* Native range input */}
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="1"
                      value={
                        taskData.priority === 'low' ? 0 : taskData.priority === 'medium' ? 1 : 2
                      }
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        const priorityMap: TaskPriority[] = ['low', 'medium', 'high'];
                        handleInputChange('priority', priorityMap[value]);
                      }}
                      className="absolute top-0 w-full h-1.5 appearance-none bg-transparent cursor-pointer outline-none"
                      disabled={loading}
                    />

                    {/* Custom thumb */}
                    <div
                      className="absolute top-1/2 w-5 h-5 rounded-full bg-white border-2 shadow-sm transition-all duration-300 transform -translate-y-1/2 -translate-x-1/2 pointer-events-none"
                      style={{
                        left: `${taskData.priority === 'low' ? 0 : taskData.priority === 'medium' ? 50 : 100}%`,
                        borderColor: getPriorityBorderColor(taskData.priority),
                      }}
                    />
                  </div>

                  {/* Labels */}
                  <div className="flex justify-between text-sm mt-4 mx-3">
                    <span
                      className={`transition-colors duration-200 ${taskData.priority === 'low' ? 'font-medium text-success' : 'text-base-content/60'}`}
                    >
                      Low
                    </span>
                    <span
                      className={`transition-colors duration-200 ${taskData.priority === 'medium' ? 'font-medium text-warning' : 'text-base-content/60'}`}
                    >
                      Medium
                    </span>
                    <span
                      className={`transition-colors duration-200 ${taskData.priority === 'high' ? 'font-medium text-error' : 'text-base-content/60'}`}
                    >
                      High
                    </span>
                  </div>

                  <style>{`
                      input[type="range"]::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        width: 20px;
                        height: 20px;
                        background: transparent;
                        cursor: pointer;
                        border-radius: 50%;
                      }
                      input[type="range"]::-webkit-slider-track {
                        background: transparent;
                      }
                      input[type="range"]::-moz-range-thumb {
                        width: 20px;
                        height: 20px;
                        background: transparent;
                        cursor: pointer;
                        border: none;
                        border-radius: 50%;
                      }
                      input[type="range"]::-moz-range-track {
                        background: transparent;
                        border: none;
                      }
                    `}</style>
                </div>
              </div>
            </div>

            {/* Status Selection */}
            <div className="space-y-6">
              <label className="block text-base font-medium text-base-content/90 leading-7">
                Starting status
              </label>
              <div className="flex gap-3">
                {(['pending', 'in_progress'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => handleInputChange('status', status)}
                    className={`px-6 py-3 rounded-xl text-sm font-medium transition-all duration-200 leading-6 ${
                      taskData.status === status
                        ? 'bg-base-100 text-base-content shadow-sm border-2 border-base-400'
                        : 'bg-base-100/60 text-base-content/70 border-2 border-transparent hover:bg-base-100 hover:text-base-content hover:border-base-300/50'
                    }`}
                    disabled={loading}
                  >
                    {status === 'pending' ? 'Ready to start' : 'Start immediately'}
                  </button>
                ))}
              </div>
            </div>

            {/* Agent Assignment */}
            {agents && agents.length > 0 && (
              <div className="space-y-6">
                <label className="block text-base font-medium text-base-content/90 leading-7">
                  Who should work on this?
                </label>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => handleInputChange('assignedTo', '')}
                    className={`px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200 leading-6 ${
                      taskData.assignedTo === ''
                        ? 'bg-base-100 text-base-content shadow-sm border-2 border-base-400'
                        : 'bg-base-100/60 text-base-content/70 border-2 border-transparent hover:bg-base-100 hover:text-base-content hover:border-base-300/50'
                    }`}
                    disabled={loading}
                  >
                    <FontAwesomeIcon icon={faUser} className="w-3.5 h-3.5 mr-2" />
                    Unassigned
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInputChange('assignedTo', 'human')}
                    className={`px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200 leading-6 ${
                      taskData.assignedTo === 'human'
                        ? 'bg-base-100 text-base-content shadow-sm border-2 border-base-400'
                        : 'bg-base-100/60 text-base-content/70 border-2 border-transparent hover:bg-base-100 hover:text-base-content hover:border-base-300/50'
                    }`}
                    disabled={loading}
                  >
                    <FontAwesomeIcon icon={faUser} className="w-3.5 h-3.5 mr-2" />
                    Human
                  </button>
                  {agents.map((agent) => (
                    <button
                      key={agent.threadId}
                      type="button"
                      onClick={() => handleInputChange('assignedTo', agent.threadId)}
                      className={`px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200 leading-6 truncate max-w-[220px] ${
                        taskData.assignedTo === agent.threadId
                          ? 'bg-base-100 text-base-content shadow-sm border-2 border-base-400'
                          : 'bg-base-100/60 text-base-content/70 border-2 border-transparent hover:bg-base-100 hover:text-base-content hover:border-base-300/50'
                      }`}
                      disabled={loading}
                      title={`${agent.name} (${agent.modelId})`}
                    >
                      <FontAwesomeIcon icon={faRobot} className="w-3.5 h-3.5 mr-2" />
                      {agent.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Agent Prompt Field - Only show if agent is assigned */}
            {taskData.assignedTo && taskData.assignedTo !== 'human' && (
              <div className="space-y-4">
                <label className="block text-base font-medium text-base-content/90 leading-7 px-4">
                  Anything else we should tell the agent?{' '}
                  <span className="text-base-content/50 font-normal text-sm">(optional)</span>
                </label>
                <div className="relative bg-base-200/60 rounded-lg px-4 py-2 border border-base-300/30">
                  <textarea
                    value={taskData.prompt}
                    onChange={(e) => handleInputChange('prompt', e.target.value)}
                    className="w-full bg-transparent text-lg leading-relaxed py-4 px-0 border-0 outline-none focus:ring-0 placeholder:text-base-content/50 resize-none min-h-[120px]"
                    placeholder="Use this specific framework, follow these patterns, consider edge cases..."
                    rows={5}
                    disabled={loading}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 justify-end pt-8 mt-8">
            <button
              type="button"
              onClick={handleClose}
              className="px-6 py-3 text-base font-medium text-base-content/70 hover:text-base-content transition-colors duration-200 leading-6"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-8 py-3 bg-base-100 text-base-content border-2 border-success hover:bg-success/10 hover:border-success rounded-xl font-medium text-base leading-6 transition-all duration-200 shadow-sm"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-sm mr-2"></span>
                  Creating...
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faPlus} className="w-4 h-4 mr-2" />
                  Create Task
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
