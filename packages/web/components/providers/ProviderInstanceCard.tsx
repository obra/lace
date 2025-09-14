// ABOUTME: Individual instance card with status, actions, and details
// ABOUTME: Uses StatusDot, Badge, and card components from design system

import { useState, useEffect, useMemo, useCallback } from 'react';
import StatusDot from '@/components/ui/StatusDot';
import Badge from '@/components/ui/Badge';
import { EditInstanceModal } from './EditInstanceModal';
import { ProviderModelGroup } from './ProviderModelGroup';
import { api } from '@/lib/api-client';
import type { CatalogProvider, CatalogModel, ModelConfig } from '@/lib/server/lace-imports';
import type { GlobalModelFilters } from './GlobalModelSearch';

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
  globalFilters?: GlobalModelFilters; // Global search/filter state
  onTest: (instanceId: string) => void;
  onDelete: (instanceId: string) => void;
  onEdit?: () => void; // Optional callback after edit success
  onRefresh?: (instanceId: string) => void;
}

export function ProviderInstanceCard({
  instance,
  provider,
  globalFilters,
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
        return instance.hasCredentials
          ? null // Don't show status if credentials exist but untested
          : { status: 'warning' as const, text: 'No Credentials' };
    }
  };

  const statusProps = getStatusProps(instance.status);

  const handleEditSuccess = () => {
    setShowEditModal(false);
    onEdit?.(); // Call parent callback to refresh data
  };

  // Check if this provider should show model management (1+ models)
  const showModelManagement = provider && provider.models.length >= 1;

  // Group ALL models by provider (not just filtered ones)
  const modelsByProvider = useMemo(() => {
    if (!showModelManagement) return new Map<string, CatalogModel[]>();

    const groups = new Map<string, CatalogModel[]>();
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

  // Filter groups for display based on global filters
  const filteredModelsByProvider = useMemo(() => {
    if (!showModelManagement || !globalFilters) return modelsByProvider;

    const filtered = new Map<string, CatalogModel[]>();
    for (const [providerName, models] of modelsByProvider.entries()) {
      const filteredModels = models.filter((model: CatalogModel) => {
        // Apply global search filter
        if (globalFilters.searchQuery) {
          const searchLower = globalFilters.searchQuery.toLowerCase();
          if (
            !model.id.toLowerCase().includes(searchLower) &&
            !model.name.toLowerCase().includes(searchLower)
          ) {
            return false;
          }
        }

        // Apply global capability filters
        if (globalFilters.requiredParameters.length > 0) {
          const modelParams =
            (model as CatalogModel & { supported_parameters?: string[] }).supported_parameters ??
            [];
          const hasTools =
            modelParams.includes('tools') || modelParams.includes('function_calling');
          const hasVision = model.supports_attachments === true || modelParams.includes('vision');
          const hasReasoning = model.can_reason === true || modelParams.includes('reasoning');

          const capabilities: string[] = [];
          if (hasTools) capabilities.push('tools');
          if (hasVision) capabilities.push('vision');
          if (hasReasoning) capabilities.push('reasoning');

          const hasRequired = globalFilters.requiredParameters.every((param: string) =>
            capabilities.includes(param)
          );
          if (!hasRequired) return false;
        }

        // Apply global context filter
        if (globalFilters.minContextLength !== undefined) {
          if (model.context_window < globalFilters.minContextLength) {
            return false;
          }
        }

        // Apply global price filter
        if (globalFilters.maxPromptCostPerMillion !== undefined) {
          if (globalFilters.maxPromptCostPerMillion === 0) {
            // Free only filter - both input and output must be free
            if (model.cost_per_1m_in !== 0 || model.cost_per_1m_out !== 0) {
              return false;
            }
          } else {
            // Max cost filter
            if (model.cost_per_1m_in > globalFilters.maxPromptCostPerMillion) {
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
  }, [modelsByProvider, globalFilters, showModelManagement]);

  // Toggle handlers for model management
  const handleToggleProvider = (providerName: string, enabled: boolean) => {
    setModelConfig((prev) => {
      const updated = { ...prev };
      const providerModels = modelsByProvider.get(providerName) || [];
      const providerModelIds = providerModels.map((m) => m.id);

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

  const handleSaveConfig = useCallback(async () => {
    try {
      await api.providers.updateModelConfig(instance.id, modelConfig);
      // Configuration saved successfully (no toast needed - auto-save)
    } catch (error) {
      console.error('Error saving configuration:', error);
      // Could add error feedback here if needed
    }
  }, [instance.id, modelConfig]);

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
  }, [modelConfig, instance.id, showModelManagement, handleSaveConfig]);

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {statusProps && <StatusDot status={statusProps.status} size="md" />}
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-1">
                <h4 className="font-medium">{instance.displayName}</h4>
              </div>
              <div className="text-sm text-base-content/60 space-y-1">
                <div className="flex items-center space-x-4">
                  {statusProps && <span>{statusProps.text}</span>}
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
            <button className="btn btn-outline btn-sm" onClick={() => setShowEditModal(true)}>
              Edit
            </button>
          </div>
        </div>

        {/* Model Management Section for multi-model providers */}
        {showModelManagement && (
          <div className="border-t border-base-300 mt-4 pt-4">
            {/* Model Groups */}
            <div className="space-y-2">
              {Array.from(filteredModelsByProvider.entries()).map(([providerName, models]) => (
                <ProviderModelGroup
                  key={providerName}
                  providerName={providerName}
                  models={models}
                  enabledModels={models
                    .filter((m) => !modelConfig.disabledModels.includes(m.id))
                    .map((m) => m.id)}
                  onToggleProvider={handleToggleProvider}
                  onToggleModel={handleToggleModel}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <EditInstanceModal
        isOpen={showEditModal}
        instance={instance}
        onClose={() => setShowEditModal(false)}
        onSuccess={handleEditSuccess}
        onDelete={onDelete}
        onRefresh={onRefresh}
        onTest={onTest}
      />
    </div>
  );
}
