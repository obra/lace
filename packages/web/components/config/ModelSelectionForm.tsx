// ABOUTME: Unified model selector with provider grouping using optgroups
// ABOUTME: Replaces separate provider/model dropdowns with single grouped selector

import React from 'react';
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
  // Filter to only configured providers
  const configuredProviders = providers.filter(
    (provider) => provider.configured && provider.instanceId
  );

  // Current selection value
  const currentValue = providerInstanceId && modelId ? `${providerInstanceId}:${modelId}` : '';

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (!value) return;

    const [newProviderInstanceId, newModelId] = value.split(':');
    if (newProviderInstanceId && newModelId) {
      onProviderChange(newProviderInstanceId);
      onModelChange(newModelId);
    }
  };

  const hasModels = configuredProviders.some((provider) => provider.models.length > 0);

  return (
    <div className={className}>
      <label className="label">
        <span className="label-text font-medium">Provider / Model</span>
      </label>
      <select
        value={currentValue}
        onChange={handleChange}
        className="select select-bordered w-full"
        required
        disabled={!hasModels}
      >
        <option value="" disabled>
          {!hasModels ? 'No models available' : 'Select provider and model...'}
        </option>

        {configuredProviders.map(
          (provider) =>
            provider.models.length > 0 && (
              <optgroup key={provider.instanceId} label={provider.displayName}>
                {provider.models.map((model) => (
                  <option
                    key={`${provider.instanceId}:${model.id}`}
                    value={`${provider.instanceId}:${model.id}`}
                  >
                    {model.displayName}
                  </option>
                ))}
              </optgroup>
            )
        )}
      </select>
    </div>
  );
}
