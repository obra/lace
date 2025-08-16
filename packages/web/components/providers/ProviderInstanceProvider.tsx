// ABOUTME: Provider for managing provider instances and catalog data
// ABOUTME: Centralizes all provider instance operations including CRUD, testing, and catalog management

'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { parseResponse } from '@/lib/serialization';
import { isApiError } from '@/types/api';

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

      const response = await fetch('/api/provider/instances');
      if (!response.ok) {
        throw new Error(`Failed to load instances: ${response.status}`);
      }

      const data = await parseResponse<{ instances: ProviderInstance[] }>(response);
      if (isApiError(data)) {
        throw new Error(data.error);
      }

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

      const response = await fetch('/api/provider/catalog');
      if (!response.ok) {
        throw new Error(`Failed to load catalog: ${response.status}`);
      }

      const data = await parseResponse<{ providers: CatalogProvider[] }>(response);
      if (isApiError(data)) {
        throw new Error(data.error);
      }

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
        const response = await fetch('/api/provider/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalogProviderId,
            ...formData,
          }),
        });

        if (!response.ok) {
          const errorData = await parseResponse<unknown>(response);
          if (isApiError(errorData)) {
            throw new Error(errorData.error);
          }
          throw new Error(`Failed to create instance: ${response.status}`);
        }

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

  // Delete provider instance
  const deleteInstance = useCallback(
    async (instanceId: string) => {
      try {
        const response = await fetch(`/api/provider/instances/${instanceId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const errorData = await parseResponse<unknown>(response);
          if (isApiError(errorData)) {
            throw new Error(errorData.error);
          }
          throw new Error(`Failed to delete instance: ${response.status}`);
        }

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
      const response = await fetch(`/api/provider/instances/${instanceId}/test`, {
        method: 'POST',
      });

      const result = await parseResponse<{
        success: boolean;
        status: 'connected' | 'error';
        message?: string;
        testedAt: string;
      }>(response);

      if (isApiError(result)) {
        throw new Error(result.error);
      }

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
    [instances, testResults, getInstanceById]
  );

  // Load instances on mount
  useEffect(() => {
    void loadInstances();
  }, [loadInstances]);

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
