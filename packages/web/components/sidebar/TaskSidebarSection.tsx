// ABOUTME: Task sidebar section component with overview and task list
// ABOUTME: Displays task statistics, board access, and TaskListSidebar integration

'use client';

import React, { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTasks } from '@/lib/fontawesome';
import { SidebarSection } from '@/components/layout/Sidebar';
import { TaskListSidebar } from '@/components/tasks/TaskListSidebar';
import { useTaskContext } from '@/components/providers/TaskProvider';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import type { Task } from '@/types/core';

interface TaskSidebarSectionProps {
  onCloseMobileNav?: () => void;
}

export const TaskSidebarSection = memo(function TaskSidebarSection({
  onCloseMobileNav,
}: TaskSidebarSectionProps) {
  const { taskManager, showTaskBoard, showTaskCreation, handleTaskDisplay } = useTaskContext();
  const { selectedProject } = useProjectContext();
  const { selectedSession } = useSessionContext();
  const { sessionDetails: selectedSessionDetails } = useAgentContext();

  if (!selectedSessionDetails || !selectedProject || !selectedSession || !taskManager) {
    return null;
  }

  const handleTaskBoardClick = () => {
    showTaskBoard();
    onCloseMobileNav?.();
  };

  const handleTaskCreationClick = () => {
    showTaskCreation();
    onCloseMobileNav?.();
  };

  const handleTaskClick = (task: Task) => {
    handleTaskDisplay(task);
    onCloseMobileNav?.();
  };

  const handleOpenTaskBoard = () => {
    showTaskBoard();
    onCloseMobileNav?.();
  };

  const handleCreateTask = () => {
    showTaskCreation();
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
              <div className="w-2 h-2 bg-success rounded-full"></div>
              <span>{completedCount} done</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-warning rounded-full"></div>
              <span>{activeCount} active</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-base-content/40 rounded-full"></div>
              <span>{pendingCount} pending</span>
            </div>
          </div>
        )}
      </div>

      {/* Task List */}
      <TaskListSidebar
        taskManager={taskManager}
        onOpenTaskBoard={handleOpenTaskBoard}
        onCreateTask={handleCreateTask}
      />
    </SidebarSection>
  );
});
