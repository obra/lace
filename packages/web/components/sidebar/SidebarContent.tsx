// ABOUTME: Shared sidebar content component for mobile and desktop sidebars
// ABOUTME: Contains ProjectSection, SessionSection, and TaskSidebarSection with conditional mobile behaviors

'use client';

import React, { memo } from 'react';
import { ProjectSection } from '@/components/sidebar/ProjectSection';
import { SessionSection } from '@/components/sidebar/SessionSection';
import { TaskSidebarSection } from '@/components/sidebar/TaskSidebarSection';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import type { ThreadId } from '@/types/core';

interface SidebarContentProps {
  // Mobile behavior
  isMobile?: boolean;
  onCloseMobileNav?: () => void;

  // Event handlers (still needed for parent coordination)
  onSwitchProject: () => void;
  onAgentSelect: (agentId: string) => void;
  onClearAgent: () => void;
  onConfigureAgent?: (agentId: string) => void;
}

export const SidebarContent = memo(function SidebarContent({
  isMobile = false,
  onCloseMobileNav,
  onSwitchProject,
  onAgentSelect,
  onClearAgent,
  onConfigureAgent,
}: SidebarContentProps) {
  // Get state from providers
  const { selectedProject } = useProjectContext();
  const { sessionDetails } = useAgentContext();
  return (
    <>
      {/* WORKSPACE CONTEXT */}
      {selectedProject && (
        <ProjectSection
          isMobile={isMobile}
          onCloseMobileNav={isMobile ? onCloseMobileNav : undefined}
          onSwitchProject={onSwitchProject}
        />
      )}

      {/* ACTIVE SESSION */}
      {sessionDetails && (
        <SessionSection
          isMobile={isMobile}
          onCloseMobileNav={isMobile ? onCloseMobileNav : undefined}
          onAgentSelect={onAgentSelect}
          onClearAgent={onClearAgent}
          onConfigureAgent={onConfigureAgent}
        />
      )}

      {/* TASK MANAGEMENT */}
      <TaskSidebarSection onCloseMobileNav={isMobile ? onCloseMobileNav : undefined} />
    </>
  );
});
