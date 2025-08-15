// ABOUTME: New app layout component using DaisyUI design system
// ABOUTME: Combines design system layout structure with business logic patterns

'use client';

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faFolder, faComments, faRobot, faPlus, faCog, faTasks } from '@/lib/fontawesome';
import { Sidebar, SidebarSection, SidebarItem, SidebarButton } from '@/components/layout/Sidebar';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { TimelineView } from '@/components/timeline/TimelineView';
import { EnhancedChatInput } from '@/components/chat/EnhancedChatInput';
import { TokenUsageDisplay } from '@/components/ui';
import { useAgentTokenUsage } from '@/hooks/useAgentTokenUsage';
import { ToolApprovalModal } from '@/components/modals/ToolApprovalModal';
import { TaskBoardModal } from '@/components/modals/TaskBoardModal';
import { TaskCreationModal } from '@/components/modals/TaskCreationModal';
import { TaskDisplayModal } from '@/components/modals/TaskDisplayModal';
import { SessionConfigPanel } from '@/components/config/SessionConfigPanel';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import { useTheme } from '@/components/providers/ThemeProvider';
import { SettingsContainer } from '@/components/settings/SettingsContainer';
import type {
  ProviderInfo,
  CreateAgentRequest,
  MessageRequest,
  MessageResponse,
} from '@/types/api';
import { isApiError } from '@/types/api';
import type { ThreadId, Task, SessionInfo, AgentInfo, ProjectInfo, AgentState } from '@/types/core';
import { parseResponse } from '@/lib/serialization';
import { ApprovalDecision } from '@/types/core';
import type { LaceEvent } from '~/threads/types';
import type { UseAgentTokenUsageResult } from '@/hooks/useAgentTokenUsage';
import type { ToolApprovalRequestData } from '@/types/web-events';
import { useHashRouter } from '@/hooks/useHashRouter';
import { useSessionEvents } from '@/hooks/useSessionEvents';
import { useTaskManager } from '@/hooks/useTaskManager';
import { useSessionAPI } from '@/hooks/useSessionAPI';
import { useEventStream } from '@/hooks/useEventStream';
import { TaskListSidebar } from '@/components/tasks/TaskListSidebar';
import Link from 'next/link';

// Token usage section component
const TokenUsageSection = memo(function TokenUsageSection({ agentId }: { agentId: ThreadId }) {
  const usageResult: UseAgentTokenUsageResult = useAgentTokenUsage(agentId);

  if (usageResult.loading) {
    return (
      <div className="flex justify-center p-2 border-t border-base-300/50 bg-base-100/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-base-content/60">
          <div className="loading loading-spinner loading-xs"></div>
          <span className="animate-pulse-soft">Loading usage data...</span>
        </div>
      </div>
    );
  }

  if (usageResult.error) {
    return (
      <div className="flex justify-center p-2 border-t border-base-300/50 bg-base-100/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-error/80">
          <span>⚠️</span>
          <span>Could not load usage data</span>
        </div>
      </div>
    );
  }

  if (!usageResult.tokenUsage) {
    return (
      <div className="flex justify-center p-2 border-t border-base-300/50 bg-base-100/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-base-content/50">
          <span>📊</span>
          <span>No usage data yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center p-2 border-t border-base-300/50 bg-base-100/50 backdrop-blur-sm">
      <TokenUsageDisplay tokenUsage={usageResult.tokenUsage} loading={usageResult.loading} />
    </div>
  );
});

export const LaceApp = memo(function LaceApp() {
  // Theme state
  const { theme, setTheme } = useTheme();

  // Hash-based routing state (replaces selectedProject, selectedSession, selectedAgent)
  const {
    project: selectedProject,
    session: selectedSession,
    agent: selectedAgent,
    setProject: setSelectedProject,
    setSession: setSelectedSession,
    setAgent: setSelectedAgent,
    updateState: updateHashState,
    isHydrated: urlStateHydrated,
  } = useHashRouter();

  // UI State (from AnimatedLaceApp but remove demo data)
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);
  const [showTaskBoard, setShowTaskBoard] = useState(false);
  const [showTaskCreation, setShowTaskCreation] = useState(false);
  const [showTaskDisplay, setShowTaskDisplay] = useState(false);
  const [selectedTaskForDisplay, setSelectedTaskForDisplay] = useState<Task | null>(null);
  const [autoOpenCreateProject, setAutoOpenCreateProject] = useState(false);

  // Business Logic State (from current app/page.tsx)
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSessionDetails, setSelectedSessionDetails] = useState<SessionInfo | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [projectConfig, setProjectConfig] = useState<Record<string, unknown> | null>(null);

  // Use session events hook for event management (without event stream)
  const {
    filteredEvents: events,
    pendingApprovals,
    loadingHistory,
    clearApprovalRequest,
    addSessionEvent,
    handleApprovalRequest,
    handleApprovalResponse,
  } = useSessionEvents(selectedSession, selectedAgent, false); // Connection state will be passed to component that needs it

  // Use session API hook for all API calls (HTTP requests only, not streaming state)
  const { sendMessage: sendMessageAPI, stopAgent: stopAgentAPI } = useSessionAPI();

  // Handle agent state changes from event stream
  const handleAgentStateChange = useCallback((agentId: string, from: string, to: string) => {
    setSelectedSessionDetails((prevSession) => {
      if (!prevSession?.agents) return prevSession;

      return {
        ...prevSession,
        agents: prevSession.agents.map((agent) =>
          agent.threadId === agentId ? { ...agent, status: to as AgentState } : agent
        ),
      };
    });
  }, []);

  // Get current agent's status from the updated session details
  const currentAgent =
    selectedSessionDetails?.agents?.find((a) => a.threadId === selectedAgent) ||
    selectedSessionDetails?.agents?.[0];
  const agentBusy =
    currentAgent?.status === 'thinking' ||
    currentAgent?.status === 'streaming' ||
    currentAgent?.status === 'tool_execution';

  // Task manager - only create when we have a project and session
  const taskManager = useTaskManager(selectedProject || '', selectedSession || '');

  // Single unified event stream connection with all event handlers
  const { connection } = useEventStream({
    projectId: selectedProject || undefined,
    sessionId: selectedSession || undefined,
    threadIds: selectedAgent ? [selectedAgent] : undefined,
    onConnect: () => {
      // Event stream connected - no logging needed for production
    },
    onError: (error) => {
      console.error('Event stream error:', error);
    },
    // Session event handlers - wire to useSessionEvents
    onUserMessage: addSessionEvent,
    onAgentMessage: addSessionEvent,
    onAgentToken: addSessionEvent,
    onToolCall: addSessionEvent,
    onToolResult: addSessionEvent,
    onSystemMessage: addSessionEvent,
    // Agent state change handler
    onAgentStateChange: handleAgentStateChange,
    // Approval handlers
    onApprovalRequest: handleApprovalRequest,
    onApprovalResponse: handleApprovalResponse,
    // Task event handlers - wire to useTaskManager (only if available)
    onTaskCreated: taskManager?.handleTaskCreated,
    onTaskUpdated: taskManager?.handleTaskUpdated,
    onTaskDeleted: taskManager?.handleTaskDeleted,
    onTaskNoteAdded: taskManager?.handleTaskNoteAdded,
  });

  const connected = connection.connected;

  // Events are now LaceEvent[] directly
  // No conversion needed - components handle LaceEvent natively

  // Project loading function
  const loadProjects = useCallback(async (): Promise<ProjectInfo[]> => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/projects');
      const data = await parseResponse<ProjectInfo[]>(res);
      setProjects(data);
      setLoadingProjects(false);
      return data;
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
    setLoadingProjects(false);
    return [];
  }, []);

  // Provider loading function
  const loadProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const res = await fetch('/api/providers');
      const data: unknown = await parseResponse<unknown>(res);

      if (isApiError(data)) {
        console.error('Failed to load providers:', data.error);
        return;
      }

      const providersData = data as ProviderInfo[];
      setProviders(providersData || []);
    } catch (error) {
      console.error('Failed to load providers:', error);
      setProviders([]);
      setLoadingProviders(false);
      return;
    }
    setLoadingProviders(false);
  }, []);

  const loadSessions = useCallback(async () => {
    if (!selectedProject) {
      setSessions([]);
      return;
    }

    try {
      const res = await fetch(`/api/projects/${selectedProject}/sessions`);
      const data: unknown = await parseResponse<unknown>(res);

      if (isApiError(data)) {
        console.error('Failed to load sessions:', data.error);
        if (data.error === 'Project not found') {
          // Clear the stale selection to stop repeated errors and let FTUX flow proceed
          setSelectedProject(null);
          setSessions([]);
        }
        return;
      }

      const sessionsData = data as SessionInfo[];
      setSessions(sessionsData || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }, [selectedProject, setSelectedProject]);

  // Load projects and providers on mount
  useEffect(() => {
    void loadProjects();
    void loadProviders();
  }, [loadProjects, loadProviders]);

  // Auto-open project creation modal when no projects exist
  useEffect(() => {
    if ((projects?.length || 0) === 0 && !loadingProjects) {
      setAutoOpenCreateProject(true);
    } else {
      setAutoOpenCreateProject(false);
    }
  }, [projects?.length, loadingProjects]);

  const loadSessionDetails = useCallback(
    async (sessionId: ThreadId) => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data: unknown = await parseResponse<unknown>(res);

        if (isApiError(data)) {
          console.error('Failed to load session details:', data.error);
          // If session not found, clear it from the hash to prevent repeated errors
          if (data.error === 'Session not found') {
            setSelectedSession(null);
          }
          return;
        }

        const sessionResponse = data as SessionInfo;
        setSelectedSessionDetails(sessionResponse);
      } catch (error) {
        console.error('Failed to load session details:', error);
        // On network or other errors, also clear the invalid session
        setSelectedSession(null);
      }
    },
    [setSelectedSession]
  );

  // Load sessions and project configuration when project is selected
  useEffect(() => {
    void loadSessions();

    // Load project configuration
    if (selectedProject) {
      fetch(`/api/projects/${selectedProject}/configuration`)
        .then((res) => parseResponse<{ configuration?: Record<string, unknown> }>(res))
        .then((data) => {
          if (data.configuration) {
            setProjectConfig(data.configuration);
          } else {
            setProjectConfig({});
          }
        })
        .catch((error) => {
          console.error('Failed to load project configuration:', error);
          setProjectConfig(null);
        });
    } else {
      setProjectConfig(null);
    }
  }, [selectedProject, loadSessions]);

  // Load session details when session is selected
  useEffect(() => {
    if (!selectedSession) {
      setSelectedSessionDetails(null);
      return;
    }
    void loadSessionDetails(selectedSession);
  }, [selectedSession, loadSessionDetails]);

  // Auto-select agent only when user selects a project (not on every render)
  const [shouldAutoSelectAgent, setShouldAutoSelectAgent] = useState(false);

  // Auto-select agent if session has only one agent and auto-selection is enabled
  useEffect(() => {
    if (
      shouldAutoSelectAgent &&
      selectedSessionDetails &&
      selectedSessionDetails.agents &&
      selectedSessionDetails.agents.length === 1 &&
      !selectedAgent
    ) {
      setSelectedAgent(selectedSessionDetails.agents[0].threadId as ThreadId);
      setShouldAutoSelectAgent(false); // Reset flag after auto-selection
    }
  }, [shouldAutoSelectAgent, selectedSessionDetails, selectedAgent, setSelectedAgent]);

  // Reset auto-selection flag when session changes
  useEffect(() => {
    setShouldAutoSelectAgent(false);
  }, [selectedSession]);

  // Handle project selection
  const handleProjectSelect = (project: { id: string }) => {
    // Hash router automatically clears session/agent when project changes
    setSelectedProject(project.id);
    // Enable auto-selection for this project selection
    setShouldAutoSelectAgent(true);
  };

  const sendMessage = useCallback(
    async (message: string) => {
      if (!selectedAgent || !message.trim()) {
        return false;
      }
      return await sendMessageAPI(selectedAgent, message);
    },
    [selectedAgent, sendMessageAPI]
  );

  const stopGeneration = useCallback(async () => {
    if (!selectedAgent) return false;
    return await stopAgentAPI(selectedAgent);
  }, [selectedAgent, stopAgentAPI]);

  // Handle tool approval decision
  const handleApprovalDecision = async (toolCallId: string, decision: ApprovalDecision) => {
    if (!selectedAgent) return;

    try {
      const res = await fetch(`/api/threads/${selectedAgent}/approvals/${toolCallId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });

      if (!res.ok) {
        console.error('Failed to submit approval decision');
      }
    } catch (error) {
      console.error('Failed to submit approval decision:', error);
    }
  };

  // Session creation function with configuration
  const handleSessionCreate = async (sessionData: {
    name: string;
    description?: string;
    configuration?: Record<string, unknown>;
  }) => {
    if (!selectedProject) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${selectedProject}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData),
      });

      if (res.ok) {
        // Reload sessions to show the new one
        void loadSessions();
      } else {
        const errorData = await parseResponse<{ error?: string }>(res);
        console.error('Failed to create session:', errorData.error);
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }
    setLoading(false);
  };

  // Agent creation function
  const handleAgentCreate = async (sessionId: string, agentData: CreateAgentRequest) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData),
      });

      if (res.ok) {
        // Reload session details to show the new agent
        void loadSessionDetails(sessionId as ThreadId);
      } else {
        console.error('Failed to create agent');
        return;
      }
    } catch (error) {
      console.error('Failed to create agent:', error);
    }
    setLoading(false);
  };

  // Legacy session creation (for backward compatibility)
  const createSession = async () => {
    if (!selectedProject || !sessionName.trim()) return;

    await handleSessionCreate({ name: sessionName.trim() });
    setSessionName('');
    setCreatingSession(false);
  };

  const cancelSessionCreation = () => {
    setCreatingSession(false);
    setSessionName('');
  };

  // Handle session selection - load session details but don't auto-select agent
  const handleSessionSelect = (sessionId: string) => {
    // Hash router automatically clears agent when session changes
    setSelectedSession(sessionId as ThreadId);
  };

  // Handle agent selection within a session
  const handleAgentSelect = (agentThreadId: string) => {
    setShouldAutoSelectAgent(false); // Clear auto-selection flag when user manually selects an agent
    setSelectedAgent(agentThreadId as ThreadId);
  };

  // Handle agent updates - refresh session details to show updated agent info
  const handleAgentUpdate = async () => {
    if (selectedSession) {
      await loadSessionDetails(selectedSession);
    }
  };

  // Handle project updates (archive/unarchive/edit)
  const handleProjectUpdate = async (
    projectId: string,
    updates: {
      isArchived?: boolean;
      name?: string;
      description?: string;
      workingDirectory?: string;
      configuration?: Record<string, unknown>;
    }
  ) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        // Reload projects to reflect the changes
        void loadProjects();
      } else {
        console.error('Failed to update project');
        return;
      }
    } catch (error) {
      console.error('Failed to update project:', error);
    }
  };

  // Handle onboarding completion - navigate directly to chat
  const handleOnboardingComplete = async (
    projectId: string,
    sessionId: string,
    agentId: string
  ) => {
    // Reload projects first to ensure the newly created project is in the array
    await loadProjects();

    // Set all three selections atomically to navigate directly to chat
    updateHashState({
      project: projectId,
      session: sessionId,
      agent: agentId,
    });

    // Clear auto-open state
    setAutoOpenCreateProject(false);

    // Enable auto-selection for future navigation within this project
    setShouldAutoSelectAgent(true);
  };

  // Handle task updates
  const handleTaskUpdate = async (task: Task) => {
    if (!taskManager) return;

    try {
      await taskManager.updateTask(task.id, {
        status: task.status,
        title: task.title,
        description: task.description,
        priority: task.priority,
        assignedTo: task.assignedTo,
      });
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  const handleTaskCreate = async (taskData: Omit<Task, 'id'>) => {
    if (!taskManager) return;

    try {
      await taskManager.createTask({
        title: taskData.title,
        description: taskData.description,
        prompt: taskData.prompt || taskData.description || taskData.title,
        priority: taskData.priority,
        assignedTo: taskData.assignedTo,
      });
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  // Handle task creation from modal
  const handleTaskCreateFromModal = async (
    taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'notes' | 'createdBy' | 'threadId'>
  ) => {
    if (!taskManager) return;

    try {
      await taskManager.createTask({
        title: taskData.title,
        description: taskData.description,
        prompt: taskData.prompt,
        priority: taskData.priority,
        assignedTo: taskData.assignedTo,
      });
      setShowTaskCreation(false);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  // Handle opening task display modal
  const handleTaskDisplay = (task: Task) => {
    setSelectedTaskForDisplay(task);
    setShowTaskDisplay(true);
  };

  // Handle updating task from display modal
  const handleTaskUpdateFromModal = async (taskId: string, updates: Partial<Task>) => {
    if (!taskManager) return;

    try {
      await taskManager.updateTask(taskId, {
        title: updates.title,
        description: updates.description,
        status: updates.status,
        priority: updates.priority,
        assignedTo: updates.assignedTo,
      });
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  // Handle adding task note
  const handleTaskAddNote = async (taskId: string, content: string) => {
    if (!taskManager) return;

    try {
      await taskManager.addNote(taskId, content);
    } catch (error) {
      console.error('Failed to add task note:', error);
    }
  };

  // Convert projects to format expected by Sidebar
  // If selectedProject ID doesn't match any actual project, clear the selection
  const foundProject = selectedProject
    ? (projects || []).find((p) => p.id === selectedProject)
    : null;
  const currentProject = useMemo(
    () =>
      foundProject || {
        id: '',
        name: 'No project selected',
        description: 'Select a project to get started',
        workingDirectory: '/',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      },
    [foundProject]
  );

  // Clear invalid project selection from URL
  // useEffect(() => {
  //   // Clear any project ID that doesn't match loaded projects after loading is complete
  //   // This handles invalid URLs gracefully by falling back to project selection
  //   if (selectedProject &&
  //       !loadingProjects &&
  //       projects.length > 0 &&
  //       !foundProject) {
  //     console.log('Clearing invalid project ID from URL:', selectedProject);
  //     setSelectedProject(null, true); // Use replaceState to avoid polluting history
  //   }
  // }, [selectedProject, projects, foundProject, setSelectedProject, loadingProjects]);

  const projectsForSidebar = useMemo(
    () =>
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        workingDirectory: p.workingDirectory,
        description: p.description,
        isArchived: p.isArchived || false,
        createdAt: new Date(p.createdAt),
        lastUsedAt: new Date(p.lastUsedAt),
        sessionCount: p.sessionCount || 0,
      })),
    [projects]
  );

  // Wait for URL state hydration before rendering to avoid hydration mismatches
  if (!urlStateHydrated) {
    return (
      <div className="flex h-screen bg-base-200 text-base-content font-ui items-center justify-center">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

  return (
    <motion.div
      className="flex h-screen bg-gradient-to-br from-base-100 via-base-200/50 to-base-200 text-base-content font-ui overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Mobile Sidebar - copy structure from AnimatedLaceApp */}
      <AnimatePresence>
        {showMobileNav && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 lg:hidden"
          >
            <SettingsContainer>
              {({ onOpenSettings }) => (
                <MobileSidebar
                  isOpen={showMobileNav}
                  onClose={() => setShowMobileNav(false)}
                  onSettingsClick={onOpenSettings}
                >
                  {/* Current Project - Show only when project selected */}
                  {selectedProject && (
                    <SidebarSection
                      title="Current Project"
                      icon={faFolder}
                      defaultCollapsed={false}
                      collapsible={false}
                    >
                      <div className="px-4 py-3 bg-base-100/80 backdrop-blur-sm rounded-xl border border-base-300/30 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="p-1.5 bg-primary/10 rounded-lg">
                            <FontAwesomeIcon icon={faFolder} className="w-3.5 h-3.5 text-primary" />
                          </div>
                          <span
                            data-testid="current-project-name"
                            className="font-semibold text-base-content truncate text-sm"
                          >
                            {currentProject.name}
                          </span>
                        </div>
                        <div className="text-xs text-base-content/60 truncate">
                          {currentProject.description}
                        </div>
                        <div className="text-xs text-base-content/50 mt-1">
                          {sessions.length} sessions
                        </div>
                      </div>

                      {/* Switch Project Button */}
                      <SidebarButton
                        onClick={() => {
                          setSelectedProject(null);
                          setShowMobileNav(false);
                        }}
                        variant="ghost"
                      >
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
                      <div className="px-4 py-3 bg-base-100/80 backdrop-blur-sm rounded-xl border border-base-300/30 shadow-sm mb-3">
                        <div className="text-sm font-medium text-base-content truncate">
                          {selectedSessionDetails.name}
                        </div>
                        <div className="text-xs text-base-content/60">
                          {selectedSessionDetails.agents?.length || 0} agents available
                        </div>
                      </div>

                      {/* Back to Session Config */}
                      <SidebarButton
                        onClick={() => {
                          setSelectedAgent(null);
                          setShowMobileNav(false);
                        }}
                        variant="ghost"
                      >
                        <FontAwesomeIcon icon={faCog} className="w-4 h-4" />
                        Configure Session
                      </SidebarButton>

                      {/* Agent Selection */}
                      {selectedSessionDetails.agents?.map((agent) => (
                        <SidebarItem
                          key={agent.threadId}
                          active={selectedAgent === agent.threadId}
                          onClick={() => {
                            handleAgentSelect(agent.threadId);
                            setShowMobileNav(false);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <FontAwesomeIcon
                                icon={faRobot}
                                className={`w-4 h-4 ${
                                  selectedAgent === agent.threadId
                                    ? 'text-primary'
                                    : 'text-base-content/60'
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
                  {selectedSessionDetails && selectedProject && selectedSession && taskManager && (
                    <SidebarSection
                      title={`Tasks${taskManager?.tasks.length ? ` (${taskManager.tasks.length})` : ''}`}
                      icon={faTasks}
                      defaultCollapsed={false}
                      collapsible={false}
                    >
                      <TaskListSidebar
                        taskManager={taskManager}
                        onTaskClick={(taskId) => {
                          // For now, just close mobile nav - could open task detail modal in future
                          setShowMobileNav(false); // Close mobile nav when task is clicked
                        }}
                        onOpenTaskBoard={() => {
                          setShowTaskBoard(true);
                          setShowMobileNav(false); // Close mobile nav when opening task board
                        }}
                        onCreateTask={() => {
                          setShowTaskCreation(true);
                          setShowMobileNav(false); // Close mobile nav when creating task
                        }}
                      />
                    </SidebarSection>
                  )}
                </MobileSidebar>
              )}
            </SettingsContainer>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <div className="hidden lg:block flex-shrink-0">
        <SettingsContainer>
          {({ onOpenSettings }) => (
            <Sidebar
              isOpen={showDesktopSidebar}
              onToggle={() => setShowDesktopSidebar(!showDesktopSidebar)}
              onSettingsClick={onOpenSettings}
            >
              {/* Current Project - Show only when project selected */}
              {selectedProject && (
                <SidebarSection
                  title="Current Project"
                  icon={faFolder}
                  defaultCollapsed={false}
                  collapsible={false}
                >
                  <div className="px-4 py-3 bg-base-100/80 backdrop-blur-sm rounded-xl border border-base-300/30 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-1.5 bg-primary/10 rounded-lg">
                        <FontAwesomeIcon icon={faFolder} className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <span
                        data-testid="current-project-name-desktop"
                        className="font-semibold text-base-content truncate text-sm"
                      >
                        {currentProject.name}
                      </span>
                    </div>
                    <div className="text-xs text-base-content/60 truncate">
                      {currentProject.description}
                    </div>
                    <div className="text-xs text-base-content/50 mt-1">
                      {sessions.length} sessions
                    </div>
                  </div>

                  {/* Switch Project Button */}
                  <SidebarButton
                    onClick={() => {
                      setSelectedProject(null);
                    }}
                    variant="ghost"
                  >
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
                  <SidebarButton
                    onClick={() => {
                      setSelectedAgent(null);
                    }}
                    variant="ghost"
                  >
                    <FontAwesomeIcon icon={faCog} className="w-4 h-4" />
                    Configure Session
                  </SidebarButton>

                  {/* Agent Selection */}
                  {selectedSessionDetails.agents?.map((agent) => (
                    <SidebarItem
                      key={agent.threadId}
                      active={selectedAgent === agent.threadId}
                      onClick={() => handleAgentSelect(agent.threadId)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon
                            icon={faRobot}
                            className={`w-4 h-4 ${
                              selectedAgent === agent.threadId
                                ? 'text-primary'
                                : 'text-base-content/60'
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
              {selectedSessionDetails && selectedProject && selectedSession && taskManager && (
                <SidebarSection
                  title={`Tasks${taskManager?.tasks.length ? ` (${taskManager.tasks.length})` : ''}`}
                  icon={faTasks}
                  defaultCollapsed={false}
                >
                  <TaskListSidebar
                    taskManager={taskManager}
                    onTaskClick={(taskId) => {
                      // For now, just ignore - could open task detail modal in future
                    }}
                    onOpenTaskBoard={() => setShowTaskBoard(true)}
                    onCreateTask={() => setShowTaskCreation(true)}
                  />
                </SidebarSection>
              )}
            </Sidebar>
          )}
        </SettingsContainer>
      </div>

      {/* Main Content - copy structure from AnimatedLaceApp */}
      <motion.div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Dim/Glass vapor background */}
        <div className="vapor-bg" aria-hidden>
          <div className="sunlines"></div>
          <div className="noise"></div>
        </div>
        {/* Top Bar - Fixed Header */}
        <motion.div className="bg-base-100/90 backdrop-blur-md border-b border-base-300/50 flex-shrink-0 z-30">
          <motion.div className="flex items-center justify-between p-4 lg:px-6">
            <motion.div className="flex items-center gap-3">
              <motion.button
                onClick={() => setShowMobileNav(true)}
                className="p-2 hover:bg-base-200 rounded-lg lg:hidden"
              >
                <FontAwesomeIcon icon={faBars} className="w-6 h-6" />
              </motion.button>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-base-content truncate">
                  {selectedAgent && selectedSessionDetails?.agents
                    ? (() => {
                        const currentAgent = selectedSessionDetails.agents.find(
                          (a) => a.threadId === selectedAgent
                        );
                        return currentAgent
                          ? `${currentAgent.name} - ${currentAgent.modelId}`
                          : selectedProject
                            ? currentProject.name
                            : '';
                      })()
                    : selectedProject
                      ? currentProject.name
                      : ''}
                </h1>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 text-base-content bg-base-100/30 backdrop-blur-sm">
          {loadingProjects || loadingProviders ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="flex flex-col items-center gap-4 animate-fade-in">
                <div className="loading loading-spinner loading-lg text-primary"></div>
                <div className="text-center">
                  <div className="text-lg font-medium text-base-content">Setting things up</div>
                  <div className="text-sm text-base-content/60 animate-pulse-soft">
                    Loading your workspace...
                  </div>
                </div>
              </div>
            </div>
          ) : selectedProject && foundProject ? (
            selectedAgent ||
            (selectedSessionDetails?.agents && selectedSessionDetails.agents.length > 0) ? (
              <div className="flex-1 flex flex-col h-full">
                {/* Conversation Display - scrollable area with max width */}
                <div className="flex-1 overflow-y-auto">
                  <div className="max-w-3xl mx-auto px-4">
                    <TimelineView
                      events={events}
                      agents={selectedSessionDetails?.agents}
                      isTyping={agentBusy}
                      currentAgent={
                        selectedSessionDetails?.agents?.find((a) => a.threadId === selectedAgent)
                          ?.name || 'Agent'
                      }
                      selectedAgent={selectedAgent || selectedSessionDetails?.agents?.[0]?.threadId}
                    />
                  </div>
                </div>

                {/* Chat Input - Fixed at bottom with max width */}
                <div className="flex-shrink-0 pb-6 pt-2 min-h-[80px]">
                  <div className="max-w-3xl mx-auto px-4">
                    <MemoizedChatInput
                      onSubmit={sendMessage}
                      onInterrupt={stopGeneration}
                      disabled={agentBusy}
                      isStreaming={agentBusy}
                      placeholder={`Message ${selectedAgent ? selectedSessionDetails?.agents?.find((a) => a.threadId === selectedAgent)?.name || 'agent' : selectedSessionDetails?.agents?.[0]?.name || 'agent'}...`}
                      agentId={selectedAgent || selectedSessionDetails?.agents?.[0]?.threadId}
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* Session Configuration Panel - Main UI for session/agent management */
              <div className="flex-1 p-6">
                <SessionConfigPanel
                  selectedProject={currentProject}
                  projectConfiguration={projectConfig}
                  sessions={sessions}
                  selectedSession={selectedSessionDetails}
                  providers={providers}
                  onSessionCreate={handleSessionCreate}
                  onSessionSelect={(session: SessionInfo) => handleSessionSelect(session.id)}
                  onAgentCreate={handleAgentCreate}
                  onAgentSelect={handleAgentSelect}
                  onAgentUpdate={handleAgentUpdate}
                  loading={loading}
                />
              </div>
            )
          ) : (
            /* Project Selection Panel - When no project selected, invalid project ID, or simulate-first-time */
            <div className="flex-1 p-6 min-h-0 space-y-6">
              {projects.length === 0 && (
                <div className="glass ring-hover p-8">
                  <div className="text-center">
                    <div className="max-w-2xl mx-auto">
                      <h2 className="text-3xl md:text-4xl font-bold text-white">
                        Code with clarity.
                        <br />
                        <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
                          Not complexity.
                        </span>
                      </h2>
                      <p className="py-4 text-white/85">
                        Create your first project to start collaborating with agents.
                      </p>
                      <div className="flex items-center justify-center gap-3">
                        <button
                          className="btn btn-accent ring-hover focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
                          data-testid="new-project-button"
                          onClick={() => setAutoOpenCreateProject(true)}
                        >
                          Create your first project
                        </button>
                        <Link
                          className="btn btn-outline border-white/20 text-white hover:border-white/40 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
                          href="/docs"
                          target="_blank"
                          rel="noreferrer"
                        >
                          View docs
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {(projects.length > 0 || autoOpenCreateProject) && (
                <ProjectSelectorPanel
                  projects={projectsForSidebar}
                  selectedProject={currentProject.id ? currentProject : null}
                  providers={providers}
                  onProjectSelect={handleProjectSelect}
                  onProjectCreate={() => void loadProjects()}
                  onProjectUpdate={handleProjectUpdate}
                  loading={loadingProjects}
                  autoOpenCreate={autoOpenCreateProject}
                  // When the user cancels/finishes, reset flag so CTA can re-open reliably
                  onAutoCreateHandled={() => setAutoOpenCreateProject(false)}
                  onOnboardingComplete={handleOnboardingComplete}
                />
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Tool Approval Modal */}
      {pendingApprovals && pendingApprovals.length > 0 && (
        <ToolApprovalModal approvals={pendingApprovals} onDecision={handleApprovalDecision} />
      )}

      {/* Task Board Modal */}
      {showTaskBoard && selectedProject && selectedSession && taskManager && (
        <TaskBoardModal
          isOpen={showTaskBoard}
          onClose={() => setShowTaskBoard(false)}
          tasks={taskManager.tasks}
          onTaskUpdate={handleTaskUpdate}
          onTaskCreate={handleTaskCreate}
          onTaskClick={handleTaskDisplay}
        />
      )}

      {/* Task Creation Modal */}
      {showTaskCreation && selectedProject && selectedSession && (
        <TaskCreationModal
          isOpen={showTaskCreation}
          onClose={() => setShowTaskCreation(false)}
          onCreateTask={handleTaskCreateFromModal}
          agents={selectedSessionDetails?.agents || []}
          loading={taskManager?.isCreating || false}
        />
      )}

      {/* Task Display Modal */}
      {showTaskDisplay && selectedTaskForDisplay && (
        <TaskDisplayModal
          isOpen={showTaskDisplay}
          onClose={() => {
            setShowTaskDisplay(false);
            setSelectedTaskForDisplay(null);
          }}
          task={selectedTaskForDisplay}
          onUpdateTask={handleTaskUpdateFromModal}
          onAddNote={handleTaskAddNote}
          agents={selectedSessionDetails?.agents || []}
          loading={taskManager?.isUpdating || false}
        />
      )}
    </motion.div>
  );
});

// Memoized chat input component to prevent parent re-renders
const MemoizedChatInput = memo(function MemoizedChatInput({
  onSubmit,
  onInterrupt,
  disabled,
  isStreaming,
  placeholder,
  agentId,
}: {
  onSubmit: (message: string) => Promise<boolean | void>;
  onInterrupt?: () => Promise<boolean | void>;
  disabled: boolean;
  isStreaming?: boolean;
  placeholder: string;
  agentId?: ThreadId;
}) {
  const [message, setMessage] = useState('');

  const handleSubmit = useCallback(async () => {
    const success = await onSubmit(message);
    if (success) {
      setMessage('');
    }
  }, [message, onSubmit]);

  return (
    <motion.div
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex-shrink-0 bg-base-100/50 backdrop-blur-sm border-t border-base-300/30 p-2"
    >
      <CustomEnhancedChatInput
        value={message}
        onChange={setMessage}
        onSubmit={handleSubmit}
        onInterrupt={onInterrupt}
        disabled={disabled}
        isStreaming={isStreaming}
        placeholder={placeholder}
        agentId={agentId}
      />
    </motion.div>
  );
});

// Custom chat input with status below - includes speech status monitoring
const CustomEnhancedChatInput = memo(function CustomEnhancedChatInput({
  value,
  onChange,
  onSubmit,
  onInterrupt,
  disabled,
  isStreaming,
  placeholder,
  agentId,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onInterrupt?: () => void;
  disabled: boolean;
  isStreaming?: boolean;
  placeholder: string;
  agentId?: ThreadId;
}) {
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {/* Chat Input */}
      <EnhancedChatInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        onInterrupt={onInterrupt}
        disabled={disabled}
        isStreaming={isStreaming}
        placeholder={placeholder}
      />

      {/* Bottom Status Area */}
      <div className="flex justify-between items-center text-xs text-base-content/40 min-h-[16px]">
        {/* Left side - Status messages */}
        <div className="flex-1">
          {speechError ? (
            <div className="flex items-center gap-2 text-red-600">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <span>Speech error</span>
            </div>
          ) : isListening ? (
            <div className="flex items-center gap-2 text-emerald-600">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span>Listening...</span>
            </div>
          ) : isStreaming ? (
            <div className="flex items-center gap-2 text-amber-600">
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
              <span>Agent is responding...</span>
            </div>
          ) : disabled ? (
            <div className="flex items-center gap-2 text-emerald-600">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span>Tool running...</span>
            </div>
          ) : null}
        </div>

        {/* Right side - Token usage */}
        <div>{agentId && <CompactTokenUsage agentId={agentId} />}</div>
      </div>
    </div>
  );
});

// Compact token usage component for bottom-right display
const CompactTokenUsage = memo(function CompactTokenUsage({ agentId }: { agentId: ThreadId }) {
  const usageResult: UseAgentTokenUsageResult = useAgentTokenUsage(agentId);

  if (usageResult.loading) {
    return (
      <div className="text-xs text-base-content/40 flex items-center gap-1">
        <div className="loading loading-spinner loading-xs"></div>
        <span>Loading usage...</span>
      </div>
    );
  }

  if (usageResult.error || !usageResult.tokenUsage) {
    return null; // Don't show errors in compact view
  }

  return (
    <div className="text-xs text-base-content/40">
      <TokenUsageDisplay tokenUsage={usageResult.tokenUsage} loading={false} />
    </div>
  );
});
