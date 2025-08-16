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
import { ChatInput } from '@/components/chat/ChatInput';
import { TokenUsageDisplay } from '@/components/ui';
import { TokenUsageSection } from '@/components/ui/TokenUsageSection';
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
import { useTaskManager } from '@/hooks/useTaskManager';
import { useModalState } from '@/hooks/useModalState';
import { AppStateProvider, useAppState } from '@/components/providers/AppStateProvider';
import {
  EventStreamProvider,
  useSessionEvents,
  useEventStream,
  useSessionAPI,
  useToolApprovals,
} from '@/components/providers/EventStreamProvider';
import { TaskListSidebar } from '@/components/tasks/TaskListSidebar';
import Link from 'next/link';

// Inner component that uses app state context
const LaceAppInner = memo(function LaceAppInner() {
  // Theme state
  const { theme, setTheme } = useTheme();

  // App state from context (replaces individual hook calls)
  const {
    selections: { selectedProject, selectedSession, selectedAgent, urlStateHydrated },
    projects: { projects, loading: loadingProjects },
    sessions: { sessions, loading: sessionLoading, projectConfig },
    agents: { sessionDetails: selectedSessionDetails, loading: agentLoading },
    actions: {
      setSelectedProject,
      setSelectedSession,
      setSelectedAgent,
      updateHashState,
      updateProject,
      reloadProjects,
      createSession,
      reloadSessions,
      createAgent,
      updateAgentState,
      reloadSessionDetails,
    },
  } = useAppState();

  // UI State (from AnimatedLaceApp but remove demo data)
  const {
    showMobileNav,
    setShowMobileNav,
    showDesktopSidebar,
    setShowDesktopSidebar,
    showTaskBoard,
    setShowTaskBoard,
    showTaskCreation,
    setShowTaskCreation,
    showTaskDisplay,
    setShowTaskDisplay,
    selectedTaskForDisplay,
    setSelectedTaskForDisplay,
    autoOpenCreateProject,
    setAutoOpenCreateProject,
  } = useModalState();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loading, setLoading] = useState(false);

  // Use session events from EventStreamProvider context
  const { events, loadingHistory } = useSessionEvents();

  // Use session API from EventStreamProvider context
  const { sendMessage: sendMessageAPI, stopAgent: stopAgentAPI } = useSessionAPI();

  // Use tool approvals from EventStreamProvider context
  const { pendingApprovals, clearApprovalRequest, handleApprovalRequest, handleApprovalResponse } =
    useToolApprovals();

  // Use event stream connection from EventStreamProvider context
  const { connection } = useEventStream();
  const connected = connection.connected;

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

  // Task event handlers - wire to useTaskManager (only if available)
  // Note: Task events are not handled by EventStreamProvider, so we keep the task manager integration separate
  // TODO: Consider adding task event handling to EventStreamProvider if needed

  // Events are now LaceEvent[] directly
  // No conversion needed - components handle LaceEvent natively

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

  // Load providers on mount (projects are loaded by the hook)
  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  // Auto-open project creation modal when no projects exist
  useEffect(() => {
    if ((projects?.length || 0) === 0 && !loadingProjects) {
      setAutoOpenCreateProject(true);
    } else {
      setAutoOpenCreateProject(false);
    }
  }, [projects?.length, loadingProjects, setAutoOpenCreateProject]);

  // Sessions and project configuration are now handled by useSessionManagement hook
  // Session details are now loaded by useAgentManagement hook

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
      return await sendMessageAPI(selectedAgent as ThreadId, message);
    },
    [selectedAgent, sendMessageAPI]
  );

  const stopGeneration = useCallback(async () => {
    if (!selectedAgent) return false;
    return await stopAgentAPI(selectedAgent as ThreadId);
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
    await createSession(sessionData);
  };

  // Agent creation function
  const handleAgentCreate = async (sessionId: string, agentData: CreateAgentRequest) => {
    await createAgent(sessionId, agentData);
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
    await reloadSessionDetails();
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
    await updateProject(projectId, updates);
  };

  // Handle onboarding completion - navigate directly to chat
  const handleOnboardingComplete = async (
    projectId: string,
    sessionId: string,
    agentId: string
  ) => {
    // Reload projects first to ensure the newly created project is in the array
    await reloadProjects();

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
                  {/* WORKSPACE CONTEXT */}
                  {selectedProject && (
                    <SidebarSection
                      title="Workspace"
                      icon={faFolder}
                      defaultCollapsed={false}
                      collapsible={false}
                    >
                      {/* Project Overview Card */}
                      <div className="bg-base-100/80 backdrop-blur-sm border border-base-300/30 rounded-xl p-4 mb-3 shadow-sm -ml-1">
                        <div className="flex items-start justify-between mb-3">
                          <div className="min-w-0 flex-1">
                            <h3
                              data-testid="current-project-name"
                              className="font-semibold text-base-content text-sm truncate leading-tight"
                            >
                              {currentProject.name}
                            </h3>
                            {currentProject.description && (
                              <p className="text-xs text-base-content/60 truncate mt-0.5">
                                {currentProject.description}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              setSelectedProject(null);
                              setShowMobileNav(false);
                            }}
                            className="p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 flex-shrink-0 border border-transparent hover:border-base-300/30"
                            title="Switch project"
                          >
                            <svg
                              className="w-3.5 h-3.5 text-base-content/50 hover:text-base-content/70 transition-colors"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                              />
                            </svg>
                          </button>
                        </div>

                        {/* Project Stats */}
                        <div className="flex items-center gap-4 text-xs text-base-content/60">
                          <div className="flex items-center gap-1.5">
                            <FontAwesomeIcon icon={faComments} className="w-3 h-3" />
                            <span>
                              {sessions.length} session{sessions.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          {selectedSessionDetails && (
                            <div className="flex items-center gap-1.5">
                              <FontAwesomeIcon icon={faRobot} className="w-3 h-3" />
                              <span>
                                {selectedSessionDetails.agents?.length || 0} agent
                                {selectedSessionDetails.agents?.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </SidebarSection>
                  )}

                  {/* ACTIVE SESSION */}
                  {selectedSessionDetails && (
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
                          {!selectedAgent && (
                            <span className="text-xs text-warning font-medium">Setup needed</span>
                          )}
                        </div>

                        {/* Agent Status or Selection */}
                        {selectedAgent ? (
                          (() => {
                            const currentAgent = selectedSessionDetails.agents?.find(
                              (a) => a.threadId === selectedAgent
                            );
                            return currentAgent ? (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <FontAwesomeIcon
                                    icon={faRobot}
                                    className="w-3.5 h-3.5 text-base-content/60 flex-shrink-0"
                                  />
                                  <span className="text-xs text-base-content/80 truncate">
                                    {currentAgent.name}
                                  </span>
                                </div>
                                <span
                                  className={`text-xs badge badge-xs ${
                                    currentAgent.status === 'idle'
                                      ? 'badge-success'
                                      : currentAgent.status === 'thinking' ||
                                          currentAgent.status === 'tool_execution' ||
                                          currentAgent.status === 'streaming'
                                        ? 'badge-warning'
                                        : 'badge-neutral'
                                  }`}
                                >
                                  {currentAgent.status}
                                </span>
                              </div>
                            ) : null;
                          })()
                        ) : (
                          <div className="text-xs text-base-content/60">
                            {selectedSessionDetails.agents?.length || 0} agents available
                          </div>
                        )}
                      </div>

                      {/* Primary Actions */}
                      {selectedAgent ? (
                        <div className="space-y-2">
                          <SidebarButton
                            onClick={() => {
                              setShowMobileNav(false);
                            }}
                            variant="secondary"
                            className="font-medium"
                          >
                            Continue Session
                          </SidebarButton>

                          {selectedSessionDetails.agents &&
                            selectedSessionDetails.agents.length > 1 && (
                              <SidebarButton
                                onClick={() => {
                                  setSelectedAgent(null);
                                  setShowMobileNav(false);
                                }}
                                variant="ghost"
                                size="sm"
                              >
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
                              onClick={() => {
                                handleAgentSelect(agent.threadId);
                                setShowMobileNav(false);
                              }}
                              className="text-sm"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <FontAwesomeIcon
                                    icon={faRobot}
                                    className="w-3.5 h-3.5 text-base-content/60"
                                  />
                                  <span className="font-medium truncate">{agent.name}</span>
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

                          <SidebarButton
                            onClick={() => {
                              setSelectedAgent(null);
                              setShowMobileNav(false);
                            }}
                            variant="ghost"
                            size="sm"
                          >
                            <FontAwesomeIcon icon={faCog} className="w-3.5 h-3.5" />
                            Configure Session
                          </SidebarButton>
                        </div>
                      )}
                    </SidebarSection>
                  )}

                  {/* TASK MANAGEMENT */}
                  {selectedSessionDetails && selectedProject && selectedSession && taskManager && (
                    <SidebarSection
                      title="Tasks"
                      icon={faTasks}
                      defaultCollapsed={false}
                      collapsible={true}
                    >
                      {/* Task Overview */}
                      <div className="bg-base-300/20 backdrop-blur-sm border border-base-300/15 rounded-xl p-3 mb-3 shadow-sm -ml-1">
                        <div className="flex items-center justify-between mb-2">
                          <button
                            onClick={() => {
                              setShowTaskBoard(true);
                              setShowMobileNav(false);
                            }}
                            className="text-sm font-medium text-base-content hover:text-base-content/80 transition-colors"
                            disabled={taskManager.tasks.length === 0}
                          >
                            Task Board ({taskManager.tasks.length})
                          </button>
                          <button
                            onClick={() => {
                              setShowTaskCreation(true);
                              setShowMobileNav(false);
                            }}
                            className="p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 border border-transparent hover:border-base-300/30"
                            title="Add task"
                            data-testid="add-task-button"
                          >
                            <FontAwesomeIcon
                              icon={faPlus}
                              className="w-3 h-3 text-base-content/60"
                            />
                          </button>
                        </div>

                        {taskManager.tasks.length > 0 && (
                          <div className="flex items-center gap-3 text-xs text-base-content/60">
                            <div className="flex items-center gap-1">
                              <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                              <span>
                                {taskManager.tasks.filter((t) => t.status === 'completed').length}{' '}
                                done
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                              <span>
                                {taskManager.tasks.filter((t) => t.status === 'in_progress').length}{' '}
                                active
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
                              <span>
                                {taskManager.tasks.filter((t) => t.status === 'pending').length}{' '}
                                pending
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Task List */}
                      <TaskListSidebar
                        taskManager={taskManager}
                        onTaskClick={(taskId) => {
                          setShowMobileNav(false);
                        }}
                        onOpenTaskBoard={() => {
                          setShowTaskBoard(true);
                          setShowMobileNav(false);
                        }}
                        onCreateTask={() => {
                          setShowTaskCreation(true);
                          setShowMobileNav(false);
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
              {/* WORKSPACE CONTEXT */}
              {selectedProject && (
                <SidebarSection
                  title="Workspace"
                  icon={faFolder}
                  defaultCollapsed={false}
                  collapsible={false}
                >
                  {/* Project Overview Card */}
                  <div className="bg-base-100/80 backdrop-blur-sm border border-base-300/30 rounded-xl p-4 mb-3 shadow-sm -ml-1">
                    <div className="flex items-start justify-between mb-3">
                      <div className="min-w-0 flex-1">
                        <h3
                          data-testid="current-project-name-desktop"
                          className="font-semibold text-base-content text-sm truncate leading-tight"
                        >
                          {currentProject.name}
                        </h3>
                        {currentProject.description && (
                          <p className="text-xs text-base-content/60 truncate mt-0.5">
                            {currentProject.description}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setSelectedProject(null)}
                        className="p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 flex-shrink-0 border border-transparent hover:border-base-300/30"
                        title="Switch project"
                      >
                        <svg
                          className="w-3.5 h-3.5 text-base-content/50 hover:text-base-content/70 transition-colors"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                          />
                        </svg>
                      </button>
                    </div>

                    {/* Project Stats */}
                    <div className="flex items-center gap-4 text-xs text-base-content/60">
                      <div className="flex items-center gap-1.5">
                        <FontAwesomeIcon icon={faComments} className="w-3 h-3" />
                        <span>
                          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {selectedSessionDetails && (
                        <div className="flex items-center gap-1.5">
                          <FontAwesomeIcon icon={faRobot} className="w-3 h-3" />
                          <span>
                            {selectedSessionDetails.agents?.length || 0} agent
                            {selectedSessionDetails.agents?.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </SidebarSection>
              )}

              {/* ACTIVE SESSION */}
              {selectedSessionDetails && (
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
                      {!selectedAgent && (
                        <span className="text-xs text-warning font-medium">Setup needed</span>
                      )}
                    </div>

                    {/* Agent Status or Selection */}
                    {selectedAgent ? (
                      (() => {
                        const currentAgent = selectedSessionDetails.agents?.find(
                          (a) => a.threadId === selectedAgent
                        );
                        return currentAgent ? (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <FontAwesomeIcon
                                icon={faRobot}
                                className="w-3.5 h-3.5 text-base-content/60 flex-shrink-0"
                              />
                              <span className="text-xs text-base-content/80 truncate">
                                {currentAgent.name}
                              </span>
                            </div>
                            <span
                              className={`text-xs badge badge-xs ${
                                currentAgent.status === 'idle'
                                  ? 'badge-success'
                                  : currentAgent.status === 'thinking' ||
                                      currentAgent.status === 'tool_execution' ||
                                      currentAgent.status === 'streaming'
                                    ? 'badge-warning'
                                    : 'badge-neutral'
                              }`}
                            >
                              {currentAgent.status}
                            </span>
                          </div>
                        ) : null;
                      })()
                    ) : (
                      <div className="text-xs text-base-content/60">
                        {selectedSessionDetails.agents?.length || 0} agents available
                      </div>
                    )}
                  </div>

                  {/* Primary Actions */}
                  {selectedAgent ? (
                    <div className="space-y-2">
                      <SidebarButton
                        onClick={() => {
                          // Could scroll to chat input or focus it
                        }}
                        variant="secondary"
                        className="font-medium"
                      >
                        Continue Session
                      </SidebarButton>

                      {selectedSessionDetails.agents &&
                        selectedSessionDetails.agents.length > 1 && (
                          <SidebarButton
                            onClick={() => setSelectedAgent(null)}
                            variant="ghost"
                            size="sm"
                          >
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
                          onClick={() => handleAgentSelect(agent.threadId)}
                          className="text-sm"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <FontAwesomeIcon
                                icon={faRobot}
                                className="w-3.5 h-3.5 text-base-content/60"
                              />
                              <span className="font-medium truncate">{agent.name}</span>
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

                      <SidebarButton
                        onClick={() => setSelectedAgent(null)}
                        variant="ghost"
                        size="sm"
                      >
                        <FontAwesomeIcon icon={faCog} className="w-3.5 h-3.5" />
                        Configure Session
                      </SidebarButton>
                    </div>
                  )}
                </SidebarSection>
              )}

              {/* TASK MANAGEMENT */}
              {selectedSessionDetails && selectedProject && selectedSession && taskManager && (
                <SidebarSection
                  title="Tasks"
                  icon={faTasks}
                  defaultCollapsed={false}
                  collapsible={true}
                >
                  {/* Task Overview */}
                  <div className="bg-base-300/20 backdrop-blur-sm border border-base-300/15 rounded-xl p-3 mb-3 shadow-sm -ml-1">
                    <div className="flex items-center justify-between mb-2">
                      <button
                        onClick={() => setShowTaskBoard(true)}
                        className="text-sm font-medium text-base-content hover:text-base-content/80 transition-colors"
                        disabled={taskManager.tasks.length === 0}
                      >
                        Task Board ({taskManager.tasks.length})
                      </button>
                      <button
                        onClick={() => setShowTaskCreation(true)}
                        className="p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 border border-transparent hover:border-base-300/30"
                        title="Add task"
                        data-testid="add-task-button"
                      >
                        <FontAwesomeIcon icon={faPlus} className="w-3 h-3 text-base-content/60" />
                      </button>
                    </div>

                    {taskManager.tasks.length > 0 && (
                      <div className="flex items-center gap-3 text-xs text-base-content/60">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                          <span>
                            {taskManager.tasks.filter((t) => t.status === 'completed').length} done
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                          <span>
                            {taskManager.tasks.filter((t) => t.status === 'in_progress').length}{' '}
                            active
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
                          <span>
                            {taskManager.tasks.filter((t) => t.status === 'pending').length} pending
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Task List */}
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
                <div className="loading loading-spinner loading-lg text-base-content/60"></div>
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
                      agentId={
                        (selectedAgent as ThreadId) || selectedSessionDetails?.agents?.[0]?.threadId
                      }
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
                  onProjectCreate={() => void reloadProjects()}
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
      <CustomChatInput
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
const CustomChatInput = memo(function CustomChatInput({
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
      <ChatInput
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

// Component that needs event stream context
const LaceAppWithEventStream = memo(function LaceAppWithEventStream() {
  const {
    selections: { selectedProject, selectedSession, selectedAgent },
    actions: { updateAgentState },
  } = useAppState();

  const handleAgentStateChange = useCallback(
    (agentId: string, from: string, to: string) => {
      updateAgentState(agentId, from, to);
    },
    [updateAgentState]
  );

  return (
    <EventStreamProvider
      projectId={selectedProject}
      sessionId={selectedSession as ThreadId | null}
      agentId={selectedAgent as ThreadId | null}
      onAgentStateChange={handleAgentStateChange}
    >
      <LaceAppInner />
    </EventStreamProvider>
  );
});

// Main LaceApp component that wraps with both providers
export default function LaceApp() {
  return (
    <AppStateProvider>
      <LaceAppWithEventStream />
    </AppStateProvider>
  );
}
