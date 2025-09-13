// ABOUTME: List of configured provider instances with status indicators
// ABOUTME: Shows connection status, available models, and management actions

'use client';

import React, { useState, useEffect } from 'react';
import { ProviderInstanceCard } from './ProviderInstanceCard';
import { AddInstanceModal } from './AddInstanceModal';
import { Alert } from '@/components/ui/Alert';
import { SuccessToast } from '@/components/ui/SuccessToast';
import { ErrorToast } from '@/components/errors/ErrorToast';
import { useProviderInstances } from './ProviderInstanceProvider';
import { api } from '@/lib/api-client';
import type { CatalogProvider } from '@/lib/server/lace-imports';

export function ProviderInstanceList() {
  const {
    instances,
    instancesLoading: loading,
    instancesError: error,
    showAddModal,
    testInstance,
    deleteInstance,
    loadInstances,
    openAddModal,
    closeAddModal,
    getInstanceWithTestResult,
  } = useProviderInstances();

  // Catalog data for model management
  const [catalogs, setCatalogs] = useState<CatalogProvider[]>([]);
  const [catalogsLoading, setCatalogsLoading] = useState(false);

  // Toast state
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // Fetch catalog data on mount
  useEffect(() => {
    fetchCatalogs();
  }, []);

  const fetchCatalogs = async () => {
    setCatalogsLoading(true);
    try {
      const data = await api.providers.getCatalog();
      setCatalogs((data.providers as CatalogProvider[]) || []);
    } catch (error) {
      console.error('Failed to fetch catalogs:', error);
    } finally {
      setCatalogsLoading(false);
    }
  };

  // Match instances with their catalog data
  const instancesWithCatalog = instances.map((instance) => ({
    instance,
    catalog: catalogs.find((c) => c.id === instance.catalogProviderId),
  }));

  const handleTest = (instanceId: string) => {
    void testInstance(instanceId);
  };

  const handleDelete = async (instanceId: string) => {
    try {
      await deleteInstance(instanceId);
    } catch (err) {
      // Error handling is already done in the provider
      console.error('Failed to delete instance:', err);
    }
  };

  const handleRefresh = async (instanceId: string) => {
    try {
      const result = await api.providers.refreshCatalog(instanceId);
      // Refresh the catalogs to get updated model data
      await fetchCatalogs();
      setSuccessToast(`Refreshed ${result.modelCount} models`);
    } catch (error) {
      console.error('Failed to refresh catalog:', error);
      setErrorToast('Failed to refresh catalog');
      throw error;
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card bg-base-100 shadow-sm">
            <div className="card-body py-4">
              <div className="flex items-center space-x-3">
                <div className="w-3 h-3 bg-base-300 rounded-full animate-pulse"></div>
                <div className="flex-1">
                  <div className="h-4 bg-base-300 rounded animate-pulse mb-2"></div>
                  <div className="h-3 bg-base-300 rounded animate-pulse w-2/3"></div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="error" title="Error" description={error}>
        <button className="btn btn-sm btn-ghost" onClick={() => void loadInstances()}>
          Retry
        </button>
      </Alert>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {instances.length === 0 ? (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <div className="mb-4">
                <div className="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg
                    className="w-8 h-8 text-base-content/40"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-medium mb-2">No Provider Instances</h3>
                <p className="text-base-content/60 mb-6">
                  Configure your first AI provider to start using Lace. You can connect to OpenAI,
                  Anthropic, local models, and more.
                </p>
              </div>
              <button
                className="btn btn-primary vapor-button"
                onClick={() => openAddModal()}
                data-testid="add-first-instance-button"
              >
                Add Your First Instance
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm text-base-content/60">
                {instances.length} instance{instances.length !== 1 ? 's' : ''} configured
              </span>
              <button
                className="btn btn-primary vapor-button btn-sm"
                onClick={() => openAddModal()}
                data-testid="add-instance-button"
              >
                Add Instance
              </button>
            </div>

            {instancesWithCatalog.map(({ instance, catalog }) => {
              const instanceWithTestResult = getInstanceWithTestResult(instance.id);
              if (!instanceWithTestResult) return null;

              return (
                <ProviderInstanceCard
                  key={instance.id}
                  instance={instanceWithTestResult}
                  provider={catalog}
                  onTest={(instanceId) => handleTest(instanceId)}
                  onDelete={(instanceId) => void handleDelete(instanceId)}
                  onEdit={() => void loadInstances()} // Refresh list after edit
                  onRefresh={handleRefresh}
                />
              );
            })}
          </>
        )}
      </div>

      <AddInstanceModal
        isOpen={showAddModal}
        onClose={closeAddModal}
        onSuccess={() => void loadInstances()}
      />

      {/* Toast Notifications */}
      {successToast && (
        <SuccessToast message={successToast} onDismiss={() => setSuccessToast(null)} />
      )}
      {errorToast && (
        <ErrorToast
          errorType="provider_failure"
          message={errorToast}
          onDismiss={() => setErrorToast(null)}
        />
      )}
    </>
  );
}
