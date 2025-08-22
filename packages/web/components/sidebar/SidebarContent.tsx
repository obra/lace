// ABOUTME: Shared sidebar content component for mobile and desktop sidebars
// ABOUTME: Contains ProjectSection, SessionSection, and TaskSidebarSection with conditional mobile behaviors

'use client';

import React, { memo } from 'react';
import { ProjectSection } from '@/components/sidebar/ProjectSection';
import { SessionSection } from '@/components/sidebar/SessionSection';
import { TaskSidebarSection } from '@/components/sidebar/TaskSidebarSection';
import { FeedbackSection } from '@/components/sidebar/FeedbackSection';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useOptionalAgentContext } from '@/components/providers/AgentProvider';

interface SidebarContentProps {
  // Mobile behavior
  isMobile?: boolean;
  onCloseMobileNav?: () => void;

  // Event handlers (still needed for parent coordination)
  onSwitchProject: () => void;
  onAgentSelect: (agentId: string) => void;
  onClearAgent: () => void;
  onConfigureAgent?: (agentId: string) => void;
  onConfigureSession?: () => void;
}

export const SidebarContent = memo(function SidebarContent({
  isMobile = false,
  onCloseMobileNav,
  onSwitchProject,
  onAgentSelect,
  onClearAgent,
  onConfigureAgent,
  onConfigureSession,
}: SidebarContentProps) {
  // Get state from providers
  const { selectedProject } = useProjectContext();
  // Conditionally use AgentContext - it may not be available on all pages
  const agentContext = useOptionalAgentContext();
  const sessionDetails = agentContext?.sessionDetails ?? null;
  // Mobile: Use regular flow layout (don't anchor to bottom, let mobile footer handle it)
  // Desktop: Use flex layout with feedback anchored to bottom
  if (isMobile) {
    return (
      <>
        {/* WORKSPACE CONTEXT */}
        {selectedProject && (
          <ProjectSection
            isMobile={isMobile}
            onCloseMobileNav={onCloseMobileNav}
            onSwitchProject={onSwitchProject}
          />
        )}

        {/* ACTIVE SESSION */}
        {sessionDetails && (
          <SessionSection
            isMobile={isMobile}
            onCloseMobileNav={onCloseMobileNav}
            onAgentSelect={onAgentSelect}
            onClearAgent={onClearAgent}
            onConfigureAgent={onConfigureAgent}
            onConfigureSession={onConfigureSession}
          />
        )}

        {/* TASK MANAGEMENT */}
        <TaskSidebarSection onCloseMobileNav={onCloseMobileNav} />

        {/* FEEDBACK - just in normal flow on mobile */}
        <FeedbackSection isMobile={isMobile} onCloseMobileNav={onCloseMobileNav} />
      </>
    );
  }

  // Desktop: Use flex layout with feedback anchored to bottom
  return (
    <div className="flex flex-col h-full">
      {/* Main content area */}
      <div className="flex-1">
        {/* WORKSPACE CONTEXT */}
        {selectedProject && (
          <ProjectSection isMobile={isMobile} onSwitchProject={onSwitchProject} />
        )}

        {/* ACTIVE SESSION */}
        {sessionDetails && (
          <SessionSection
            isMobile={isMobile}
            onAgentSelect={onAgentSelect}
            onClearAgent={onClearAgent}
            onConfigureAgent={onConfigureAgent}
            onConfigureSession={onConfigureSession}
          />
        )}

        {/* TASK MANAGEMENT */}
        <TaskSidebarSection />
      </div>

      {/* FEEDBACK - anchored to bottom on desktop */}
      <div className="mt-auto">
        <FeedbackSection isMobile={isMobile} onCloseMobileNav={onCloseMobileNav} />
      </div>
    </div>
  );
});
