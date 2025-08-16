// ABOUTME: Task sidebar section component with overview and task list
// ABOUTME: Displays task statistics, board access, and TaskListSidebar integration

'use client';

import React, { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTasks } from '@/lib/fontawesome';
import { SidebarSection } from '@/components/layout/Sidebar';
import { TaskListSidebar } from '@/components/tasks/TaskListSidebar';
import { useTaskManager } from '@/hooks/useTaskManager';
import type { SessionInfo, ThreadId, Task } from '@/types/core';

type TaskManager = ReturnType<typeof useTaskManager>;

interface TaskSidebarSectionProps {
  taskManager: TaskManager | null;
  selectedProject: string | null;
  selectedSession: ThreadId | null;
  selectedSessionDetails: SessionInfo | null;
  onShowTaskBoard: () => void;
  onShowTaskCreation: () => void;
  onCloseMobileNav?: () => void;
}

export const TaskSidebarSection = memo(function TaskSidebarSection({
  taskManager,
  selectedProject,
  selectedSession,
  selectedSessionDetails,
  onShowTaskBoard,
  onShowTaskCreation,
  onCloseMobileNav,
}: TaskSidebarSectionProps) {
  if (!selectedSessionDetails || !selectedProject || !selectedSession || !taskManager) {
    return null;
  }

  const handleTaskBoardClick = () => {
    onShowTaskBoard();
    onCloseMobileNav?.();
  };

  const handleTaskCreationClick = () => {
    onShowTaskCreation();
    onCloseMobileNav?.();
  };

  const handleTaskClick = (taskId: string) => {
    // For now, just close mobile nav - could open task detail modal in future
    onCloseMobileNav?.();
  };

  const handleOpenTaskBoard = () => {
    onShowTaskBoard();
    onCloseMobileNav?.();
  };

  const handleCreateTask = () => {
    onShowTaskCreation();
    onCloseMobileNav?.();
  };

  const completedCount = taskManager.tasks.filter((t: Task) => t.status === 'completed').length;
  const activeCount = taskManager.tasks.filter((t: Task) => t.status === 'in_progress').length;
  const pendingCount = taskManager.tasks.filter((t: Task) => t.status === 'pending').length;

  return (
    <SidebarSection title="Tasks" icon={faTasks} defaultCollapsed={false} collapsible={true}>
      {/* Task Overview */}
      <div className="bg-base-300/20 backdrop-blur-sm border border-base-300/15 rounded-xl p-3 mb-3 shadow-sm -ml-1">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={handleTaskBoardClick}
            className="text-sm font-medium text-base-content hover:text-base-content/80 transition-colors"
            disabled={taskManager.tasks.length === 0}
          >
            Task Board ({taskManager.tasks.length})
          </button>
          <button
            onClick={handleTaskCreationClick}
            className="p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 border border-transparent hover:border-base-300/30"
            title="Add task"
            data-testid="add-task-button"
          >
            <FontAwesomeIcon icon={faPlus} className="w-3 h-3 text-base-content/60" />
          </button>
        </div>

        {taskManager.tasks.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-base-content/60">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
              <span>{completedCount} done</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
              <span>{activeCount} active</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
              <span>{pendingCount} pending</span>
            </div>
          </div>
        )}
      </div>

      {/* Task List */}
      <TaskListSidebar
        taskManager={taskManager}
        onTaskClick={handleTaskClick}
        onOpenTaskBoard={handleOpenTaskBoard}
        onCreateTask={handleCreateTask}
      />
    </SidebarSection>
  );
});
