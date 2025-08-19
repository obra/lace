// ABOUTME: Session sidebar section component with agent selection and status
// ABOUTME: Handles both mobile and desktop layouts with conditional behaviors

'use client';

import React, { memo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments, faRobot, faCog } from '@/lib/fontawesome';
import { SidebarSection, SidebarButton, SidebarItem } from '@/components/layout/Sidebar';
import { SwitchIcon } from '@/components/ui/SwitchIcon';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useURLState } from '@/hooks/useURLState';
import type { ThreadId, AgentInfo } from '@/types/core';

interface SessionSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
  onAgentSelect: (agentId: string) => void;
  onClearAgent: () => void;
  onConfigureAgent?: (agentId: string) => void;
  onConfigureSession?: () => void;
}

export const SessionSection = memo(function SessionSection({
  isMobile = false,
  onCloseMobileNav,
  onAgentSelect,
  onClearAgent,
  onConfigureAgent,
  onConfigureSession,
}: SessionSectionProps) {
  // Get context data
  const { sessionDetails, selectedAgent } = useAgentContext();
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

  const handleSwitchAgent = () => {
    onClearAgent();
    if (isMobile) {
      onCloseMobileNav?.();
    }
  };

  const handleAgentSelect = (agentId: string) => {
    onAgentSelect(agentId);
    if (isMobile) {
      onCloseMobileNav?.();
    }
  };

  const handleConfigureSession = () => {
    onConfigureSession?.();
  };

  const getAgentStatusBadgeClass = (status: AgentInfo['status']) => {
    switch (status) {
      case 'idle':
        return 'badge-success';
      case 'thinking':
      case 'tool_execution':
      case 'streaming':
        return 'badge-warning';
      default:
        return 'badge-neutral';
    }
  };

  // Find current agent for display
  const currentAgent = selectedAgent
    ? sessionDetails.agents?.find((a) => a.threadId === selectedAgent)
    : null;

  // Header actions for session navigation
  const headerActions = selectedProject ? (
    <SwitchIcon
      onClick={handleViewSessions}
      title="Switch to sessions"
      size="sm"
      data-testid="session-switch-button"
    />
  ) : null;

  return (
    <SidebarSection
      title="Session"
      icon={faComments}
      defaultCollapsed={false}
      collapsible={false}
      headerActions={headerActions}
    >
      {/* Session Header */}
      <div className="bg-base-200/40 backdrop-blur-md border border-base-300/20 rounded-xl p-3 mb-3 shadow-sm -ml-1">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm text-base-content truncate">{sessionDetails.name}</h4>
          <button
            onClick={handleConfigureSession}
            className="btn btn-ghost btn-xs p-1 min-h-0 h-auto flex-shrink-0"
            title="Configure session"
          >
            <FontAwesomeIcon icon={faCog} className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Agent List */}
      <div className="space-y-2">
        {sessionDetails.agents?.map((agent) => (
          <div key={agent.threadId} className="flex items-center gap-1">
            <SidebarItem
              active={selectedAgent === agent.threadId}
              onClick={() => handleAgentSelect(agent.threadId)}
              className="text-sm flex-1"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <FontAwesomeIcon icon={faRobot} className="w-3.5 h-3.5 text-base-content/60" />
                  <span className="font-medium truncate">{agent.name}</span>
                </div>
                <span
                  className={`text-xs badge badge-xs ${getAgentStatusBadgeClass(agent.status)}`}
                >
                  {agent.status}
                </span>
              </div>
            </SidebarItem>
            {onConfigureAgent && (
              <button
                onClick={() => onConfigureAgent(agent.threadId)}
                className="btn btn-ghost btn-xs p-1 min-h-0 h-auto flex-shrink-0"
                title="Configure agent"
              >
                <FontAwesomeIcon icon={faCog} className="w-3 h-3" />
              </button>
            )}
          </div>
        )) || []}
      </div>
    </SidebarSection>
  );
});
