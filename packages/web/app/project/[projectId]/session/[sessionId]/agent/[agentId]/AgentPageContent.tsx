// ABOUTME: Agent page content component - extracted from LaceApp for proper routing
// ABOUTME: Contains the full chat UI with sidebar, chat interface, and modals

'use client';

import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars } from '@/lib/fontawesome';

import { Sidebar } from '@/components/layout/Sidebar';
import { Chat } from '@/components/chat/Chat';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import { ToolApprovalModal } from '@/components/modals/ToolApprovalModal';
import { SettingsContainer } from '@/components/settings/SettingsContainer';
import { AgentEditModal } from '@/components/config/AgentEditModal';
import { SessionEditModal } from '@/components/config/SessionEditModal';

import { useUIContext } from '@/components/providers/UIProvider';
import { asThreadId } from '@/types/core';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useToolApprovalContext } from '@/components/providers/ToolApprovalProvider';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';
import { useURLState } from '@/hooks/useURLState';

import type { SessionConfiguration } from '@/types/api';

interface AgentPageContentProps {
  projectId: string;
  sessionId: string;
  agentId: string;
}

export function AgentPageContent({ projectId, sessionId, agentId }: AgentPageContentProps) {
  const { navigateToAgent } = useURLState();

  // UI State
  const { sidebarOpen, toggleSidebar } = useUIContext();

  // Context data
  const { currentProject } = useProjectContext();
  const {
    sessionDetails: selectedSessionDetails,
    loadAgentConfiguration,
    updateAgent,
    reloadSessionDetails,
  } = useAgentContext();
  const { loadSessionConfiguration, updateSessionConfiguration, updateSession } =
    useSessionContext();
  const { pendingApprovals, handleApprovalDecision } = useToolApprovalContext();
  const { availableProviders: providers } = useProviderInstances();

  // Modal states
  const [showEditAgent, setShowEditAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<{
    threadId: string;
    name: string;
    providerInstanceId: string;
    modelId: string;
  } | null>(null);

  const [showSessionEditModal, setShowSessionEditModal] = useState(false);
  const [sessionConfig, setSessionConfig] = useState<SessionConfiguration>({
    providerInstanceId: undefined,
    modelId: undefined,
    maxTokens: 4096,
    tools: [],
    toolPolicies: {},
    workingDirectory: undefined,
    environmentVariables: {},
  });
  const [sessionName, setSessionName] = useState('');
  const [sessionDescription, setSessionDescription] = useState('');

  // Event handlers
  const handleAgentSelect = useCallback(
    (agentThreadId: string) => {
      navigateToAgent(projectId, asThreadId(sessionId), asThreadId(agentThreadId));
    },
    [navigateToAgent, projectId, sessionId]
  );

  const handleSwitchProject = useCallback(() => {
    // Navigate to root to show project selection
    window.location.href = '/';
  }, []);

  const handleConfigureAgent = useCallback(
    async (agentIdToEdit: string) => {
      try {
        const agentDetails = await loadAgentConfiguration(agentIdToEdit);
        setEditingAgent({
          threadId: agentIdToEdit,
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

  const handleConfigureSession = useCallback(async () => {
    if (selectedSessionDetails) {
      setSessionName(selectedSessionDetails.name);
      setSessionDescription(selectedSessionDetails.description || '');

      try {
        const config = await loadSessionConfiguration(selectedSessionDetails.id);
        setSessionConfig(config as SessionConfiguration);
        setShowSessionEditModal(true);
      } catch (error) {
        console.error('Failed to load session configuration:', error);
      }
    }
  }, [selectedSessionDetails, loadSessionConfiguration]);

  const handleSessionEditSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedSessionDetails || !sessionName.trim()) return;

      try {
        await updateSessionConfiguration(selectedSessionDetails.id, sessionConfig);

        const nameChanged = sessionName.trim() !== selectedSessionDetails.name;
        const descChanged =
          (sessionDescription.trim() || undefined) !== selectedSessionDetails.description;

        if (nameChanged || descChanged) {
          await updateSession(selectedSessionDetails.id, {
            name: sessionName.trim(),
            description: sessionDescription.trim() || undefined,
          });
        }

        setShowSessionEditModal(false);
        await reloadSessionDetails();
      } catch (error) {
        console.error('Failed to update session:', error);
      }
    },
    [
      selectedSessionDetails,
      sessionName,
      sessionDescription,
      sessionConfig,
      updateSessionConfiguration,
      updateSession,
      reloadSessionDetails,
    ]
  );

  // Get current agent info for display
  const currentAgent = selectedSessionDetails?.agents?.find((a) => a.threadId === agentId);

  return (
    <motion.div
      className="flex h-screen bg-gradient-to-br from-base-100 via-base-200/50 to-base-200 text-base-content font-ui overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Unified Sidebar */}
      <div data-testid="sidebar" className="flex-shrink-0 h-full">
        <SettingsContainer>
          {({ onOpenSettings }: { onOpenSettings: () => void }) => (
            <Sidebar
              open={sidebarOpen}
              onToggle={toggleSidebar}
              onSettingsClick={onOpenSettings as () => void}
            >
              <SidebarContent
                isMobile={false} // Component now handles mobile/desktop internally
                onCloseMobileNav={toggleSidebar as () => void}
                onSwitchProject={handleSwitchProject}
                onAgentSelect={handleAgentSelect}
                onClearAgent={() =>
                  (window.location.href = `/project/${projectId}/session/${sessionId}`)
                }
                onConfigureAgent={handleConfigureAgent}
                onConfigureSession={handleConfigureSession}
              />
            </Sidebar>
          )}
        </SettingsContainer>
      </div>

      {/* Main Content */}
      <motion.div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Top Bar */}
        <motion.div className="bg-base-100/90 backdrop-blur-md border-b border-base-300/50 flex-shrink-0 z-30">
          <motion.div className="flex items-center justify-between p-4 lg:px-6">
            <motion.div className="flex items-center gap-3">
              <motion.button
                onClick={toggleSidebar as () => void}
                className="p-2 hover:bg-base-200 rounded-lg lg:hidden"
              >
                <FontAwesomeIcon icon={faBars} className="w-6 h-6" />
              </motion.button>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-base-content truncate">
                  {currentAgent ? `${currentAgent.name} - ${currentAgent.modelId}` : 'Agent'}
                </h1>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Chat Interface */}
        <div className="flex-1 flex flex-col min-h-0 text-base-content bg-base-100/30 backdrop-blur-sm">
          <Chat />
        </div>
      </motion.div>

      {/* Tool Approval Modal */}
      {pendingApprovals && pendingApprovals.length > 0 && (
        <div data-testid="tool-approval-modal">
          <ToolApprovalModal approvals={pendingApprovals} onDecision={handleApprovalDecision} />
        </div>
      )}

      {/* Agent Edit Modal */}
      <AgentEditModal
        isOpen={showEditAgent}
        editingAgent={editingAgent}
        providers={providers}
        loading={false}
        onClose={() => {
          setShowEditAgent(false);
          setEditingAgent(null);
        }}
        onSubmit={handleEditAgentSubmit}
        onAgentChange={setEditingAgent}
      />

      {/* Session Edit Modal */}
      {currentProject && (
        <SessionEditModal
          isOpen={showSessionEditModal}
          currentProject={currentProject}
          selectedSession={selectedSessionDetails}
          providers={providers}
          sessionConfig={sessionConfig}
          sessionName={sessionName}
          sessionDescription={sessionDescription}
          loading={false}
          onClose={() => setShowSessionEditModal(false)}
          onSubmit={handleSessionEditSubmit}
          onSessionNameChange={setSessionName}
          onSessionDescriptionChange={setSessionDescription}
          onSessionConfigChange={setSessionConfig}
        />
      )}
    </motion.div>
  );
}
