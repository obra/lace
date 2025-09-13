// ABOUTME: Individual instance card with status, actions, and details
// ABOUTME: Uses StatusDot, Badge, and card components from design system

import { useState, useEffect, useMemo } from 'react';
import StatusDot from '@/components/ui/StatusDot';
import Badge from '@/components/ui/Badge';
import { EditInstanceModal } from './EditInstanceModal';
import { ModelFilterBar } from './ModelFilterBar';
import { ProviderModelGroup } from './ProviderModelGroup';
import type { CatalogProvider } from '@lace/core/providers/catalog/types';

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
}

export function ProviderInstanceCard({
  instance,
  provider,
  onTest,
  onDelete,
  onEdit,
}: ProviderInstanceCardProps) {
  const [showEditModal, setShowEditModal] = useState(false);

  // Model management state for OpenRouter instances
  const [modelConfig, setModelConfig] = useState({
    enableNewModels: true,
    disabledModels: [] as string[],
    disabledProviders: [] as string[],
    filters: {},
  });

  const [filteredModels, setFilteredModels] = useState(provider?.models ?? []);
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

  // Group models by provider for OpenRouter instances
  const modelsByProvider = useMemo(() => {
    if (!provider || provider.id !== 'openrouter') return new Map();

    const groups = new Map<string, typeof provider.models>();
    filteredModels.forEach((model) => {
      const providerName = model.id.split('/')[0] || 'unknown';
      const group = groups.get(providerName) || [];
      group.push(model);
      groups.set(providerName, group);
    });
    return groups;
  }, [filteredModels, provider]);

  // Toggle handlers for model management
  const handleToggleProvider = (providerName: string, enabled: boolean) => {
    setModelConfig((prev) => {
      const updated = { ...prev };
      if (enabled) {
        // Remove provider from disabled list
        updated.disabledProviders = prev.disabledProviders.filter((p) => p !== providerName);
        // Remove all models from this provider from disabled list
        const providerModels = Array.from(modelsByProvider.get(providerName) || []);
        updated.disabledModels = prev.disabledModels.filter(
          (m) => !providerModels.some((pm: unknown) => (pm as { id: string }).id === m)
        );
      } else {
        // Add provider to disabled list
        updated.disabledProviders = [...prev.disabledProviders, providerName];
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
    setIsRefreshing(true);
    try {
      const response = await fetch(`/api/provider/instances/${instance.id}/refresh`, {
        method: 'POST',
      });

      if (response.ok) {
        const updated = await response.json();
        // Signal parent to refresh data
        onEdit?.();
      } else {
        console.error('Failed to refresh catalog');
      }
    } catch (error) {
      console.error('Error refreshing catalog:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Apply search and filters for OpenRouter instances
  useEffect(() => {
    if (!provider || provider.id !== 'openrouter') return;

    let filtered = provider.models;

    // Apply search
    if (searchQuery) {
      filtered = filtered.filter(
        (model) =>
          model.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          model.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply config filters (basic implementation for now)
    filtered = filtered.filter((model) => {
      // Check disabled providers
      const modelProvider = model.id.split('/')[0] || 'unknown';
      if (modelConfig.disabledProviders.includes(modelProvider)) {
        return false;
      }

      // Check disabled models
      if (modelConfig.disabledModels.includes(model.id)) {
        return false;
      }

      return true;
    });

    setFilteredModels(filtered);
  }, [provider, searchQuery, modelConfig]);

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <StatusDot status={statusProps.status} size="md" />
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-1">
                <h4 className="font-medium">{instance.displayName}</h4>
                <Badge variant="outline" size="xs">
                  {instance.catalogProviderId}
                </Badge>
              </div>
              <div className="text-sm text-base-content/60 space-y-1">
                <div className="flex items-center space-x-4">
                  <span>{statusProps.text}</span>
                  {instance.modelCount !== undefined && (
                    <span>{instance.modelCount} models available</span>
                  )}
                  {instance.hasCredentials && (
                    <Badge variant="success" size="xs">
                      Configured
                    </Badge>
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
            <button
              className="btn btn-ghost btn-sm text-error hover:bg-error/10"
              onClick={handleDeleteClick}
            >
              Delete
            </button>
          </div>
        </div>

        {/* Model Management Section for OpenRouter instances */}
        {provider && instance.catalogProviderId === 'openrouter' && (
          <div className="border-t border-base-300 mt-4 pt-4">
            <div className="mb-3">
              <h5 className="font-medium mb-2">Model Management</h5>

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
                filters={modelConfig.filters}
                onChange={(filters) => {
                  setModelConfig((prev) => ({ ...prev, filters }));
                }}
              />

              {/* Refresh Status */}
              <div className="flex justify-between items-center my-3">
                <span className="text-sm opacity-70">
                  {provider.models.length} models available
                </span>
                <button
                  className="btn btn-circle btn-sm btn-primary"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  )}
                </button>
              </div>

              {/* Model Groups */}
              <div className="space-y-2">
                {Array.from(modelsByProvider.entries()).map(([providerName, models]) => (
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
