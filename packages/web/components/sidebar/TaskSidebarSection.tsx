// ABOUTME: Task sidebar section component with overview and task list
// ABOUTME: Displays task statistics, board access, and TaskListSidebar integration

'use client';

import React, { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTasks } from '@lace/web/lib/fontawesome';
import { SidebarSection } from '@lace/web/components/layout/Sidebar';
import { TaskListSidebar } from '@lace/web/components/tasks/TaskListSidebar';
import { useOptionalTaskContext } from '@lace/web/components/providers/TaskProvider';
import { useOptionalProjectsContext } from '@lace/web/components/providers/ProjectsProvider';
import { useOptionalProjectContext } from '@lace/web/components/providers/ProjectProvider';
import { useOptionalSessionContext } from '@lace/web/components/providers/SessionProvider';
import type { Task } from '@lace/web/types/core';

interface TaskSidebarSectionProps {
  onCloseMobileNav?: () => void;
}

export const TaskSidebarSection = memo(function TaskSidebarSection({
  onCloseMobileNav,
}: TaskSidebarSectionProps) {
  // Conditionally use contexts - some may not be available on all pages
  const taskContext = useOptionalTaskContext();
  const sessionContext = useOptionalSessionContext();
  const projectContext = useOptionalProjectContext();

  const projectsContext = useOptionalProjectsContext();
  const selectedProject = projectsContext?.selectedProject ?? null;
  const selectedSession = projectContext?.selectedSession ?? null;

  // Extract values with fallbacks
  const taskManager = taskContext?.taskManager ?? null;
  const showTaskBoard = taskContext?.showTaskBoard ?? (() => {});
  const showTaskCreation = taskContext?.showTaskCreation ?? (() => {});
  const handleTaskDisplay = taskContext?.handleTaskDisplay ?? (() => {});
  const selectedSessionDetails = sessionContext?.sessionDetails ?? null;

  if (!selectedSessionDetails || !selectedProject || !selectedSession || !taskManager) {
    return null;
  }

  const handleOpenTaskBoard = () => {
    showTaskBoard();
    onCloseMobileNav?.();
  };

  const handleCreateTask = () => {
    showTaskCreation();
    onCloseMobileNav?.();
  };

  const handleTaskClick = (task: Task) => {
    handleTaskDisplay(task);
    onCloseMobileNav?.();
  };

  // Filter to only show unassigned tasks
  const unassignedTasks = taskManager.tasks.filter((task: Task) => !task.assignedTo);

  const addTaskButton = (
    <button
      onClick={handleCreateTask}
      className="p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 border border-transparent hover:border-base-300/30"
      title="Add task"
      data-testid="add-task-button"
    >
      <FontAwesomeIcon icon={faPlus} className="w-3 h-3 text-base-content/60" />
    </button>
  );

  return (
    <SidebarSection
      title="Tasks"
      icon={faTasks}
      defaultCollapsed={false}
      collapsible={true}
      headerActions={addTaskButton}
    >
      {/* Task List - only unassigned tasks */}
      <TaskListSidebar
        taskManager={{
          ...taskManager,
          tasks: unassignedTasks,
        }}
        onOpenTaskBoard={handleOpenTaskBoard}
        onCreateTask={handleCreateTask}
      />
    </SidebarSection>
  );
});
