// ABOUTME: Shared sidebar content component for mobile and desktop sidebars
// ABOUTME: Contains ProjectSection, SessionSection, and TaskSidebarSection with conditional mobile behaviors

'use client';

import React, { memo } from 'react';
import { ThreadId } from '@/types/core';
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
  onAgentSelect: (threadId: ThreadId) => void;
  onClearAgent: () => void;
  onConfigureAgent?: (threadId: ThreadId) => void;
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
  // Single container with responsive classes to prevent hydration mismatches
  // Mobile: Normal flow layout, Desktop: Flex layout with feedback anchored to bottom
  return (
    <div className="lg:flex lg:flex-col lg:h-full">
      {/* Main content area - flex-1 only on desktop */}
      <div className="lg:flex-1">
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
            onConfigureSession={onConfigureSession}
          />
        )}

        {/* TASK MANAGEMENT */}
        <TaskSidebarSection onCloseMobileNav={isMobile ? onCloseMobileNav : undefined} />
      </div>

      {/* FEEDBACK - anchored to bottom on desktop only */}
      <div className="lg:mt-auto">
        <FeedbackSection isMobile={isMobile} onCloseMobileNav={onCloseMobileNav} />
      </div>
    </div>
  );
});
