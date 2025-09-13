// ABOUTME: Individual instance card with status, actions, and details
// ABOUTME: Uses StatusDot, Badge, and card components from design system

import { useState, useEffect, useMemo } from 'react';
import StatusDot from '@/components/ui/StatusDot';
import Badge from '@/components/ui/Badge';
import { EditInstanceModal } from './EditInstanceModal';
import { ModelFilterBar } from './ModelFilterBar';
import { ProviderModelGroup } from './ProviderModelGroup';
import { api } from '@/lib/api-client';
import type { CatalogProvider, CatalogModel, ModelConfig } from '@/lib/server/lace-imports';

interface ProviderInstanceCardProps {
  instance: {
    id: string;
    displayName: string;
    catalogProviderId: string;
    hasCredentials: boolean;
    endpoint?: string;
    timeout?: number;
    status?: 'connected' | 'error' | 'untested' | 'testing';
    modelCount?: number;
    lastTested?: string;
  };
  provider?: CatalogProvider; // Optional provider catalog data for model management
  onTest: () => void;
  onDelete: () => void;
  onEdit?: () => void; // Optional callback after edit success
  onRefresh?: (instanceId: string) => void;
}

export function ProviderInstanceCard({
  instance,
  provider,
  onTest,
  onDelete,
  onEdit,
  onRefresh,
}: ProviderInstanceCardProps) {
  const [showEditModal, setShowEditModal] = useState(false);

  // Model management state for multi-model providers
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    enableNewModels: true,
    disabledModels: [],
    disabledProviders: [],
    filters: {},
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const getStatusProps = (status?: string) => {
    switch (status) {
      case 'connected':
        return { status: 'success' as const, text: 'Connected' };
      case 'error':
        return { status: 'error' as const, text: 'Connection Error' };
      case 'testing':
        return { status: 'info' as const, text: 'Testing...' };
      default:
        return {
          status: 'warning' as const,
          text: instance.hasCredentials ? 'Untested' : 'No Credentials',
        };
    }
  };

  const statusProps = getStatusProps(instance.status);

  const handleDeleteClick = () => {
    if (
      confirm(
        `Are you sure you want to delete "${instance.displayName}"? This will remove the instance and its credentials.`
      )
    ) {
      onDelete();
    }
  };

  const handleEditSuccess = () => {
    setShowEditModal(false);
    onEdit?.(); // Call parent callback to refresh data
  };

  // Check if this provider should show model management (1+ models)
  const showModelManagement = provider && provider.models.length >= 1;

  // Group ALL models by provider (not just filtered ones)
  const modelsByProvider = useMemo(() => {
    if (!showModelManagement) return new Map();

    const groups = new Map<string, typeof provider.models>();
    provider.models.forEach((model) => {
      // For router providers like OpenRouter, extract from model ID
      // For single providers like Anthropic, use the provider name
      const providerName = model.id.includes('/')
        ? model.id.split('/')[0]
        : provider.name.toLowerCase();

      const group = groups.get(providerName) || [];
      group.push(model);
      groups.set(providerName, group);
    });
    return groups;
  }, [provider, showModelManagement]);

  // Filter groups for display based on search and filters
  const filteredModelsByProvider = useMemo(() => {
    if (!showModelManagement) return new Map();

    const filtered = new Map();
    for (const [providerName, models] of modelsByProvider.entries()) {
      const filteredModels = models.filter((model: CatalogModel) => {
        // Apply search filter
        if (searchQuery) {
          const searchLower = searchQuery.toLowerCase();
          if (
            !model.id.toLowerCase().includes(searchLower) &&
            !model.name.toLowerCase().includes(searchLower)
          ) {
            return false;
          }
        }

        // Apply capability filters
        if (modelConfig.filters?.requiredParameters?.length) {
          const hasTools = model.supports_attachments !== undefined;
          const hasVision = model.supports_attachments === true;
          const hasReasoning = model.can_reason === true;

          const capabilities: string[] = [];
          if (hasTools) capabilities.push('tools');
          if (hasVision) capabilities.push('vision');
          if (hasReasoning) capabilities.push('reasoning');

          const hasRequired = modelConfig.filters.requiredParameters!.every((param: string) =>
            capabilities.includes(param)
          );
          if (!hasRequired) return false;
        }

        // Apply context filter
        if (modelConfig.filters?.minContextLength) {
          if (model.context_window < modelConfig.filters.minContextLength) {
            return false;
          }
        }

        // Apply cost filters
        if (modelConfig.filters?.maxPromptCostPerMillion !== undefined) {
          if (modelConfig.filters.maxPromptCostPerMillion === 0) {
            // Free only filter - both input and output must be free
            if (model.cost_per_1m_in !== 0 || model.cost_per_1m_out !== 0) {
              return false;
            }
          } else {
            // Max cost filter
            if (model.cost_per_1m_in > modelConfig.filters.maxPromptCostPerMillion) {
              return false;
            }
          }
        }

        if (modelConfig.filters?.maxCompletionCostPerMillion !== undefined) {
          if (modelConfig.filters.maxCompletionCostPerMillion === 0) {
            // Free only filter for completion
            if (model.cost_per_1m_out !== 0) {
              return false;
            }
          } else {
            if (model.cost_per_1m_out > modelConfig.filters.maxCompletionCostPerMillion) {
              return false;
            }
          }
        }

        return true;
      });

      if (filteredModels.length > 0) {
        filtered.set(providerName, filteredModels);
      }
    }
    return filtered;
  }, [modelsByProvider, searchQuery, modelConfig, showModelManagement]);

  // Toggle handlers for model management
  const handleToggleProvider = (providerName: string, enabled: boolean) => {
    setModelConfig((prev) => {
      const updated = { ...prev };
      const providerModels = Array.from(modelsByProvider.get(providerName) || []);
      const providerModelIds = providerModels.map((m: unknown) => (m as { id: string }).id);

      if (enabled) {
        // Remove provider from disabled list
        updated.disabledProviders = prev.disabledProviders.filter((p) => p !== providerName);
        // Remove all models from this provider from disabled list
        updated.disabledModels = prev.disabledModels.filter((m) => !providerModelIds.includes(m));
      } else {
        // Add provider to disabled list
        updated.disabledProviders = [...prev.disabledProviders, providerName];
        // Add all models from this provider to disabled list
        const newDisabledModels = providerModelIds.filter(
          (id) => !prev.disabledModels.includes(id)
        );
        updated.disabledModels = [...prev.disabledModels, ...newDisabledModels];
      }
      return updated;
    });
  };

  const handleToggleModel = (modelId: string, enabled: boolean) => {
    setModelConfig((prev) => ({
      ...prev,
      disabledModels: enabled
        ? prev.disabledModels.filter((m) => m !== modelId)
        : [...prev.disabledModels, modelId],
    }));
  };

  const handleRefresh = async () => {
    if (!onRefresh) return;

    setIsRefreshing(true);
    try {
      await onRefresh(instance.id);
      // Parent will handle toast notification
    } catch (error) {
      console.error('Error refreshing catalog:', error);
      // Parent will handle error toast
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      await api.providers.updateModelConfig(instance.id, modelConfig);
      // Configuration saved successfully (no toast needed - auto-save)
    } catch (error) {
      console.error('Error saving configuration:', error);
      // Could add error feedback here if needed
    }
  };

  // Auto-save on config changes (debounced)
  useEffect(() => {
    // Skip if this is the initial render or no model management needed
    if (!showModelManagement) return;

    const timer = setTimeout(() => {
      if (instance.id) {
        void handleSaveConfig();
      }
    }, 1000); // 1 second debounce

    return () => clearTimeout(timer);
  }, [modelConfig, instance.id, showModelManagement]);

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <StatusDot status={statusProps.status} size="md" />
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-1">
                <h4 className="font-medium">{instance.displayName}</h4>
              </div>
              <div className="text-sm text-base-content/60 space-y-1">
                <div className="flex items-center space-x-4">
                  <span>{statusProps.text}</span>
                  {instance.modelCount !== undefined && (
                    <span>{instance.modelCount} models available</span>
                  )}
                  {!instance.hasCredentials && (
                    <Badge variant="error" size="xs">
                      Missing Credentials
                    </Badge>
                  )}
                </div>

                {instance.endpoint && (
                  <div className="text-xs text-base-content/40">
                    Custom endpoint: {instance.endpoint}
                  </div>
                )}

                {instance.lastTested && (
                  <div className="text-xs text-base-content/40">
                    Last tested: {new Date(instance.lastTested).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              className="btn btn-ghost btn-sm"
              onClick={onTest}
              disabled={!instance.hasCredentials || instance.status === 'testing'}
              title={
                !instance.hasCredentials ? 'Add credentials to test connection' : 'Test connection'
              }
            >
              {instance.status === 'testing' ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Testing
                </>
              ) : (
                'Test'
              )}
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setShowEditModal(true)}>
              Edit
            </button>
          </div>
        </div>

        {/* Model Management Section for multi-model providers */}
        {showModelManagement && (
          <div className="border-t border-base-300 mt-4 pt-4">
            <div className="mb-3">
              {/* Search Bar */}
              <div className="mb-3">
                <input
                  type="text"
                  placeholder="Search models..."
                  className="input input-bordered w-full"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Filter Bar */}
              <ModelFilterBar
                filters={{
                  requiredParameters: modelConfig.filters?.requiredParameters,
                  minContextLength: modelConfig.filters?.minContextLength,
                  maxPromptCostPerMillion: modelConfig.filters?.maxPromptCostPerMillion,
                  maxCompletionCostPerMillion: modelConfig.filters?.maxCompletionCostPerMillion,
                }}
                onChange={(filters) => {
                  setModelConfig((prev) => ({ ...prev, filters }));
                }}
              />

              {/* Status and Refresh */}
              <div className="flex justify-between items-center my-3">
                <span className="text-sm opacity-70">
                  {provider.models.length} models available
                </span>
                {/* Show refresh button only for OpenRouter (dynamic catalogs) */}
                {instance.catalogProviderId === 'openrouter' && (
                  <button
                    className="btn btn-circle btn-sm btn-primary"
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    title="Refresh catalog from OpenRouter API"
                  >
                    {isRefreshing ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                    )}
                  </button>
                )}
              </div>

              {/* Model Groups */}
              <div className="space-y-2">
                {Array.from(filteredModelsByProvider.entries()).map(([providerName, models]) => (
                  <ProviderModelGroup
                    key={providerName}
                    providerName={providerName}
                    models={models}
                    enabledModels={models
                      .filter(
                        (m: unknown) =>
                          !modelConfig.disabledModels.includes((m as { id: string }).id)
                      )
                      .map((m: unknown) => (m as { id: string }).id)}
                    onToggleProvider={handleToggleProvider}
                    onToggleModel={handleToggleModel}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <EditInstanceModal
        isOpen={showEditModal}
        instance={instance}
        onClose={() => setShowEditModal(false)}
        onSuccess={handleEditSuccess}
      />
    </div>
  );
}
