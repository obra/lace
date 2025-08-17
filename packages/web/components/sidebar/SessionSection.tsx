// ABOUTME: Session sidebar section component with agent selection and status
// ABOUTME: Handles both mobile and desktop layouts with conditional behaviors

'use client';

import React, { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments, faRobot, faCog } from '@/lib/fontawesome';
import { SidebarSection, SidebarButton, SidebarItem } from '@/components/layout/Sidebar';
import { useAgentContext } from '@/components/providers/AgentProvider';
import type { ThreadId, AgentInfo } from '@/types/core';

interface SessionSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
  onAgentSelect: (agentId: string) => void;
  onClearAgent: () => void;
}

export const SessionSection = memo(function SessionSection({
  isMobile = false,
  onCloseMobileNav,
  onAgentSelect,
  onClearAgent,
}: SessionSectionProps) {
  // Get agent data from AgentProvider
  const { sessionDetails, selectedAgent } = useAgentContext();

  // Don't render if no session is selected
  if (!sessionDetails) {
    return null;
  }

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
    ? sessionDetails.agents?.find((a) => a.threadId === selectedAgent)
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
          <h4 className="font-medium text-sm text-base-content truncate">{sessionDetails.name}</h4>
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
            {sessionDetails.agents?.length || 0} agents available
          </div>
        )}
      </div>

      {/* Primary Actions */}
      {selectedAgent && currentAgent ? (
        <div className="space-y-2">
          {sessionDetails.agents && sessionDetails.agents.length > 1 && (
            <SidebarButton onClick={handleSwitchAgent} variant="ghost" size="sm">
              <FontAwesomeIcon icon={faRobot} className="w-3.5 h-3.5" />
              Switch Agent
            </SidebarButton>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Agent Selection */}
          {sessionDetails.agents?.map((agent) => (
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
