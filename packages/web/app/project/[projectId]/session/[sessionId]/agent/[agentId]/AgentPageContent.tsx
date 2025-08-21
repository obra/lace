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

  // UI State - removed unused sidebar state after PageLayout migration

  // Context data
  const { currentProject } = useProjectContext();
  const {
    sessionDetails: selectedSessionDetails,
    updateAgent,
    reloadSessionDetails,
  } = useAgentContext();
  const { updateSessionConfiguration, updateSession } = useSessionContext();
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
    <PageLayout
      title={currentAgent ? `${currentAgent.name} - ${currentAgent.modelId}` : 'Agent'}
      onSelectProject={navigation.toHome}
      onSelectAgent={handleAgentSelect}
      onSelectSession={() => navigation.toSession(projectId, sessionId)}
    >
      <Chat />

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
    </PageLayout>
  );
}
