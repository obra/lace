// ABOUTME: Agents sidebar section component showing list of available agents
// ABOUTME: Displays agent status badges and allows selection between agents

'use client';

import React, { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot, faCog, faSquare } from '@/lib/fontawesome';
import { SidebarItem } from '@/components/layout/Sidebar';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useOptionalTaskContext } from '@/components/providers/TaskProvider';
import type { ThreadId, AgentInfo } from '@/types/core';

interface AgentsSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
  onAgentSelect: (agentId: ThreadId) => void;
  onConfigureAgent?: (agentId: ThreadId) => void;
}

export const AgentsSection = memo(function AgentsSection({
  isMobile = false,
  onCloseMobileNav,
  onAgentSelect,
  onConfigureAgent,
}: AgentsSectionProps) {
  // Get context data
  const { sessionDetails, selectedAgent } = useAgentContext();
  const taskContext = useOptionalTaskContext();

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

  const getAgentInProgressTask = (agentId: ThreadId) => {
    if (!taskContext?.taskManager?.tasks) return null;

    return taskContext.taskManager.tasks.find(
      (task) => task.assignedTo === agentId && task.status === 'in_progress'
    );
  };

  return (
    <div className="ml-4 mt-2">
      {' '}
      {/* Indent to show it's under the session */}
      {/* Tiny label header */}
      <div className="px-6 mb-1">
        <div className="flex items-center gap-1 text-xs font-medium text-base-content/50 uppercase tracking-wide">
          <FontAwesomeIcon icon={faRobot} className="w-3 h-3" />
          <span>Agents</span>
        </div>
      </div>
      {/* Agent List */}
      <div className="px-6 space-y-0.5">
        {' '}
        {/* Tighter spacing */}
        {sessionDetails.agents.map((agent) => {
          const inProgressTask = getAgentInProgressTask(agent.threadId);

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
                {onConfigureAgent && selectedAgent === agent.threadId && (
                  <button
                    onClick={() => onConfigureAgent?.(agent.threadId)}
                    className="p-1 hover:bg-base-200/60 rounded transition-colors flex-shrink-0"
                    title="Configure agent"
                    data-testid={`configure-agent-${agent.threadId}-button`}
                  >
                    <FontAwesomeIcon icon={faCog} className="w-3 h-3 text-base-content/40" />
                  </button>
                )}
              </div>
              {inProgressTask && (
                <div className="ml-2 flex items-center gap-1.5 text-xs text-base-content/60">
                  <FontAwesomeIcon icon={faSquare} className="w-2.5 h-2.5" />
                  <span className="truncate">{inProgressTask.title}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
