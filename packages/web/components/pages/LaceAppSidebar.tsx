// ABOUTME: Extracted sidebar component for LaceApp to improve performance
// ABOUTME: Memoized component to prevent unnecessary re-renders

import { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faComments, faRobot, faCog, faTasks } from '@/lib/fontawesome';
import { Sidebar, SidebarSection, SidebarItem, SidebarButton } from '@/components/layout/Sidebar';
import { TaskListSidebar } from '@/components/tasks/TaskListSidebar';
import type { SessionInfo, ProjectInfo } from '@/types/core';
import type { ThreadId } from '@/types/core';
import type { useTaskManager } from '@/hooks/useTaskManager';

interface LaceAppSidebarProps {
  showDesktopSidebar: boolean;
  onToggleSidebar: () => void;
  onSettingsClick: () => void;
  selectedProject: string | null;
  currentProject: ProjectInfo;
  sessions: SessionInfo[];
  selectedSessionDetails: SessionInfo | null;
  selectedAgent: ThreadId | null;
  taskManager: ReturnType<typeof useTaskManager> | null;
  onProjectSwitch: () => void;
  onAgentSelect: (agentId: string) => void;
  onConfigureSession: () => void;
  onOpenTaskBoard: () => void;
  onCreateTask: () => void;
}

export const LaceAppSidebar = memo(function LaceAppSidebar({
  showDesktopSidebar,
  onToggleSidebar,
  onSettingsClick,
  selectedProject,
  currentProject,
  sessions,
  selectedSessionDetails,
  selectedAgent,
  taskManager,
  onProjectSwitch,
  onAgentSelect,
  onConfigureSession,
  onOpenTaskBoard,
  onCreateTask,
}: LaceAppSidebarProps) {
  return (
    <div className="hidden lg:block flex-shrink-0">
      <Sidebar
        isOpen={showDesktopSidebar}
        onToggle={onToggleSidebar}
        onSettingsClick={onSettingsClick}
      >
        {/* Current Project - Show only when project selected */}
        {selectedProject && (
          <SidebarSection
            title="Current Project"
            icon={faFolder}
            defaultCollapsed={false}
            collapsible={false}
          >
            <div className="px-3 py-2 bg-base-50 rounded border border-base-200">
              <div className="flex items-center gap-2 mb-1">
                <FontAwesomeIcon icon={faFolder} className="w-4 h-4 text-primary" />
                <span className="font-medium text-base-content truncate">
                  {currentProject.name}
                </span>
              </div>
              <div className="text-xs text-base-content/60 truncate">
                {currentProject.description}
              </div>
              <div className="text-xs text-base-content/50 mt-1">{sessions.length} sessions</div>
            </div>

            {/* Switch Project Button */}
            <SidebarButton onClick={onProjectSwitch} variant="ghost">
              <FontAwesomeIcon icon={faFolder} className="w-4 h-4" />
              Switch Project
            </SidebarButton>
          </SidebarSection>
        )}

        {/* Session Management - Show session context and agent selection */}
        {selectedSessionDetails && (
          <SidebarSection
            title="Current Session"
            icon={faComments}
            defaultCollapsed={false}
            collapsible={false}
          >
            {/* Session Info */}
            <div className="px-3 py-2 bg-base-50 rounded border border-base-200 mb-2">
              <div className="text-sm font-medium text-base-content truncate">
                {selectedSessionDetails.name}
              </div>
              <div className="text-xs text-base-content/60">
                {selectedSessionDetails.agents?.length || 0} agents available
              </div>
            </div>

            {/* Back to Session Config */}
            <SidebarButton onClick={onConfigureSession} variant="ghost">
              <FontAwesomeIcon icon={faCog} className="w-4 h-4" />
              Configure Session
            </SidebarButton>

            {/* Agent Selection */}
            {selectedSessionDetails.agents?.map((agent) => (
              <SidebarItem
                key={agent.threadId}
                active={selectedAgent === agent.threadId}
                onClick={() => onAgentSelect(agent.threadId)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon
                      icon={faRobot}
                      className={`w-4 h-4 ${
                        selectedAgent === agent.threadId ? 'text-primary' : 'text-base-content/60'
                      }`}
                    />
                    <span className="font-medium">{agent.name}</span>
                  </div>
                  <span
                    className={`text-xs badge badge-xs ${
                      agent.status === 'idle'
                        ? 'badge-success'
                        : agent.status === 'thinking' ||
                            agent.status === 'tool_execution' ||
                            agent.status === 'streaming'
                          ? 'badge-warning'
                          : 'badge-neutral'
                    }`}
                  >
                    {agent.status}
                  </span>
                </div>
              </SidebarItem>
            )) || []}
          </SidebarSection>
        )}

        {/* Tasks Section - Show when session is selected */}
        {selectedSessionDetails && selectedProject && taskManager && (
          <SidebarSection
            title={`Tasks${taskManager?.tasks.length ? ` (${taskManager.tasks.length})` : ''}`}
            icon={faTasks}
            defaultCollapsed={false}
          >
            <TaskListSidebar
              taskManager={taskManager}
              onTaskClick={() => {
                // For now, just ignore - could open task detail modal in future
              }}
              onOpenTaskBoard={onOpenTaskBoard}
              onCreateTask={onCreateTask}
            />
          </SidebarSection>
        )}
      </Sidebar>
    </div>
  );
});
