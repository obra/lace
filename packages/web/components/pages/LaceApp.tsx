// ABOUTME: New app layout component using DaisyUI design system
// ABOUTME: Combines design system layout structure with business logic patterns

'use client';

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faFolder, faComments, faRobot, faPlus, faCog, faTasks } from '@/lib/fontawesome';
import { Sidebar, SidebarSection, SidebarItem, SidebarButton } from '@/components/layout/Sidebar';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { TokenUsageDisplay } from '@/components/ui';
import { TokenUsageSection } from '@/components/ui/TokenUsageSection';
import { CompactTokenUsage } from '@/components/ui/CompactTokenUsage';
import { useAgentTokenUsage } from '@/hooks/useAgentTokenUsage';
import { ToolApprovalModal } from '@/components/modals/ToolApprovalModal';
import { LoadingView } from '@/components/pages/views/LoadingView';
import { Chat } from '@/components/chat/Chat';
import { SessionConfigPanel } from '@/components/config/SessionConfigPanel';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import { AgentEditModal } from '@/components/config/AgentEditModal';
import { FirstProjectHero } from '@/components/onboarding/FirstProjectHero';
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
import { asThreadId } from '@/types/core';
import { parseResponse } from '@/lib/serialization';
import { ApprovalDecision } from '@/types/core';
import type { LaceEvent } from '~/threads/types';
import type { UseAgentTokenUsageResult } from '@/hooks/useAgentTokenUsage';
import type { ToolApprovalRequestData } from '@/types/web-events';
import { UIProvider, useUIContext } from '@/components/providers/UIProvider';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useProviders } from '@/hooks/useProviders';
import { AppStateProvider, useAppState } from '@/components/providers/AppStateProvider';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import {
  EventStreamProvider,
  useSessionEvents,
  useEventStream,
} from '@/components/providers/EventStreamProvider';
import {
  ToolApprovalProvider,
  useToolApprovalContext,
} from '@/components/providers/ToolApprovalProvider';
import { TaskListSidebar } from '@/components/tasks/TaskListSidebar';
import { TaskSidebarSection } from '@/components/sidebar/TaskSidebarSection';
import { SessionSection } from '@/components/sidebar/SessionSection';
import { ProjectSection } from '@/components/sidebar/ProjectSection';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import { TaskProvider } from '@/components/providers/TaskProvider';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { AgentProvider } from '@/components/providers/AgentProvider';
import Link from 'next/link';

// Main app component logic
function LaceAppMain() {
  // Theme state
  const { theme, setTheme } = useTheme();

  // App state from context (now only hash router selections)
  const {
    selections: { selectedSession, selectedProject, selectedAgent, urlStateHydrated },
    actions: { setSelectedSession, updateHashState },
  } = useAppState();

  // Agent state from AgentProvider
  const {
    sessionDetails: selectedSessionDetails,
    loading: agentLoading,
    foundAgent,
    currentAgent,
    agentBusy,
    selectAgent: setSelectedAgent,
    createAgent,
    updateAgentState,
    reloadSessionDetails,
    loadAgentConfiguration,
    updateAgent,
  } = useAgentContext();

  // Session state from SessionProvider
  const {
    sessions,
    loading: sessionLoading,
    projectConfig,
    createSession,
    reloadSessions,
    enableAgentAutoSelection,
  } = useSessionContext();

  // Project state from ProjectProvider
  const {
    projects,
    loading: loadingProjects,
    foundProject,
    currentProject,
    projectsForSidebar,
    onProjectSelect,
    updateProject: updateProjectFromProvider,
    reloadProjects,
  } = useProjectContext();

  // UI State from UIProvider
  const {
    showMobileNav,
    setShowMobileNav,
    showDesktopSidebar,
    setShowDesktopSidebar,
    toggleDesktopSidebar,
    autoOpenCreateProject,
    setAutoOpenCreateProject,
    loading,
    setLoading,
  } = useUIContext();

  const { providers, loading: loadingProviders } = useProviders();

  // Agent config modal state
  const [showEditAgent, setShowEditAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<{
    threadId: string;
    name: string;
    providerInstanceId: string;
    modelId: string;
  } | null>(null);

  // Onboarding flow management
  const { handleOnboardingComplete, handleAutoOpenProjectCreation } = useOnboarding(
    setAutoOpenCreateProject,
    enableAgentAutoSelection
  );

  // Use session events from EventStreamProvider context
  const { events, loadingHistory } = useSessionEvents();

  // Use tool approvals from ToolApprovalProvider context
  const { pendingApprovals, handleApprovalDecision } = useToolApprovalContext();

  // Use event stream connection from EventStreamProvider context
  const { connection } = useEventStream();
  const connected = connection.connected;

  // Auto-open project creation modal when no projects exist
  useEffect(() => {
    if (!loadingProjects) {
      handleAutoOpenProjectCreation(projects?.length || 0);
    }
  }, [projects?.length, loadingProjects, handleAutoOpenProjectCreation]);

  // Handle agent selection within a session
  const handleAgentSelect = useCallback(
    (agentThreadId: string) => {
      setSelectedAgent(asThreadId(agentThreadId));
    },
    [setSelectedAgent]
  );

  // Handle switching projects (clear current selection)
  const handleSwitchProject = useCallback(() => {
    onProjectSelect({ id: '' }); // Empty string will be handled as null by ProjectProvider
  }, [onProjectSelect]);

  // Handle agent configuration
  const handleConfigureAgent = useCallback(
    async (agentId: string) => {
      try {
        const agentDetails = await loadAgentConfiguration(agentId);
        setEditingAgent({
          threadId: agentId,
          name: agentDetails.name,
          providerInstanceId: agentDetails.providerInstanceId,
          modelId: agentDetails.modelId,
        });
        setShowEditAgent(true);
      } catch (error) {
        console.error('Failed to load agent for editing:', error);
      }
    },
    [loadAgentConfiguration]
  );

  const handleEditAgentSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingAgent || !editingAgent.name.trim()) return;

      try {
        await updateAgent(editingAgent.threadId, {
          name: editingAgent.name.trim(),
          providerInstanceId: editingAgent.providerInstanceId,
          modelId: editingAgent.modelId,
        });
        setShowEditAgent(false);
        setEditingAgent(null);
      } catch (error) {
        console.error('Failed to update agent:', error);
      }
    },
    [editingAgent, updateAgent]
  );

  const handleCloseEditAgent = useCallback(() => {
    setShowEditAgent(false);
    setEditingAgent(null);
  }, []);

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
                    isMobile={true}
                    onCloseMobileNav={() => setShowMobileNav(false)}
                    onSwitchProject={handleSwitchProject}
                    onAgentSelect={handleAgentSelect}
                    onClearAgent={() => setSelectedAgent(null)}
                    onConfigureAgent={handleConfigureAgent}
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
              onToggle={toggleDesktopSidebar}
              onSettingsClick={onOpenSettings}
            >
              <SidebarContent
                isMobile={false}
                onSwitchProject={handleSwitchProject}
                onAgentSelect={handleAgentSelect}
                onClearAgent={() => setSelectedAgent(null)}
                onConfigureAgent={handleConfigureAgent}
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
            <LoadingView />
          ) : selectedProject && foundProject ? (
            selectedAgent || (selectedSessionDetails?.agents && selectedSessionDetails.agents.length > 0) ? (
              <Chat />
            ) : (
              <div className="flex-1 p-6">
                <SessionConfigPanel />
              </div>
            )
          ) : (
            <div className="flex-1 p-6 min-h-0 space-y-6">
              {projects.length === 0 && (
                <FirstProjectHero onCreateFirstProject={() => setAutoOpenCreateProject(true)} />
              )}
              {(projects.length > 0 || autoOpenCreateProject) && <ProjectSelectorPanel />}
            </div>
          )}
        </div>
      </motion.div>

      {/* Tool Approval Modal */}
      {pendingApprovals && pendingApprovals.length > 0 && (
        <ToolApprovalModal approvals={pendingApprovals} onDecision={handleApprovalDecision} />
      )}

      {/* Agent Edit Modal */}
      <AgentEditModal
        isOpen={showEditAgent}
        editingAgent={editingAgent}
        providers={providers}
        loading={agentLoading}
        onClose={handleCloseEditAgent}
        onSubmit={handleEditAgentSubmit}
        onAgentChange={setEditingAgent}
      />
    </motion.div>
  );
}

// Main LaceApp component with all providers
export default function LaceApp() {
  return (
    <AppStateProvider>
      <UIProvider>
        <LaceAppContent />
      </UIProvider>
    </AppStateProvider>
  );
}

// Content component with all business logic providers
function LaceAppContent() {
  const {
    selections: { selectedProject, selectedSession, selectedAgent },
    actions: { setSelectedProject },
  } = useAppState();

  const handleProjectChange = useCallback((projectId: string | null) => {
    // Enable auto-selection for project changes
  }, []);

  const handleAgentChange = useCallback((agentId: string | null) => {
    // Agent selection change handling
  }, []);

  const handleProjectSelect = useCallback(
    (projectId: string | null) => {
      setSelectedProject(projectId);
    },
    [setSelectedProject]
  );

  return (
    <ProjectProvider
      onProjectChange={handleProjectChange}
      selectedProject={selectedProject}
      onProjectSelect={handleProjectSelect}
    >
      <SessionProvider projectId={selectedProject}>
        <AgentProvider sessionId={selectedSession} onAgentChange={handleAgentChange}>
          <LaceAppWithAllProviders />
        </AgentProvider>
      </SessionProvider>
    </ProjectProvider>
  );
}

// Component with all remaining providers and main UI logic
function LaceAppWithAllProviders() {
  const {
    selections: { selectedProject, selectedSession, selectedAgent },
  } = useAppState();

  const { sessionDetails: selectedSessionDetails, updateAgentState } = useAgentContext();

  const handleAgentStateChange = useCallback(
    (agentId: string, from: string, to: string) => {
      updateAgentState(agentId, from, to);
    },
    [updateAgentState]
  );

  return (
    <ToolApprovalProvider agentId={selectedAgent as ThreadId | null}>
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
          <LaceAppMain />
        </TaskProvider>
      </EventStreamProvider>
    </ToolApprovalProvider>
  );
}
