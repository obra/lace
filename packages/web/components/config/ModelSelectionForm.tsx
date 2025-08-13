// ABOUTME: Reusable component for selecting provider instances and models
// ABOUTME: Used in project and session configuration dialogs

import React, { useMemo } from 'react';
import type { ProviderInfo } from '@/types/api';

interface ModelSelectionFormProps {
  providers: ProviderInfo[];
  providerInstanceId?: string;
  modelId?: string;
  onProviderChange: (instanceId: string) => void;
  onModelChange: (modelId: string) => void;
  className?: string;
}

export function ModelSelectionForm({
  providers,
  providerInstanceId,
  modelId,
  onProviderChange,
  onModelChange,
  className = '',
}: ModelSelectionFormProps) {
  // Get available providers (only those that are configured with instance IDs)
  const availableProviders = useMemo(() => {
    return providers.filter((p): p is ProviderInfo & { instanceId: string } =>
      Boolean(p.configured && p.instanceId)
    );
  }, [providers]);

  // Get available models for selected provider
  const availableModels = useMemo(() => {
    const provider = providers.find((p) => p.instanceId === providerInstanceId);
    return provider?.models || [];
  }, [providers, providerInstanceId]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newInstanceId = e.target.value;
    onProviderChange(newInstanceId);

    // Auto-select first model when provider changes
    const provider = providers.find((p) => p.instanceId === newInstanceId);
    const providerModels = provider?.models || [];
    if (providerModels.length > 0 && providerModels[0]) {
      onModelChange(providerModels[0].id);
    }
  };

  return (
    <div className={`grid md:grid-cols-2 gap-4 ${className}`}>
      <div>
        <label className="label">
          <span className="label-text font-medium">Provider Instance</span>
        </label>
        <select
          value={providerInstanceId || ''}
          onChange={handleProviderChange}
          className="select select-bordered w-full"
          required
        >
          {availableProviders.length === 0 ? (
            <option value="">No providers configured</option>
          ) : (
            <>
              {!providerInstanceId && <option value="">Select a provider</option>}
              {availableProviders.map((provider) => (
                <option key={provider.instanceId} value={provider.instanceId}>
                  {provider.displayName}
                </option>
              ))}
            </>
          )}
        </select>
      </div>

      <div>
        <label className="label">
          <span className="label-text font-medium">Model</span>
        </label>
        <select
          value={modelId || ''}
          onChange={(e) => onModelChange(e.target.value)}
          className="select select-bordered w-full"
          required
          disabled={!providerInstanceId}
        >
          {!providerInstanceId ? (
            <option value="">Select a provider first</option>
          ) : availableModels.length === 0 ? (
            <option value="">No models available</option>
          ) : (
            <>
              {!modelId && <option value="">Select a model</option>}
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </>
          )}
        </select>
      </div>
    </div>
  );
}
