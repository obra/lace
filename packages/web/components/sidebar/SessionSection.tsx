// ABOUTME: Session sidebar section component with agent selection and status
// ABOUTME: Handles both mobile and desktop layouts with conditional behaviors

'use client';

import React, { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments, faRobot, faCog } from '@/lib/fontawesome';
import { SidebarSection, SidebarButton, SidebarItem } from '@/components/layout/Sidebar';
import type { SessionInfo, ThreadId, AgentInfo } from '@/types/core';

interface SessionSectionProps {
  selectedSessionDetails: SessionInfo;
  selectedAgent: ThreadId | null;
  isMobile?: boolean;
  onAgentSelect: (agentId: string) => void;
  onClearAgent: () => void;
  onCloseMobileNav?: () => void;
}

export const SessionSection = memo(function SessionSection({
  selectedSessionDetails,
  selectedAgent,
  isMobile = false,
  onAgentSelect,
  onClearAgent,
  onCloseMobileNav,
}: SessionSectionProps) {
  const handleContinueSession = () => {
    if (isMobile) {
      onCloseMobileNav?.();
    }
    // Could scroll to chat input or focus it in desktop mode
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
    onClearAgent();
    if (isMobile) {
      onCloseMobileNav?.();
    }
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
    ? selectedSessionDetails.agents?.find((a) => a.threadId === selectedAgent)
    : null;

  return (
    <SidebarSection
      title="Active Session"
      icon={faComments}
      defaultCollapsed={false}
      collapsible={false}
    >
      {/* Session Header */}
      <div className="bg-base-200/40 backdrop-blur-md border border-base-300/20 rounded-xl p-3 mb-3 shadow-sm -ml-1">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-sm text-base-content truncate">
            {selectedSessionDetails.name}
          </h4>
          {!selectedAgent && <span className="text-xs text-warning font-medium">Setup needed</span>}
        </div>

        {/* Agent Status or Selection */}
        {selectedAgent && currentAgent ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FontAwesomeIcon
                icon={faRobot}
                className="w-3.5 h-3.5 text-base-content/60 flex-shrink-0"
              />
              <span className="text-xs text-base-content/80 truncate">{currentAgent.name}</span>
            </div>
            <span
              className={`text-xs badge badge-xs ${getAgentStatusBadgeClass(currentAgent.status)}`}
            >
              {currentAgent.status}
            </span>
          </div>
        ) : (
          <div className="text-xs text-base-content/60">
            {selectedSessionDetails.agents?.length || 0} agents available
          </div>
        )}
      </div>

      {/* Primary Actions */}
      {selectedAgent && currentAgent ? (
        <div className="space-y-2">
          <SidebarButton
            onClick={handleContinueSession}
            variant="secondary"
            className="font-medium"
          >
            Continue Session
          </SidebarButton>

          {selectedSessionDetails.agents && selectedSessionDetails.agents.length > 1 && (
            <SidebarButton onClick={handleSwitchAgent} variant="ghost" size="sm">
              <FontAwesomeIcon icon={faRobot} className="w-3.5 h-3.5" />
              Switch Agent
            </SidebarButton>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Agent Selection */}
          {selectedSessionDetails.agents?.map((agent) => (
            <SidebarItem
              key={agent.threadId}
              active={selectedAgent === agent.threadId}
              onClick={() => handleAgentSelect(agent.threadId)}
              className="text-sm"
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
          )) || []}

          <SidebarButton onClick={handleConfigureSession} variant="ghost" size="sm">
            <FontAwesomeIcon icon={faCog} className="w-3.5 h-3.5" />
            Configure Session
          </SidebarButton>
        </div>
      )}
    </SidebarSection>
  );
});
