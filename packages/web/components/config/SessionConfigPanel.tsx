// ABOUTME: Comprehensive session configuration panel for main pane
// ABOUTME: Handles session creation/editing with full configuration options

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faCog, faRobot, faFolder, faInfoCircle, faTrash, faEdit } from '@/lib/fontawesome';
import { SessionHeader } from './SessionHeader';
import { SessionsList } from './SessionsList';
import { SessionCreateModal } from './SessionCreateModal';
import { SessionEditModal } from './SessionEditModal';
import { AgentCreateModal } from './AgentCreateModal';
import { AgentEditModal } from './AgentEditModal';
import type { ProviderInfo, ModelInfo, CreateAgentRequest } from '@/types/api';
import type { SessionInfo, ProjectInfo } from '@/types/core';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useAppState } from '@/components/providers/AppStateProvider';
import { useProviders } from '@/hooks/useProviders';

interface SessionConfiguration {
  providerInstanceId?: string;
  modelId?: string;
  maxTokens?: number;
  tools?: string[];
  toolPolicies?: Record<string, 'allow' | 'require-approval' | 'deny'>;
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  [key: string]: unknown;
}

interface SessionConfigPanelProps {
  // No props needed - all data comes from providers
}

const AVAILABLE_TOOLS = [
  'bash',
  'file_read',
  'file_write',
  'file_edit',
  'file_list',
  'file_find',
  'url_fetch',
  'ripgrep_search',
  'file_insert',
  'delegate',
  'task_add',
  'task_list',
  'task_complete',
  'task_update',
  'task_add_note',
  'task_view',
];

const DEFAULT_CONFIG: SessionConfiguration = {
  // Note: providerInstanceId and modelId should be set by user selection, not defaults
  maxTokens: 4096,
  tools: AVAILABLE_TOOLS,
  toolPolicies: {},
  environmentVariables: {},
};

export function SessionConfigPanel({}: SessionConfigPanelProps) {
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
  } = useSessionContext();
  const {
    sessionDetails: selectedSession,
    createAgent,
    reloadSessionDetails,
    loading: agentLoading,
    loadAgentConfiguration,
    updateAgent,
  } = useAgentContext();
  const {
    actions: { updateHashState },
  } = useAppState();
  const { providers, loading: providersLoading } = useProviders();

  const loading = sessionLoading || agentLoading || providersLoading;
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showEditConfig, setShowEditConfig] = useState(false);
  const [showEditAgent, setShowEditAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<{
    threadId: string;
    name: string;
    providerInstanceId: string;
    modelId: string;
  } | null>(null);

  // Session creation state
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionDescription, setNewSessionDescription] = useState('');
  const [sessionConfig, setSessionConfig] = useState<SessionConfiguration>(DEFAULT_CONFIG);

  // Agent creation state
  const [newAgentName, setNewAgentName] = useState('');
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  // Session edit state
  const [editSessionName, setEditSessionName] = useState('');
  const [editSessionDescription, setEditSessionDescription] = useState('');
  const [editSessionConfig, setEditSessionConfig] = useState<SessionConfiguration>(DEFAULT_CONFIG);

  // Get available providers (only those that are configured with instance IDs)
  const availableProviders = useMemo(() => {
    return providers.filter((p): p is ProviderInfo & { instanceId: string } =>
      Boolean(p.configured && p.instanceId)
    );
  }, [providers]);

  // Reset form when project or project configuration changes
  const projectId = currentProject.id;
  useEffect(() => {
    setShowCreateSession(false);
    setShowCreateAgent(false);
    setShowEditConfig(false);
    setShowEditAgent(false);
    setEditingAgent(null);
    resetSessionForm();
    resetAgentForm();
    resetEditSessionForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectConfig]);

  const resetSessionForm = useCallback(() => {
    setNewSessionName('');
    setNewSessionDescription('');
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
        defaultConfig.toolPolicies = projectConfig.toolPolicies as Record<
          string,
          'allow' | 'require-approval' | 'deny'
        >;
      }
    }
    setSessionConfig(defaultConfig);
  }, [projectConfig]);

  const resetAgentForm = () => {
    setNewAgentName('');
    setSelectedInstanceId('');
    setSelectedModelId('');
  };

  const resetEditSessionForm = () => {
    setEditSessionName('');
    setEditSessionDescription('');
    setEditSessionConfig(DEFAULT_CONFIG);
  };

  const handleProviderInstanceSelection = (instanceId: string, modelId: string) => {
    setSelectedInstanceId(instanceId);
    setSelectedModelId(modelId);
  };

  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;

    createSession({
      name: newSessionName.trim(),
      description: newSessionDescription.trim() || undefined,
      configuration: sessionConfig,
    });

    resetSessionForm();
    setShowCreateSession(false);
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
  const handleEditSessionClick = async () => {
    if (!selectedSession) return;

    try {
      // Load session configuration from provider
      const configuration = await loadSessionConfiguration(selectedSession.id);

      setEditSessionName(selectedSession.name);
      setEditSessionDescription(''); // Session descriptions not currently stored

      // Merge with defaults and ensure provider instance is set
      const config = {
        ...DEFAULT_CONFIG,
        ...configuration,
      };

      // If no provider instance configured, use first available
      if (!config.providerInstanceId && availableProviders.length > 0) {
        config.providerInstanceId = availableProviders[0].instanceId;
        config.modelId = availableProviders[0].models[0]?.id || '';
      }

      setEditSessionConfig(config);
      setShowEditConfig(true);
    } catch (error) {
      console.error('Error loading session configuration:', error);
      // Fallback to default configuration with first available provider
      const config = { ...DEFAULT_CONFIG };
      if (availableProviders.length > 0) {
        config.providerInstanceId = availableProviders[0].instanceId;
        config.modelId = availableProviders[0].models[0]?.id || '';
      }
      setEditSessionName(selectedSession.name);
      setEditSessionDescription('');
      setEditSessionConfig(config);
      setShowEditConfig(true);
    }
  };

  const handleEditSessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession || !editSessionName.trim()) return;

    try {
      // Update session configuration via provider
      await updateSessionConfiguration(selectedSession.id, editSessionConfig);

      // Update session name/description if changed via provider
      const nameChanged = editSessionName.trim() !== selectedSession.name;
      const descChanged = (editSessionDescription.trim() || undefined) !== undefined;

      if (nameChanged || descChanged) {
        await updateSession(selectedSession.id, {
          name: editSessionName.trim(),
          description: editSessionDescription.trim() || undefined,
        });
      }

      // Trigger local state update by reloading session details
      await reloadSessionDetails();

      setShowEditConfig(false);
      resetEditSessionForm();
    } catch (error) {
      console.error('Error updating session:', error);
    }
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
      updateHashState({ session: sessionId });
    },
    [updateHashState]
  );

  const handleCreateSessionClick = useCallback(() => {
    resetSessionForm(); // Reset with project defaults
    setShowCreateSession(true);
  }, [resetSessionForm]);

  const handleAgentSelect = useCallback(
    (agentId: string) => {
      updateHashState({ agent: agentId });
    },
    [updateHashState]
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
        });
        setShowEditAgent(true);
      } catch (error) {
        console.error('Failed to load agent for editing:', error);
      }
    },
    [loadAgentConfiguration]
  );

  // Session creation modal handlers
  const handleSessionNameChange = useCallback((name: string) => {
    setNewSessionName(name);
  }, []);

  const handleSessionDescriptionChange = useCallback((description: string) => {
    setNewSessionDescription(description);
  }, []);

  const handleSessionConfigChange = useCallback((config: SessionConfiguration) => {
    setSessionConfig(config);
  }, []);

  const handleCloseCreateSession = useCallback(() => {
    setShowCreateSession(false);
  }, []);

  // Session edit modal handlers
  const handleEditSessionNameChange = useCallback((name: string) => {
    setEditSessionName(name);
  }, []);

  const handleEditSessionDescriptionChange = useCallback((description: string) => {
    setEditSessionDescription(description);
  }, []);

  const handleEditSessionConfigChange = useCallback((config: SessionConfiguration) => {
    setEditSessionConfig(config);
  }, []);

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
    <div className="bg-base-100 rounded-lg border border-base-300 p-6">
      <SessionHeader project={currentProject} />

      <SessionsList
        sessions={sessions}
        selectedSession={selectedSession}
        loading={loading}
        onSessionSelect={handleSessionSelect}
        onEditSession={handleEditSessionClick}
        onCreateAgent={handleCreateAgentClick}
        onCreateSession={handleCreateSessionClick}
        onEditAgent={handleEditAgentClick}
        onAgentSelect={handleAgentSelect}
      />

      <SessionCreateModal
        isOpen={showCreateSession}
        currentProject={currentProject}
        providers={providers}
        sessionConfig={sessionConfig}
        sessionName={newSessionName}
        sessionDescription={newSessionDescription}
        loading={loading}
        onClose={handleCloseCreateSession}
        onSubmit={handleCreateSession}
        onSessionNameChange={handleSessionNameChange}
        onSessionDescriptionChange={handleSessionDescriptionChange}
        onSessionConfigChange={handleSessionConfigChange}
      />

      <AgentCreateModal
        isOpen={showCreateAgent}
        selectedSession={selectedSession}
        providers={providers}
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
        providers={providers}
        sessionConfig={editSessionConfig}
        sessionName={editSessionName}
        sessionDescription={editSessionDescription}
        loading={loading}
        onClose={handleCloseEditSession}
        onSubmit={handleEditSessionSubmit}
        onSessionNameChange={handleEditSessionNameChange}
        onSessionDescriptionChange={handleEditSessionDescriptionChange}
        onSessionConfigChange={handleEditSessionConfigChange}
      />

      <AgentEditModal
        isOpen={showEditAgent}
        editingAgent={editingAgent}
        providers={providers}
        loading={loading}
        onClose={handleCloseEditAgent}
        onSubmit={handleEditAgentSubmit}
        onAgentChange={setEditingAgent}
      />
    </div>
  );
}
