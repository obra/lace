// ABOUTME: Task management provider with context for task operations and modal state
// ABOUTME: Centralizes all task-related concerns including modals, handlers, and state

'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useTaskManager } from '@/hooks/useTaskManager';
import { useTaskHandlers } from '@/hooks/useTaskHandlers';
import { TaskBoardModal } from '@/components/modals/TaskBoardModal';
import { TaskCreationModal } from '@/components/modals/TaskCreationModal';
import { TaskDisplayModal } from '@/components/modals/TaskDisplayModal';
import type { Task, AgentInfo } from '@/types/core';

// Task context interface
interface TaskContextValue {
  // Task manager
  taskManager: ReturnType<typeof useTaskManager> | null;

  // Task handlers
  handleTaskUpdate: (task: Task) => Promise<void>;
  handleTaskCreate: (taskData: Omit<Task, 'id'>) => Promise<void>;
  handleTaskCreateFromModal: (
    taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'notes' | 'createdBy' | 'threadId'>
  ) => Promise<void>;
  handleTaskDisplay: (task: Task) => void;
  handleTaskUpdateFromModal: (taskId: string, updates: Partial<Task>) => Promise<void>;
  handleTaskAddNote: (taskId: string, content: string) => Promise<void>;

  // Modal controls
  showTaskBoard: () => void;
  showTaskCreation: () => void;
}

// Create context
const TaskContext = createContext<TaskContextValue | null>(null);

// Hook to use task context
export function useTaskContext() {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error('useTaskContext must be used within a TaskProvider');
  }
  return context;
}

// Provider props
interface TaskProviderProps {
  children: ReactNode;
  projectId: string | null;
  sessionId: string | null;
  agents?: AgentInfo[];
}

export function TaskProvider({ children, projectId, sessionId, agents = [] }: TaskProviderProps) {
  // Task modal states
  const [showTaskBoardModal, setShowTaskBoardModal] = useState(false);
  const [showTaskCreationModal, setShowTaskCreationModal] = useState(false);
  const [showTaskDisplayModal, setShowTaskDisplayModal] = useState(false);
  const [selectedTaskForDisplay, setSelectedTaskForDisplay] = useState<Task | null>(null);

  // Task manager - only create when we have project and session
  const taskManager = useTaskManager(projectId || '', sessionId || '');

  // Task handlers
  const {
    handleTaskUpdate,
    handleTaskCreate,
    handleTaskCreateFromModal: baseHandleTaskCreateFromModal,
    handleTaskDisplay: baseHandleTaskDisplay,
    handleTaskUpdateFromModal,
    handleTaskAddNote,
  } = useTaskHandlers({
    taskManager,
    onSetShowTaskCreation: setShowTaskCreationModal,
    onSetShowTaskDisplay: setShowTaskDisplayModal,
    onSetSelectedTaskForDisplay: setSelectedTaskForDisplay,
  });

  // Enhanced handlers with modal management
  const handleTaskCreateFromModal = async (
    taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'notes' | 'createdBy' | 'threadId'>
  ) => {
    await baseHandleTaskCreateFromModal(taskData);
    // Modal is closed by the base handler
  };

  const handleTaskDisplay = (task: Task) => {
    baseHandleTaskDisplay(task);
    // Modal state is set by the base handler
  };

  // Modal control functions
  const showTaskBoard = () => setShowTaskBoardModal(true);
  const showTaskCreation = () => setShowTaskCreationModal(true);

  // Context value
  const contextValue: TaskContextValue = {
    taskManager,
    handleTaskUpdate,
    handleTaskCreate,
    handleTaskCreateFromModal,
    handleTaskDisplay,
    handleTaskUpdateFromModal,
    handleTaskAddNote,
    showTaskBoard,
    showTaskCreation,
  };

  return (
    <TaskContext.Provider value={contextValue}>
      {children}

      {/* Task Board Modal */}
      {showTaskBoardModal && projectId && sessionId && taskManager && (
        <TaskBoardModal
          isOpen={showTaskBoardModal}
          onClose={() => setShowTaskBoardModal(false)}
          tasks={taskManager.tasks}
          onTaskUpdate={handleTaskUpdate}
          onTaskCreate={handleTaskCreate}
          onTaskClick={handleTaskDisplay}
        />
      )}

      {/* Task Creation Modal */}
      {showTaskCreationModal && projectId && sessionId && (
        <TaskCreationModal
          isOpen={showTaskCreationModal}
          onClose={() => setShowTaskCreationModal(false)}
          onCreateTask={handleTaskCreateFromModal}
          agents={agents}
          loading={taskManager?.isCreating || false}
        />
      )}

      {/* Task Display Modal */}
      {showTaskDisplayModal && selectedTaskForDisplay && (
        <TaskDisplayModal
          isOpen={showTaskDisplayModal}
          onClose={() => {
            setShowTaskDisplayModal(false);
            setSelectedTaskForDisplay(null);
          }}
          task={selectedTaskForDisplay}
          onUpdateTask={handleTaskUpdateFromModal}
          onAddNote={handleTaskAddNote}
          agents={agents}
          loading={taskManager?.isUpdating || false}
        />
      )}
    </TaskContext.Provider>
  );
}
