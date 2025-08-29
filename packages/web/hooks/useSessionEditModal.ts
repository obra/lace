// ABOUTME: Hook for managing session edit modal state and operations
// ABOUTME: Encapsulates all session editing logic to eliminate duplication across components

import { useState, useCallback } from 'react';
import type { SessionInfo } from '@/types/core';
import type { SessionConfiguration } from '@/types/api';
import { useSessionContext } from '@/components/providers/SessionProvider';

export interface UseSessionEditModalReturn {
  // Modal state
  isOpen: boolean;
  loading: boolean;

  // Form data
  sessionName: string;
  sessionDescription: string;
  sessionConfig: SessionConfiguration;

  // Actions
  openModal: (session: SessionInfo) => Promise<void>;
  closeModal: () => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  handleSessionNameChange: (name: string) => void;
  handleSessionDescriptionChange: (description: string) => void;
  handleSessionConfigChange: (
    config: SessionConfiguration | ((prev: SessionConfiguration) => SessionConfiguration)
  ) => void;
  updateProviderInstanceId: (instanceId: string) => void;
  updateModelId: (modelId: string) => void;
}

export interface UseSessionEditModalProps {
  onSuccess?: () => Promise<void>;
}

const DEFAULT_CONFIG: SessionConfiguration = {
  maxTokens: 4096,
  tools: [],
  toolPolicies: {},
  environmentVariables: {},
};

export function useSessionEditModal({
  onSuccess,
}: UseSessionEditModalProps = {}): UseSessionEditModalReturn {
  const { loadSessionConfiguration, updateSessionConfiguration, updateSession } =
    useSessionContext();

  // Modal state
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(null);

  // Form state
  const [sessionName, setSessionName] = useState('');
  const [sessionDescription, setSessionDescription] = useState('');
  const [sessionConfig, setSessionConfig] = useState<SessionConfiguration>(DEFAULT_CONFIG);

  const openModal = useCallback(
    async (session: SessionInfo) => {
      setCurrentSession(session);
      setSessionName(session.name);
      setSessionDescription(session.description || '');

      try {
        setLoading(true);
        const config = await loadSessionConfiguration(session.id);
        setSessionConfig(config as SessionConfiguration);
      } catch (error) {
        console.error('Failed to load session configuration:', error);
        setSessionConfig(DEFAULT_CONFIG);
      } finally {
        setLoading(false);
        setIsOpen(true);
      }
    },
    [loadSessionConfiguration]
  );

  const closeModal = useCallback(() => {
    setIsOpen(false);
    setCurrentSession(null);
    setSessionName('');
    setSessionDescription('');
    setSessionConfig(DEFAULT_CONFIG);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!currentSession || !sessionName.trim() || loading) return;

      try {
        setLoading(true);

        // Update session configuration
        await updateSessionConfiguration(currentSession.id, sessionConfig);

        // Update session name/description if changed
        const nameChanged = sessionName.trim() !== currentSession.name;
        const descriptionChanged =
          (sessionDescription.trim() || undefined) !== currentSession.description;

        if (nameChanged || descriptionChanged) {
          await updateSession(currentSession.id, {
            name: sessionName.trim(),
            description: sessionDescription.trim() || undefined,
          });
        }

        // Close modal and notify success
        closeModal();
        await onSuccess?.();
      } catch (error) {
        console.error('Failed to update session:', error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [
      currentSession,
      sessionName,
      sessionDescription,
      sessionConfig,
      updateSessionConfiguration,
      updateSession,
      loading,
      closeModal,
      onSuccess,
    ]
  );

  const handleSessionNameChange = useCallback((name: string) => {
    setSessionName(name);
  }, []);

  const handleSessionDescriptionChange = useCallback((description: string) => {
    setSessionDescription(description);
  }, []);

  const handleSessionConfigChange = useCallback(
    (config: SessionConfiguration | ((prev: SessionConfiguration) => SessionConfiguration)) => {
      if (typeof config === 'function') {
        setSessionConfig(config);
      } else {
        setSessionConfig(config);
      }
    },
    []
  );

  const updateProviderInstanceId = useCallback((instanceId: string) => {
    setSessionConfig((prev) => ({ ...prev, providerInstanceId: instanceId }));
  }, []);

  const updateModelId = useCallback((modelId: string) => {
    setSessionConfig((prev) => ({ ...prev, modelId }));
  }, []);

  return {
    // Modal state
    isOpen,
    loading,

    // Form data
    sessionName,
    sessionDescription,
    sessionConfig,

    // Actions
    openModal,
    closeModal,
    handleSubmit,
    handleSessionNameChange,
    handleSessionDescriptionChange,
    handleSessionConfigChange,
    updateProviderInstanceId,
    updateModelId,
  };
}
