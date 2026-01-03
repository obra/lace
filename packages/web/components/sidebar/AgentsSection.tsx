// ABOUTME: Agents sidebar section component showing list of available agents
// ABOUTME: Displays agent status badges and allows selection between agents

'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot, faPlus } from '@lace/web/lib/fontawesome';
import { SidebarItem, SidebarSection } from '@lace/web/components/layout/Sidebar';
import { useSessionContext } from '@lace/web/components/providers/SessionProvider';
import type { ThreadId, AgentInfo } from '@lace/web/types/core';

interface AgentsSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
  onAgentSelect: (agentId: ThreadId) => void;
  onCreateAgent?: () => void;
  createAgentButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export function AgentsSection({
  isMobile = false,
  onCloseMobileNav,
  onAgentSelect,
  onCreateAgent,
  createAgentButtonRef,
}: AgentsSectionProps) {
  // Get context data
  const { sessionDetails, selectedAgent } = useSessionContext();

  // Don't render if no session or no agents
  if (!sessionDetails?.agents || sessionDetails.agents.length === 0) {
    return null;
  }

  const handleAgentSelect = (agentId: ThreadId) => {
    onAgentSelect(agentId);
    if (isMobile) {
      onCloseMobileNav?.();
    }
  };

  const STATUS_BADGE: Record<AgentInfo['status'], string> = {
    idle: 'badge-success',
    thinking: 'badge-warning',
    tool_execution: 'badge-warning',
    streaming: 'badge-warning',
  } as const;

  const getAgentStatusBadgeClass = (status: AgentInfo['status']) =>
    STATUS_BADGE[status] ?? 'badge-neutral';

  const addAgentButton = onCreateAgent ? (
    <button
      ref={createAgentButtonRef}
      onClick={onCreateAgent}
      className="p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 border border-transparent hover:border-base-300/30"
      title="Add agent"
      data-testid="add-agent-button"
    >
      <FontAwesomeIcon icon={faPlus} className="w-3 h-3 text-base-content/60" />
    </button>
  ) : undefined;

  return (
    <SidebarSection
      title="Agents"
      icon={faRobot}
      defaultCollapsed={false}
      collapsible={true}
      headerActions={addAgentButton}
    >
      <div className="space-y-0.5">
        {' '}
        {/* Tighter spacing */}
        {sessionDetails.agents.map((agent) => {
          return (
            <div key={agent.threadId} className="space-y-1">
              <div className="flex items-center gap-1">
                <SidebarItem
                  active={selectedAgent === agent.threadId}
                  onClick={() => handleAgentSelect(agent.threadId)}
                  className="text-sm flex-1 py-1.5" /* Reduced padding */
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center min-w-0 flex-1">
                      {/* Removed robot icon */}
                      <span className="font-medium truncate text-sm">{agent.name}</span>
                    </div>
                    {agent.status !== 'idle' && (
                      <span
                        className={`text-xs badge badge-xs ${getAgentStatusBadgeClass(agent.status)}`}
                      >
                        {agent.status}
                      </span>
                    )}
                  </div>
                </SidebarItem>
              </div>
            </div>
          );
        })}
      </div>
    </SidebarSection>
  );
}
