// ABOUTME: Provider for managing provider instances and catalog data
// ABOUTME: Centralizes all provider instance operations including CRUD, testing, and catalog management

'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { api } from '@/lib/api-client';
import type { ProviderInfo, ModelInfo } from '@/types/api';

// Provider Instance Types
interface ProviderInstance {
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

interface ProviderInstanceWithTestResult extends Omit<ProviderInstance, 'status'> {
  status: 'connected' | 'error' | 'untested' | 'testing';
  lastTested?: string;
}

interface TestResult {
  status: 'connected' | 'error' | 'testing';
  lastTested?: string;
  message?: string;
}

// Catalog Types
interface CatalogModel {
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
interface InstanceFormData {
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

  // Computed Properties
  availableProviders: ProviderInfo[];

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
          const baseName = `${displayName.toLowerCase()}-${providerId.toLowerCase()}`;
          const cleanName = baseName
            .replace(/[^a-z0-9\s-]/g, '') // keep hyphens
            .replace(/\s+/g, '-') // spaces -> hyphens
            .replace(/-+/g, '-') // collapse hyphens
            .replace(/^-|-$/g, ''); // trim hyphens

          // Ensure uniqueness by checking existing instances
          let candidate = cleanName;
          let counter = 1;

          while (instances.some((instance) => instance.id === candidate)) {
            candidate = `${cleanName}-${counter}`;
            counter++;
          }

          return candidate;
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

        // Reload both instances and catalog to ensure data consistency
        await Promise.all([loadInstances(), loadCatalog()]);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create instance';
        console.error('Error creating instance:', errorMessage);
        throw err; // Re-throw so the modal can handle the error
      }
    },
    [loadInstances, loadCatalog, instances]
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

        // Reload both instances and catalog to ensure data consistency
        await Promise.all([loadInstances(), loadCatalog()]);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to update instance';
        console.error('Error updating instance:', errorMessage);
        throw err; // Re-throw so the modal can handle the error
      }
    },
    [loadInstances, loadCatalog]
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
        await Promise.all([loadInstances(), loadCatalog()]);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to delete instance';
        setInstancesError(errorMessage);
        console.error('Error deleting instance:', errorMessage);
        // Reload instances to restore consistent state after failure
        await Promise.all([loadInstances(), loadCatalog()]);
        throw err;
      }
    },
    [loadInstances, loadCatalog]
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

  // Computed availableProviders - transforms instances + catalog into ProviderInfo format
  const availableProviders = useMemo((): ProviderInfo[] => {
    return instances.map((instance) => {
      const catalogProvider = catalogProviders.find(
        (catalog) => catalog.id === instance.catalogProviderId
      );

      if (!catalogProvider) {
        // This shouldn't happen in normal operation, but handle gracefully
        return {
          id: instance.catalogProviderId,
          name: instance.displayName,
          displayName: instance.displayName,
          type: 'unknown',
          requiresApiKey: true,
          models: [],
          configured: true,
          instanceId: instance.id,
        };
      }

      // Transform catalog models to ModelInfo format
      const models: ModelInfo[] = catalogProvider.models.map((catalogModel) => ({
        id: catalogModel.id,
        displayName: catalogModel.name,
        description: undefined, // Not available in catalog format
        contextWindow: catalogModel.context_window,
        maxOutputTokens: catalogModel.default_max_tokens,
        capabilities: catalogModel.supports_attachments ? ['attachments'] : undefined,
        isDefault: false, // Would need to check against catalog provider defaults
      }));

      return {
        id: catalogProvider.id,
        name: catalogProvider.name,
        displayName: instance.displayName, // Use instance display name, not catalog name
        type: catalogProvider.type,
        requiresApiKey: catalogProvider.type !== 'local',
        models,
        configured: true, // All instances are configured by definition
        instanceId: instance.id,
      };
    });
  }, [instances, catalogProviders]);

  // Load instances and catalog on mount
  useEffect(() => {
    void loadInstances();
    void loadCatalog();
  }, [loadInstances, loadCatalog]);

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

      // Computed Properties
      availableProviders,

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
      availableProviders,
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
