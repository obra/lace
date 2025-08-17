// ABOUTME: Provider for managing provider instances and catalog data
// ABOUTME: Centralizes all provider instance operations including CRUD, testing, and catalog management

'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { api } from '@/lib/api-client';

// Provider Instance Types
export interface ProviderInstance {
  id: string;
  displayName: string;
  catalogProviderId: string;
  hasCredentials: boolean;
  endpoint?: string;
  timeout?: number;
  status?: 'connected' | 'error' | 'untested';
  modelCount?: number;
  lastTested?: string;
}

export interface ProviderInstanceWithTestResult extends Omit<ProviderInstance, 'status'> {
  status: 'connected' | 'error' | 'untested' | 'testing';
  lastTested?: string;
}

export interface TestResult {
  status: 'connected' | 'error' | 'testing';
  lastTested?: string;
  message?: string;
}

// Catalog Types
export interface CatalogModel {
  id: string;
  name: string;
  cost_per_1m_in: number;
  cost_per_1m_out: number;
  cost_per_1m_in_cached?: number;
  cost_per_1m_out_cached?: number;
  context_window: number;
  default_max_tokens: number;
  can_reason?: boolean;
  has_reasoning_effort?: boolean;
  supports_attachments?: boolean;
}

export interface CatalogProvider {
  id: string;
  name: string;
  type: string;
  api_key?: string;
  api_endpoint?: string;
  default_large_model_id: string;
  default_small_model_id: string;
  models: CatalogModel[];
}

// Form Data Types
export interface InstanceFormData {
  displayName: string;
  endpoint: string;
  timeout: number;
  apiKey: string;
}

// Provider Context Interface
interface ProviderInstanceContextValue {
  // Instance Management State
  instances: ProviderInstance[];
  instancesLoading: boolean;
  instancesError: string | null;

  // Catalog State
  catalogProviders: CatalogProvider[];
  catalogLoading: boolean;
  catalogError: string | null;

  // Test Results State
  testResults: Record<string, TestResult>;

  // Modal State
  showAddModal: boolean;
  selectedCatalogProvider: CatalogProvider | null;

  // Instance Operations
  loadInstances: () => Promise<void>;
  createInstance: (catalogProviderId: string, formData: InstanceFormData) => Promise<void>;
  updateInstance: (instanceId: string, updateData: Partial<InstanceFormData>) => Promise<void>;
  deleteInstance: (instanceId: string) => Promise<void>;
  testInstance: (instanceId: string) => Promise<void>;

  // Catalog Operations
  loadCatalog: () => Promise<void>;

  // Modal Actions
  openAddModal: (preselectedProvider?: CatalogProvider) => void;
  closeAddModal: () => void;

  // Utility Methods
  getInstanceById: (instanceId: string) => ProviderInstance | undefined;
  getInstanceWithTestResult: (instanceId: string) => ProviderInstanceWithTestResult | undefined;
}

const ProviderInstanceContext = createContext<ProviderInstanceContextValue | null>(null);

interface ProviderInstanceProviderProps {
  children: React.ReactNode;
}

export function ProviderInstanceProvider({ children }: ProviderInstanceProviderProps) {
  // Instance Management State
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(true);
  const [instancesError, setInstancesError] = useState<string | null>(null);

  // Catalog State
  const [catalogProviders, setCatalogProviders] = useState<CatalogProvider[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Test Results State
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCatalogProvider, setSelectedCatalogProvider] = useState<CatalogProvider | null>(
    null
  );

  // Load instances from API
  const loadInstances = useCallback(async () => {
    try {
      setInstancesLoading(true);
      setInstancesError(null);

      const data = await api.get<{ instances: ProviderInstance[] }>('/api/provider/instances');

      setInstances(data.instances || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load instances';
      setInstancesError(errorMessage);
      console.error('Error loading instances:', errorMessage);
    } finally {
      setInstancesLoading(false);
    }
  }, []);

  // Load catalog providers from API
  const loadCatalog = useCallback(async () => {
    try {
      setCatalogLoading(true);
      setCatalogError(null);

      const data = await api.get<{ providers: CatalogProvider[] }>('/api/provider/catalog');

      setCatalogProviders(data.providers || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load catalog';
      setCatalogError(errorMessage);
      console.error('Error loading catalog:', errorMessage);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  // Create new provider instance
  const createInstance = useCallback(
    async (catalogProviderId: string, formData: InstanceFormData) => {
      try {
        // Generate instanceId from displayName and catalogProviderId
        const generateInstanceId = (displayName: string, providerId: string): string => {
          const baseName = `${displayName.toLowerCase()}-${providerId}`;
          const cleanName = baseName
            .replace(/[^a-z0-9\s]/g, '') // Remove special chars except spaces
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-') // Replace multiple hyphens with single
            .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

          // Add timestamp suffix to ensure uniqueness
          const timestamp = Date.now().toString().slice(-4);
          return `${cleanName}-${timestamp}`;
        };

        const instanceId = generateInstanceId(formData.displayName, catalogProviderId);

        const requestBody = {
          instanceId,
          catalogProviderId,
          displayName: formData.displayName,
          endpoint: formData.endpoint || undefined, // Don't send empty string
          timeout: formData.timeout,
          credential: {
            apiKey: formData.apiKey,
          },
        };

        await api.post('/api/provider/instances', requestBody);

        // Reload instances to get the updated list
        await loadInstances();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create instance';
        console.error('Error creating instance:', errorMessage);
        throw err; // Re-throw so the modal can handle the error
      }
    },
    [loadInstances]
  );

  // Update provider instance
  const updateInstance = useCallback(
    async (instanceId: string, updateData: Partial<InstanceFormData>) => {
      try {
        const payload: Record<string, unknown> = {
          displayName: updateData.displayName,
          endpoint: updateData.endpoint || undefined,
          timeout: updateData.timeout,
        };

        // Only include credential if API key was provided
        if (updateData.apiKey && updateData.apiKey.trim()) {
          payload.credential = { apiKey: updateData.apiKey };
        }

        await api.put(`/api/provider/instances/${instanceId}`, payload);

        // Reload instances to get the updated data
        await loadInstances();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to update instance';
        console.error('Error updating instance:', errorMessage);
        throw err; // Re-throw so the modal can handle the error
      }
    },
    [loadInstances]
  );

  // Delete provider instance
  const deleteInstance = useCallback(
    async (instanceId: string) => {
      try {
        await api.delete(`/api/provider/instances/${instanceId}`);

        // Optimistically remove from local state and reload to ensure consistency
        setInstances((prev) => prev.filter((instance) => instance.id !== instanceId));

        // Also clean up test results
        setTestResults((prev) => {
          const { [instanceId]: removed, ...rest } = prev;
          return rest;
        });

        // Reload to ensure server state is in sync
        await loadInstances();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to delete instance';
        setInstancesError(errorMessage);
        console.error('Error deleting instance:', errorMessage);
        // Reload instances to restore consistent state after failure
        await loadInstances();
        throw err;
      }
    },
    [loadInstances]
  );

  // Test provider instance connection
  const testInstance = useCallback(async (instanceId: string) => {
    // Set testing state immediately for UI feedback
    setTestResults((prev) => ({
      ...prev,
      [instanceId]: { status: 'testing' },
    }));

    try {
      const result = await api.post<{
        success: boolean;
        status: 'connected' | 'error';
        message?: string;
        testedAt: string;
      }>(`/api/provider/instances/${instanceId}/test`);

      // Update test results with API response
      setTestResults((prev) => ({
        ...prev,
        [instanceId]: {
          status: result.status,
          lastTested: result.testedAt,
          message: result.message,
        },
      }));
    } catch (error) {
      // Update test results with error state
      setTestResults((prev) => ({
        ...prev,
        [instanceId]: {
          status: 'error',
          lastTested: new Date().toISOString(),
          message: error instanceof Error ? error.message : 'Test failed',
        },
      }));
    }
  }, []);

  // Modal actions
  const openAddModal = useCallback((preselectedProvider?: CatalogProvider) => {
    setSelectedCatalogProvider(preselectedProvider || null);
    setShowAddModal(true);
  }, []);

  const closeAddModal = useCallback(() => {
    setShowAddModal(false);
    setSelectedCatalogProvider(null);
  }, []);

  // Utility methods
  const getInstanceById = useCallback(
    (instanceId: string) => {
      return instances.find((instance) => instance.id === instanceId);
    },
    [instances]
  );

  const getInstanceWithTestResult = useCallback(
    (instanceId: string): ProviderInstanceWithTestResult | undefined => {
      const instance = getInstanceById(instanceId);
      if (!instance) return undefined;

      const testResult = testResults[instanceId];
      return {
        ...instance,
        status: testResult?.status || 'untested',
        lastTested: testResult?.lastTested,
      };
    },
    [testResults, getInstanceById]
  );

  // Load instances on mount only - dependency on loadInstances would cause infinite re-render loop
  // since loadInstances is recreated on every render despite useCallback
  useEffect(() => {
    void loadInstances();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Context value
  const contextValue = useMemo<ProviderInstanceContextValue>(
    () => ({
      // Instance Management State
      instances,
      instancesLoading,
      instancesError,

      // Catalog State
      catalogProviders,
      catalogLoading,
      catalogError,

      // Test Results State
      testResults,

      // Modal State
      showAddModal,
      selectedCatalogProvider,

      // Instance Operations
      loadInstances,
      createInstance,
      updateInstance,
      deleteInstance,
      testInstance,

      // Catalog Operations
      loadCatalog,

      // Modal Actions
      openAddModal,
      closeAddModal,

      // Utility Methods
      getInstanceById,
      getInstanceWithTestResult,
    }),
    [
      instances,
      instancesLoading,
      instancesError,
      catalogProviders,
      catalogLoading,
      catalogError,
      testResults,
      showAddModal,
      selectedCatalogProvider,
      loadInstances,
      createInstance,
      updateInstance,
      deleteInstance,
      testInstance,
      loadCatalog,
      openAddModal,
      closeAddModal,
      getInstanceById,
      getInstanceWithTestResult,
    ]
  );

  return (
    <ProviderInstanceContext.Provider value={contextValue}>
      {children}
    </ProviderInstanceContext.Provider>
  );
}

// Custom hook to use the provider instance context
export function useProviderInstances(): ProviderInstanceContextValue {
  const context = useContext(ProviderInstanceContext);
  if (!context) {
    throw new Error('useProviderInstances must be used within a ProviderInstanceProvider');
  }
  return context;
}
