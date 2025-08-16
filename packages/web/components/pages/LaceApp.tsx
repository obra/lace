// ABOUTME: New app layout component using DaisyUI design system
// ABOUTME: Combines design system layout structure with business logic patterns

'use client';

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faFolder, faComments, faRobot, faPlus, faCog, faTasks } from '@/lib/fontawesome';
import { Sidebar, SidebarSection, SidebarItem, SidebarButton } from '@/components/layout/Sidebar';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { Chat } from '@/components/chat/Chat';
import { TokenUsageDisplay } from '@/components/ui';
import { TokenUsageSection } from '@/components/ui/TokenUsageSection';
import { CompactTokenUsage } from '@/components/ui/CompactTokenUsage';
import { useAgentTokenUsage } from '@/hooks/useAgentTokenUsage';
import { ToolApprovalModal } from '@/components/modals/ToolApprovalModal';
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
import { useModalState } from '@/hooks/useModalState';
import { useProviders } from '@/hooks/useProviders';
import { AppStateProvider, useAppState } from '@/components/providers/AppStateProvider';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import {
  EventStreamProvider,
  useSessionEvents,
  useEventStream,
  useSessionAPI,
  useToolApprovals,
} from '@/components/providers/EventStreamProvider';
import { TaskListSidebar } from '@/components/tasks/TaskListSidebar';
import { TaskSidebarSection } from '@/components/sidebar/TaskSidebarSection';
import { SessionSection } from '@/components/sidebar/SessionSection';
import { ProjectSection } from '@/components/sidebar/ProjectSection';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import { TaskProvider } from '@/components/providers/TaskProvider';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import Link from 'next/link';

// Inner component that uses app state context
const LaceAppInner = memo(function LaceAppInner() {
  // Theme state
  const { theme, setTheme } = useTheme();

  // App state from context (replaces individual hook calls)
  const {
    selections: { selectedSession, selectedAgent, urlStateHydrated },
    sessions: { sessions, loading: sessionLoading, projectConfig },
    agents: { sessionDetails: selectedSessionDetails, loading: agentLoading },
    actions: {
      setSelectedSession,
      setSelectedAgent,
      updateHashState,
      createSession,
      reloadSessions,
      createAgent,
      updateAgentState,
      reloadSessionDetails,
    },
  } = useAppState();

  // Project state from ProjectProvider
  const {
    projects,
    loading: loadingProjects,
    selectedProject,
    foundProject,
    projectsForSidebar,
    onProjectSelect,
    updateProject: updateProjectFromProvider,
    reloadProjects,
  } = useProjectContext();

  // Create fallback current project for this component's UI needs
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
        sessionCount: 0,
      },
    [foundProject]
  );

  // UI State (from AnimatedLaceApp but remove demo data)
  const {
    showMobileNav,
    setShowMobileNav,
    showDesktopSidebar,
    setShowDesktopSidebar,
    autoOpenCreateProject,
    setAutoOpenCreateProject,
  } = useModalState();
  const { providers, loading: loadingProviders } = useProviders();
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

  // Events are now LaceEvent[] directly
  // No conversion needed - components handle LaceEvent natively

  // Providers are now loaded by useProviders hook

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

  // Handle project selection - now delegated to ProjectProvider
  const handleProjectSelect = (project: { id: string }) => {
    // ProjectProvider handles the selection
    onProjectSelect(project);
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

  // Handle project updates (archive/unarchive/edit) - now delegated to ProjectProvider
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
    await updateProjectFromProvider(projectId, updates);
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

  // Project data transformations are now handled by ProjectProvider

  // Handle switching projects (clear current selection)
  const handleSwitchProject = useCallback(() => {
    onProjectSelect({ id: '' }); // Empty string will be handled as null by ProjectProvider
  }, [onProjectSelect]);

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
                  <SidebarContent
                    selectedProject={selectedProject}
                    currentProject={currentProject}
                    sessionsCount={sessions.length}
                    selectedSession={selectedSession as ThreadId | null}
                    selectedSessionDetails={selectedSessionDetails}
                    selectedAgent={selectedAgent as ThreadId | null}
                    isMobile={true}
                    onCloseMobileNav={() => setShowMobileNav(false)}
                    onSwitchProject={handleSwitchProject}
                    onAgentSelect={handleAgentSelect}
                    onClearAgent={() => setSelectedAgent(null)}
                  />
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
              <SidebarContent
                selectedProject={selectedProject}
                currentProject={currentProject}
                sessionsCount={sessions.length}
                selectedSession={selectedSession as ThreadId | null}
                selectedSessionDetails={selectedSessionDetails}
                selectedAgent={selectedAgent as ThreadId | null}
                isMobile={false}
                onSwitchProject={handleSwitchProject}
                onAgentSelect={handleAgentSelect}
                onClearAgent={() => setSelectedAgent(null)}
              />
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
              <Chat
                events={events}
                agents={selectedSessionDetails?.agents}
                selectedAgent={selectedAgent as ThreadId | null}
                agentBusy={agentBusy}
                onSendMessage={sendMessage}
                onStopGeneration={stopGeneration}
              />
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
    </motion.div>
  );
});

// Main LaceApp component with integrated provider hierarchy
export default function LaceApp() {
  return (
    <AppStateProvider>
      <LaceAppContent />
    </AppStateProvider>
  );
}

// Main app content with all providers integrated
const LaceAppContent = memo(function LaceAppContent() {
  const {
    selections: { selectedProject, selectedSession, selectedAgent },
    agents: { sessionDetails: selectedSessionDetails },
    actions: { updateAgentState },
  } = useAppState();

  const handleAgentStateChange = useCallback(
    (agentId: string, from: string, to: string) => {
      updateAgentState(agentId, from, to);
    },
    [updateAgentState]
  );

  const handleProjectChange = useCallback((projectId: string | null) => {
    // Enable auto-selection for project changes
    // This matches the current LaceApp behavior
    // TODO: Move this logic to AgentProvider when we create it
  }, []);

  return (
    <ProjectProvider onProjectChange={handleProjectChange}>
      <EventStreamProvider
        projectId={selectedProject}
        sessionId={selectedSession as ThreadId | null}
        agentId={selectedAgent as ThreadId | null}
        onAgentStateChange={handleAgentStateChange}
      >
        <TaskProvider
          projectId={selectedProject}
          sessionId={selectedSession as ThreadId | null}
          agents={selectedSessionDetails?.agents}
        >
          <LaceAppInner />
        </TaskProvider>
      </EventStreamProvider>
    </ProjectProvider>
  );
});
