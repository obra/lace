// ABOUTME: Session sidebar section component with agent selection and status
// ABOUTME: Handles both mobile and desktop layouts with conditional behaviors

'use client';

import React, { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments, faCog } from '@/lib/fontawesome';
import { SidebarSection } from '@/components/layout/Sidebar';
import { SwitchIcon } from '@/components/ui/SwitchIcon';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useURLState } from '@/hooks/useURLState';

interface SessionSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
  onConfigureSession?: () => void;
}

export const SessionSection = memo(function SessionSection({
  isMobile = false,
  onCloseMobileNav,
  onConfigureSession,
}: SessionSectionProps) {
  // Get context data
  const { sessionDetails } = useAgentContext();
  const { selectedProject } = useProjectContext();
  const { navigateToProject } = useURLState();

  // Don't render if no session is selected
  if (!sessionDetails) {
    return null;
  }

  const handleViewSessions = () => {
    if (selectedProject) {
      navigateToProject(selectedProject);
      if (isMobile) {
        onCloseMobileNav?.();
      }
    }
  };

  const handleConfigureSession = () => {
    onConfigureSession?.();
  };

  // Header actions for session navigation
  const headerActions = selectedProject ? (
    <SwitchIcon
      onClick={handleViewSessions}
      title="Switch to sessions"
      aria-label="Switch to sessions view"
      size="sm"
      data-testid="session-switch-button"
    />
  ) : null;

  // Header actions for session navigation
  const sessionHeaderActions = (
    <div className="flex items-center gap-1">
      {onConfigureSession && (
        <button
          onClick={handleConfigureSession}
          className="p-1 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 border border-transparent hover:border-base-300/30"
          title="Configure session"
          data-testid="configure-session-button"
        >
          <FontAwesomeIcon
            icon={faCog}
            className="w-3 h-3 text-base-content/50 hover:text-base-content/70 transition-colors"
          />
        </button>
      )}
      {headerActions}
    </div>
  );

  return (
    <div className="ml-4">
      {' '}
      {/* Indent to show it's under workspace */}
      <SidebarSection
        title={sessionDetails.name}
        icon={faComments}
        defaultCollapsed={false}
        collapsible={false}
        headerActions={sessionHeaderActions}
      >
        <div></div>
      </SidebarSection>
    </div>
  );
});
