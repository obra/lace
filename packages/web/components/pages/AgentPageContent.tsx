// ABOUTME: Agent page content component - extracted from LaceApp for proper routing
// ABOUTME: Contains the full chat UI with sidebar, chat interface, and modals

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars } from '@/lib/fontawesome';

import { Sidebar } from '@/components/layout/Sidebar';
import { Chat } from '@/components/chat/Chat';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import { ToolApprovalModal } from '@/components/modals/ToolApprovalModal';
import { SettingsContainer } from '@/components/settings/SettingsContainer';
import { SessionEditModal } from '@/components/config/SessionEditModal';
import { AgentCreateChatModal } from '@/components/modals/AgentCreateChatModal';

import { useUIContext } from '@/components/providers/UIProvider';
import { asThreadId, isAgentSummaryUpdatedData } from '@/types/core';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useToolApprovalContext } from '@/components/providers/ToolApprovalProvider';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';
import { useURLState } from '@/hooks/useURLState';
import { useEventStreamContext } from '@/components/providers/EventStreamProvider';
import { api } from '@/lib/api-client';
import useSWR from 'swr';
import type { PersonaCatalogResponse } from '@/app/routes/api.persona.catalog';

interface AgentPageContentProps {
  projectId: string;
  sessionId: string;
  agentId: string;
}

export function AgentPageContent({ projectId, sessionId, agentId }: AgentPageContentProps) {
  const { navigateToAgent, navigateToRoot } = useURLState();

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
  const { pendingApprovals, handleApprovalDecision } = useToolApprovalContext();
  const { availableProviders: providers } = useProviderInstances();

  // Agent summary state
  const [agentSummary, setAgentSummary] = useState<string | null>(null);

  const [showSessionEditModal, setShowSessionEditModal] = useState(false);
  const [showCreateAgentModal, setShowCreateAgentModal] = useState(false);

  // Fetch personas for the modal
  const { data: personaData } = useSWR('/api/persona/catalog', (url: string) =>
    api.get<PersonaCatalogResponse>(url)
  );
  const personas = personaData?.personas || [];

  // Event handlers
  const handleAgentSelect = useCallback(
    (agentThreadId: string) => {
      navigateToAgent(projectId, asThreadId(sessionId), asThreadId(agentThreadId));
    },
    [navigateToAgent, projectId, sessionId]
  );

  const handleSwitchProject = useCallback(() => {
    // Navigate to root to show project selection
    navigateToRoot();
  }, [navigateToRoot]);

  const handleConfigureSession = useCallback(() => {
    setShowSessionEditModal(true);
  }, []);

  const handleCreateAgent = useCallback(() => {
    setShowCreateAgentModal(true);
  }, []);

  const handleAgentCreated = useCallback(
    async (config: {
      personaName: string;
      providerInstanceId: string;
      modelId: string;
      initialMessage?: string;
    }) => {
      await api.post(`/api/sessions/${sessionId}/agents`, {
        name: `${config.personaName} Agent`,
        providerInstanceId: config.providerInstanceId,
        modelId: config.modelId,
        persona: config.personaName,
        initialMessage: config.initialMessage,
      });

      // Reload session details to show new agent
      await reloadSessionDetails();
    },
    [sessionId, reloadSessionDetails]
  );

  // Listen for agent summary updates from existing event stream
  const { agentEvents } = useEventStreamContext();

  useEffect(() => {
    if (!agentEvents.events) {
      setAgentSummary(null); // Clear summary when no events
      return;
    }

    // Look for the most recent AGENT_SUMMARY_UPDATED event for this agent
    let foundSummary = false;
    for (let i = agentEvents.events.length - 1; i >= 0; i--) {
      const event = agentEvents.events[i];
      if (
        event.type === 'AGENT_SUMMARY_UPDATED' &&
        isAgentSummaryUpdatedData(event.data) &&
        event.data.agentThreadId === agentId
      ) {
        setAgentSummary(event.data.summary);
        foundSummary = true;
        break; // Only use the most recent summary
      }
    }

    // Clear stale summary when switching agents
    if (!foundSummary) {
      setAgentSummary(null);
    }
  }, [agentEvents.events, agentId]);

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
                onConfigureSession={handleConfigureSession}
                onCreateAgent={handleCreateAgent}
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
              <div className="flex flex-col gap-1">
                <h1 className="font-semibold text-base-content truncate">
                  {currentAgent ? currentAgent.name : 'Agent'}
                </h1>
                {agentSummary && (
                  <p className="text-sm text-base-content/70 truncate">{agentSummary}</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Chat Interface */}
        <div className="flex-1 flex flex-col min-h-0 text-base-content bg-base-100/30 backdrop-blur-sm">
          <Chat key={agentId} />
        </div>
      </motion.div>

      {/* Tool Approval Modal */}
      {pendingApprovals && pendingApprovals.length > 0 && (
        <ToolApprovalModal approvals={pendingApprovals} onDecision={handleApprovalDecision} />
      )}

      {/* Session Edit Modal */}
      {currentProject && (
        <SessionEditModal
          isOpen={showSessionEditModal}
          currentProject={currentProject}
          selectedSession={selectedSessionDetails}
          onClose={() => setShowSessionEditModal(false)}
          onSuccess={reloadSessionDetails}
        />
      )}

      {/* Agent Create Modal */}
      <AgentCreateChatModal
        isOpen={showCreateAgentModal}
        onClose={() => setShowCreateAgentModal(false)}
        onCreateAgent={handleAgentCreated}
        personas={personas}
        providers={providers}
        defaultPersonaName="default"
        defaultProviderInstanceId={providers.find((p) => p.configured)?.instanceId}
        defaultModelId={providers.find((p) => p.configured)?.models[0]?.id}
      />
    </motion.div>
  );
}
