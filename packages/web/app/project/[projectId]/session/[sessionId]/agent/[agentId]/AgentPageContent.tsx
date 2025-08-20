// ABOUTME: Agent page content component - uses new PageLayout architecture
// ABOUTME: Contains the full chat UI with modals, simplified layout structure

'use client';

import React, { useState, useCallback } from 'react';
import { Chat } from '@/components/chat/Chat';
import { ToolApprovalModal } from '@/components/modals/ToolApprovalModal';
import { AgentEditModal } from '@/components/config/AgentEditModal';
import { SessionEditModal } from '@/components/config/SessionEditModal';
import { PageLayout } from '@/components/layout/PageLayout';

import { asThreadId } from '@/types/core';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useToolApprovalContext } from '@/components/providers/ToolApprovalProvider';
import { useProviders } from '@/hooks/useProviders';
import { useURLState } from '@/hooks/useURLState';
import { useNavigation } from '@/hooks/useNavigation';

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
  const { providers } = useProviders();

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

  // Navigation using proper Next.js router
  const navigation = useNavigation();

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
          {({ onOpenSettings }) => (
            <Sidebar open={sidebarOpen} onToggle={toggleSidebar} onSettingsClick={onOpenSettings}>
              <SidebarContent
                isMobile={false} // Component now handles mobile/desktop internally
                onCloseMobileNav={toggleSidebar}
                onSwitchProject={navigation.toHome}
                onAgentSelect={handleAgentSelect}
                onClearAgent={() => navigation.toSession(projectId, sessionId)}
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
                onClick={toggleSidebar}
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
