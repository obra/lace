// ABOUTME: Agents sidebar section component showing list of available agents
// ABOUTME: Displays agent status badges and allows selection between agents

'use client';

import React, { memo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot, faSquare, faChevronRight, faChevronDown } from '@/lib/fontawesome';
import { SidebarItem } from '@/components/layout/Sidebar';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useOptionalTaskContext } from '@/components/providers/TaskProvider';
import { getStatusBgColor } from '@/lib/task-status-ui';
import type { ThreadId, AgentInfo, Task } from '@/types/core';

interface AgentsSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
  onAgentSelect: (agentId: ThreadId) => void;
}

export function AgentsSection({
  isMobile = false,
  onCloseMobileNav,
  onAgentSelect,
}: AgentsSectionProps) {
  // Get context data
  const { sessionDetails, selectedAgent } = useAgentContext();
  const taskContext = useOptionalTaskContext();
  const [expandedAgents, setExpandedAgents] = useState<Set<ThreadId>>(new Set());

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

  const getAgentTasks = (agentId: ThreadId) => {
    if (!taskContext?.taskManager?.tasks) {
      return { inProgress: null, other: [] };
    }

    const allTasks = taskContext.taskManager.tasks;
    const agentTasks = allTasks.filter((task) => task.assignedTo === agentId);

    const inProgress = agentTasks.find((task) => task.status === 'in_progress') || null;
    const other = agentTasks.filter((task) => task.status !== 'in_progress');

    return { inProgress, other };
  };

  const toggleAgentExpansion = (agentId: ThreadId) => {
    setExpandedAgents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(agentId)) {
        newSet.delete(agentId);
      } else {
        newSet.add(agentId);
      }
      return newSet;
    });
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
          const { inProgress, other } = getAgentTasks(agent.threadId);
          const isExpanded = expandedAgents.has(agent.threadId);

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

              {/* In-progress task - show directly */}
              {inProgress && (
                <div className="ml-2 flex items-center gap-1.5 text-xs text-base-content/60">
                  <FontAwesomeIcon icon={faSquare} className="w-2.5 h-2.5" />
                  <span className="truncate">{inProgress.title}</span>
                </div>
              )}

              {/* Other tasks - collapsible */}
              {other.length > 0 && (
                <div className="ml-2">
                  <button
                    onClick={() => toggleAgentExpansion(agent.threadId)}
                    className="flex items-center gap-1.5 text-xs text-base-content/50 hover:text-base-content/70 transition-colors py-0.5"
                  >
                    <FontAwesomeIcon
                      icon={isExpanded ? faChevronDown : faChevronRight}
                      className="w-2.5 h-2.5"
                    />
                    <span>
                      {other.length} other task{other.length === 1 ? '' : 's'}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="ml-4 mt-1 space-y-1">
                      {other.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-center gap-1.5 text-xs text-base-content/50"
                        >
                          <div
                            className={`w-2 h-2 rounded-full ${getStatusBgColor(task.status)}`}
                          />
                          <span className="truncate">{task.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
