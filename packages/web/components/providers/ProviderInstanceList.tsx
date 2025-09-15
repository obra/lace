// ABOUTME: List of configured provider instances with status indicators
// ABOUTME: Shows connection status, available models, and management actions

'use client';

import React, { useState, useEffect } from 'react';
import { ProviderInstanceCard } from './ProviderInstanceCard';
import { AddInstanceModal } from './AddInstanceModal';
import { Alert } from '@/components/ui/Alert';
import { SuccessToast } from '@/components/ui/SuccessToast';
import { ErrorToast } from '@/components/errors/ErrorToast';
import { GlobalModelSearch, type GlobalModelFilters } from './GlobalModelSearch';
import { useProviderInstances } from './ProviderInstanceProvider';
import { providerService } from '@/lib/server/provider-service';
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

  // Toast state
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // Global search/filter state
  const [globalFilters, setGlobalFilters] = useState<GlobalModelFilters>({
    searchQuery: '',
    requiredParameters: [],
    minContextLength: undefined,
    maxPromptCostPerMillion: undefined,
  });

  // Fetch catalog data on mount
  useEffect(() => {
    fetchCatalogs();
  }, []);

  const fetchCatalogs = async () => {
    try {
      const data = await providerService.getCatalog();
      setCatalogs((data.providers as CatalogProvider[]) || []);
    } catch (error) {
      console.error('Failed to fetch catalogs:', error);
    }
  };

  // Match instances with their catalog data
  const instancesWithCatalog = instances.map((instance) => ({
    instance,
    catalog: catalogs.find((c) => c.id === instance.catalogProviderId),
  }));

  // Calculate total model counts for display
  const { totalModels, totalResults } = React.useMemo(() => {
    let total = 0;
    let results = 0;

    for (const { catalog } of instancesWithCatalog) {
      if (!catalog?.models) continue;

      total += catalog.models.length;

      // Count models that match current filters
      const filtered = catalog.models.filter((model) => {
        // Apply search filter
        if (globalFilters.searchQuery) {
          const searchLower = globalFilters.searchQuery.toLowerCase();
          const matchesSearch =
            model.id.toLowerCase().includes(searchLower) ||
            model.name.toLowerCase().includes(searchLower);
          if (!matchesSearch) return false;
        }

        // Apply capability filters
        if (globalFilters.requiredParameters.length > 0) {
          const modelParams =
            (model as CatalogProvider['models'][0] & { supported_parameters?: string[] })
              .supported_parameters ?? [];
          const hasTools =
            (modelParams as string[]).includes('tools') ||
            (modelParams as string[]).includes('function_calling');
          const hasVision =
            model.supports_attachments === true || (modelParams as string[]).includes('vision');
          const hasReasoning =
            model.can_reason === true || (modelParams as string[]).includes('reasoning');

          const capabilities: string[] = [];
          if (hasTools) capabilities.push('tools');
          if (hasVision) capabilities.push('vision');
          if (hasReasoning) capabilities.push('reasoning');

          const hasRequired = globalFilters.requiredParameters.every((param) =>
            capabilities.includes(param)
          );
          if (!hasRequired) return false;
        }

        // Apply context filter
        if (globalFilters.minContextLength !== undefined) {
          if (model.context_window < globalFilters.minContextLength) {
            return false;
          }
        }

        // Apply price filter
        if (globalFilters.maxPromptCostPerMillion !== undefined) {
          if (globalFilters.maxPromptCostPerMillion === 0) {
            if (model.cost_per_1m_in !== 0 || model.cost_per_1m_out !== 0) {
              return false;
            }
          } else {
            if (model.cost_per_1m_in > globalFilters.maxPromptCostPerMillion) {
              return false;
            }
          }
        }

        return true;
      });

      results += filtered.length;
    }

    return { totalModels: total, totalResults: results };
  }, [instancesWithCatalog, globalFilters]);

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
      const result = await providerService.refreshCatalog(instanceId);
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

            {/* Global Model Search and Filter */}
            {totalModels > 0 && (
              <GlobalModelSearch
                filters={globalFilters}
                onChange={setGlobalFilters}
                resultCount={totalResults}
                totalCount={totalModels}
              />
            )}

            {instancesWithCatalog.map(({ instance, catalog }) => {
              const instanceWithTestResult = getInstanceWithTestResult(instance.id);
              if (!instanceWithTestResult) return null;

              // Check if this provider has any matching models (for visibility)
              const hasMatchingModels = catalog?.models
                ? catalog.models.some((model) => {
                    // Apply the same filter logic here to determine visibility
                    if (globalFilters.searchQuery) {
                      const searchLower = globalFilters.searchQuery.toLowerCase();
                      const matchesSearch =
                        model.id.toLowerCase().includes(searchLower) ||
                        model.name.toLowerCase().includes(searchLower);
                      if (!matchesSearch) return false;
                    }

                    if (globalFilters.requiredParameters.length > 0) {
                      const hasTools = model.supports_attachments !== undefined;
                      const hasVision = model.supports_attachments === true;
                      const hasReasoning = model.can_reason === true;

                      const capabilities: string[] = [];
                      if (hasTools) capabilities.push('tools');
                      if (hasVision) capabilities.push('vision');
                      if (hasReasoning) capabilities.push('reasoning');

                      const hasRequired = globalFilters.requiredParameters.every((param) =>
                        capabilities.includes(param)
                      );
                      if (!hasRequired) return false;
                    }

                    if (globalFilters.minContextLength !== undefined) {
                      if (model.context_window < globalFilters.minContextLength) {
                        return false;
                      }
                    }

                    if (globalFilters.maxPromptCostPerMillion !== undefined) {
                      if (globalFilters.maxPromptCostPerMillion === 0) {
                        if (model.cost_per_1m_in !== 0 || model.cost_per_1m_out !== 0) {
                          return false;
                        }
                      } else {
                        if (model.cost_per_1m_in > globalFilters.maxPromptCostPerMillion) {
                          return false;
                        }
                      }
                    }

                    return true;
                  })
                : true;

              // Keep all provider cards visible regardless of matching models

              return (
                <ProviderInstanceCard
                  key={instance.id}
                  instance={instanceWithTestResult}
                  provider={catalog}
                  globalFilters={globalFilters}
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
