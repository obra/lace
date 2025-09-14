// ABOUTME: Comprehensive session configuration panel for main pane
// ABOUTME: Handles session creation/editing with full configuration options

'use client';

import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash } from '@/lib/fontawesome';
import { SessionHeader } from './SessionHeader';
import { SessionsList } from './SessionsList';
import { SessionEditModal } from './SessionEditModal';
import { AgentCreateModal } from './AgentCreateModal';
import { AgentEditModal } from './AgentEditModal';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import type { SessionConfiguration } from '@/types/api';
import type { SessionInfo, ProjectInfo, ToolPolicy } from '@/types/core';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useURLState } from '@/hooks/useURLState';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';
import { asThreadId } from '@/types/core';

const DEFAULT_CONFIG: SessionConfiguration = {
  // Note: providerInstanceId and modelId should be set by user selection, not defaults
  maxTokens: 4096,
  tools: undefined, // Use all available user-configurable tools
  toolPolicies: {},
  environmentVariables: {},
};

export function SessionConfigPanel(): React.JSX.Element {
  // Get data from providers instead of props
  const { currentProject } = useProjectContext();
  const {
    sessions,
    projectConfig,
    createSession,
    loading: sessionLoading,
    loadSessionConfiguration,
    updateSessionConfiguration,
    updateSession,
    deleteSession,
  } = useSessionContext();
  const {
    sessionDetails: selectedSession,
    createAgent,
    reloadSessionDetails,
    loading: agentLoading,
    loadAgentConfiguration,
    updateAgent,
  } = useAgentContext();
  const { project, session, navigateToSession, navigateToAgent, navigateToProject } = useURLState();
  const { availableProviders, instancesLoading: providersLoading } = useProviderInstances();

  const loading = sessionLoading || agentLoading || providersLoading;
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showEditConfig, setShowEditConfig] = useState(false);
  const [showEditAgent, setShowEditAgent] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<SessionInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingAgent, setEditingAgent] = useState<{
    threadId: string;
    name: string;
    providerInstanceId: string;
    modelId: string;
    persona: string;
  } | null>(null);

  // Session creation state (simplified - only need provider config)
  const [sessionConfig, setSessionConfig] = useState<SessionConfiguration>(DEFAULT_CONFIG);

  // Agent creation state
  const [newAgentName, setNewAgentName] = useState('');
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  // Reset form when project or project configuration changes
  const projectId = currentProject.id;
  useEffect(() => {
    setShowCreateAgent(false);
    setShowEditConfig(false);
    setShowEditAgent(false);
    setEditingAgent(null);
    resetSessionForm();
    resetAgentForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Reason: only reset when projectId/projectConfig change to avoid unwanted resets on handler identity changes
  }, [projectId, projectConfig]);

  const resetSessionForm = useCallback(() => {
    // Use project configuration as defaults if available
    const defaultConfig = { ...DEFAULT_CONFIG };
    if (projectConfig) {
      if (projectConfig.providerInstanceId) {
        defaultConfig.providerInstanceId = projectConfig.providerInstanceId as string;
      }
      if (projectConfig.modelId) {
        defaultConfig.modelId = projectConfig.modelId as string;
      }
      if (projectConfig.workingDirectory) {
        defaultConfig.workingDirectory = projectConfig.workingDirectory as string;
      }
      if (projectConfig.environmentVariables) {
        defaultConfig.environmentVariables = projectConfig.environmentVariables as Record<
          string,
          string
        >;
      }
      if (projectConfig.toolPolicies) {
        defaultConfig.toolPolicies = projectConfig.toolPolicies as Record<string, ToolPolicy>;
      }
    }
    setSessionConfig(defaultConfig);
  }, [projectConfig]);

  const resetAgentForm = () => {
    setNewAgentName('');
    setSelectedInstanceId('');
    setSelectedModelId('');
  };

  const handleProviderInstanceSelection = (instanceId: string, modelId: string) => {
    setSelectedInstanceId(instanceId);
    setSelectedModelId(modelId);
  };

  const handleCreateSession = async (userInput: string) => {
    try {
      // Extract providerInstanceId and modelId from sessionConfig for simplified flow
      const { providerInstanceId, modelId, ...otherConfig } = sessionConfig;

      const sessionData = await createSession({
        initialMessage: userInput, // New simplified flow
        providerInstanceId: providerInstanceId || '',
        modelId: modelId || '',
        configuration: otherConfig,
      });

      resetSessionForm();

      // Navigate to the new session with initial message for pre-filling
      if (sessionData && project) {
        navigateToSession(project, asThreadId(sessionData.id), {
          initialMessage: userInput,
        });
      }
    } catch (error) {
      // Error will be handled in the modal
      console.error('Failed to create session:', error);
      throw error;
    }
  };

  const handleCreateAgent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim() || !selectedSession) return;

    // All agents now require provider instances - no fallback to legacy system
    if (!selectedInstanceId || !selectedModelId) {
      // Should not happen with proper UI validation
      console.error('Cannot create agent without provider instance and model selection');
      return;
    }

    createAgent(selectedSession.id, {
      name: newAgentName.trim(),
      providerInstanceId: selectedInstanceId,
      modelId: selectedModelId,
    });

    resetAgentForm();
    setShowCreateAgent(false);
  };

  // Handle session edit
  const handleEditSessionClick = async (sessionId?: string) => {
    setShowEditConfig(true);
  };

  const handleEditAgentSubmit = async (e: React.FormEvent) => {
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
  };

  // Callback functions for SessionsList
  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      if (project) {
        navigateToSession(project, asThreadId(sessionId));
      }
    },
    [project, navigateToSession]
  );

  const handleAgentSelect = useCallback(
    (agentId: string) => {
      if (project && session) {
        navigateToAgent(project, session, asThreadId(agentId));
      }
    },
    [project, session, navigateToAgent]
  );

  const handleCreateAgentClick = useCallback(() => {
    setShowCreateAgent(true);
  }, []);

  const handleEditAgentClick = useCallback(
    async (agent: { threadId: string; name: string; status: string }) => {
      try {
        // Load agent configuration from provider
        const agentDetails = await loadAgentConfiguration(agent.threadId);

        setEditingAgent({
          threadId: agent.threadId,
          name: agentDetails.name,
          providerInstanceId: agentDetails.providerInstanceId,
          modelId: agentDetails.modelId,
          persona: agentDetails.persona,
        });
        setShowEditAgent(true);
      } catch (error) {
        console.error('Failed to load agent for editing:', error);
      }
    },
    [loadAgentConfiguration]
  );

  const handleDeleteSessionClick = useCallback(
    (sessionId?: string) => {
      const targetSessionId = sessionId || selectedSession?.id;
      if (!targetSessionId) return;

      const targetSession = sessions.find((s) => s.id === targetSessionId) || selectedSession;
      if (!targetSession) return;

      setSessionToDelete(targetSession);
      setShowDeleteConfirm(true);
    },
    [sessions, selectedSession]
  );

  const handleDeleteSession = useCallback(async () => {
    if (!sessionToDelete || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteSession(sessionToDelete.id);
      // Only close modal and clear state on success
      setShowDeleteConfirm(false);
      setSessionToDelete(null);
      setIsDeleting(false);
      setDeleteError(null);

      // Navigate back to project page if we deleted the currently selected session
      if (selectedSession?.id === sessionToDelete.id && project) {
        navigateToProject(project); // Clear session selection
      }
    } catch (error) {
      console.error('Session delete error:', { sessionId: sessionToDelete.id, error });
      setIsDeleting(false);
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete session. Please try again.'
      );
      // Don't close modal or clear sessionToDelete - let user retry
    }
  }, [sessionToDelete, deleteSession, selectedSession, project, navigateToProject, isDeleting]);

  const handleCancelDelete = useCallback(() => {
    if (isDeleting) return; // Don't allow cancel during deletion
    setShowDeleteConfirm(false);
    setSessionToDelete(null);
    setDeleteError(null);
  }, [isDeleting]);

  const handleCloseEditSession = useCallback(() => {
    setShowEditConfig(false);
  }, []);

  // Agent creation modal handlers
  const handleAgentNameChange = useCallback((name: string) => {
    setNewAgentName(name);
  }, []);

  const handleCloseCreateAgent = useCallback(() => {
    setShowCreateAgent(false);
  }, []);

  // Agent edit modal handlers
  const handleCloseEditAgent = useCallback(() => {
    setShowEditAgent(false);
    setEditingAgent(null);
  }, []);

  return (
    <div className="bg-base-100 rounded-lg border border-base-300 p-6 overflow-y-auto">
      <SessionHeader project={currentProject} />

      <SessionsList
        sessions={sessions}
        selectedSession={selectedSession}
        loading={loading}
        onSessionSelect={handleSessionSelect}
        onEditSession={handleEditSessionClick}
        onDeleteSession={handleDeleteSessionClick}
        onCreateAgent={handleCreateAgentClick}
        onCreateSession={handleCreateSession}
        onEditAgent={handleEditAgentClick}
        onAgentSelect={handleAgentSelect}
      />

      <AgentCreateModal
        isOpen={showCreateAgent}
        selectedSession={selectedSession}
        providers={availableProviders}
        agentName={newAgentName}
        selectedInstanceId={selectedInstanceId}
        selectedModelId={selectedModelId}
        loading={loading}
        onClose={handleCloseCreateAgent}
        onSubmit={handleCreateAgent}
        onAgentNameChange={handleAgentNameChange}
        onProviderChange={setSelectedInstanceId}
        onModelChange={setSelectedModelId}
      />

      <SessionEditModal
        isOpen={showEditConfig}
        currentProject={currentProject}
        selectedSession={selectedSession}
        onClose={handleCloseEditSession}
        onSuccess={reloadSessionDetails}
      />

      <AgentEditModal
        isOpen={showEditAgent}
        editingAgent={editingAgent}
        providers={availableProviders}
        loading={loading}
        onClose={handleCloseEditAgent}
        onSubmit={handleEditAgentSubmit}
        onAgentChange={setEditingAgent}
      />

      {/* Delete Confirmation Modal */}
      {sessionToDelete && (
        <AnimatedModal
          isOpen={showDeleteConfirm}
          onClose={handleCancelDelete}
          title="Delete Session"
        >
          <div className="space-y-4">
            <p className="text-base-content">
              Are you sure you want to delete the session <strong>{sessionToDelete.name}</strong>?
            </p>
            <p className="text-base-content/60 text-sm">
              This will permanently delete the session and all its conversations and agents. This
              action cannot be undone.
            </p>

            {deleteError && (
              <div className="alert alert-error">
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelDelete}
                className="btn btn-ghost"
                type="button"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDeleteSession()}
                className={`btn btn-error ${isDeleting ? 'loading' : ''}`}
                type="button"
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Session'}
              </button>
            </div>
          </div>
        </AnimatedModal>
      )}
    </div>
  );
}
