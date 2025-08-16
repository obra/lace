// ABOUTME: Shared sidebar content component for mobile and desktop sidebars
// ABOUTME: Contains ProjectSection, SessionSection, and TaskSidebarSection with conditional mobile behaviors

'use client';

import React, { memo } from 'react';
import { ProjectSection } from '@/components/sidebar/ProjectSection';
import { SessionSection } from '@/components/sidebar/SessionSection';
import { TaskSidebarSection } from '@/components/sidebar/TaskSidebarSection';
import type { SessionInfo, ThreadId } from '@/types/core';
import { useTaskManager } from '@/hooks/useTaskManager';

type TaskManager = ReturnType<typeof useTaskManager>;

interface Project {
  id: string;
  name: string;
  description?: string;
}

interface SidebarContentProps {
  // Project context
  selectedProject: string | null;
  currentProject: Project;
  sessionsCount: number;

  // Session context
  selectedSession: ThreadId | null;
  selectedSessionDetails: SessionInfo | null;
  selectedAgent: ThreadId | null;

  // Task management
  taskManager: TaskManager | null;

  // Mobile behavior
  isMobile?: boolean;
  onCloseMobileNav?: () => void;

  // Event handlers
  onSwitchProject: () => void;
  onAgentSelect: (agentId: string) => void;
  onClearAgent: () => void;
  onShowTaskBoard: () => void;
  onShowTaskCreation: () => void;
}

export const SidebarContent = memo(function SidebarContent({
  selectedProject,
  currentProject,
  sessionsCount,
  selectedSession,
  selectedSessionDetails,
  selectedAgent,
  taskManager,
  isMobile = false,
  onCloseMobileNav,
  onSwitchProject,
  onAgentSelect,
  onClearAgent,
  onShowTaskBoard,
  onShowTaskCreation,
}: SidebarContentProps) {
  return (
    <>
      {/* WORKSPACE CONTEXT */}
      {selectedProject && (
        <ProjectSection
          currentProject={currentProject}
          sessionsCount={sessionsCount}
          selectedSessionDetails={selectedSessionDetails}
          isMobile={isMobile}
          onSwitchProject={onSwitchProject}
          onCloseMobileNav={isMobile ? onCloseMobileNav : undefined}
        />
      )}

      {/* ACTIVE SESSION */}
      {selectedSessionDetails && (
        <SessionSection
          selectedSessionDetails={selectedSessionDetails}
          selectedAgent={selectedAgent}
          isMobile={isMobile}
          onAgentSelect={onAgentSelect}
          onClearAgent={onClearAgent}
          onCloseMobileNav={isMobile ? onCloseMobileNav : undefined}
        />
      )}

      {/* TASK MANAGEMENT */}
      <TaskSidebarSection
        taskManager={taskManager}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        selectedSessionDetails={selectedSessionDetails}
        onShowTaskBoard={onShowTaskBoard}
        onShowTaskCreation={onShowTaskCreation}
        onCloseMobileNav={isMobile ? onCloseMobileNav : undefined}
      />
    </>
  );
});
