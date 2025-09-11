// ABOUTME: Standalone model selector component with provider grouping
// ABOUTME: Reusable dropdown for selecting provider instances and models

'use client';

import React from 'react';
import type { ProviderInfo } from '@/types/api';

interface ModelSelectorProps {
  providers: ProviderInfo[];
  selectedProviderInstanceId?: string;
  selectedModelId?: string;
  onChange: (providerInstanceId: string, modelId: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function ModelSelector({
  providers,
  selectedProviderInstanceId,
  selectedModelId,
  onChange,
  disabled = false,
  className = '',
  placeholder = 'Select model...',
}: ModelSelectorProps) {
  // Filter to only configured providers
  const configuredProviders = providers.filter(
    (provider) => provider.configured && provider.instanceId
  );

  // Current selection value using URL-encoded delimiter for safety
  const currentValue =
    selectedProviderInstanceId && selectedModelId
      ? `${encodeURIComponent(selectedProviderInstanceId)}|${encodeURIComponent(selectedModelId)}`
      : '';

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (!value) return;

    const parts = value.split('|');
    if (parts.length === 2) {
      try {
        const providerInstanceId = decodeURIComponent(parts[0]);
        const modelId = decodeURIComponent(parts[1]);
        if (providerInstanceId && modelId) {
          onChange(providerInstanceId, modelId);
        }
      } catch (error) {
        console.error('Failed to decode model selector value:', error);
      }
    }
  };

  const hasModels = configuredProviders.some((provider) => provider.models.length > 0);

  return (
    <select
      value={currentValue}
      onChange={handleChange}
      disabled={disabled || !hasModels}
      className={className}
    >
      <option value="" disabled>
        {!hasModels ? 'No models available' : placeholder}
      </option>

      {configuredProviders.map(
        (provider) =>
          provider.models.length > 0 && (
            <optgroup key={provider.instanceId} label={provider.displayName}>
              {provider.models.map((model) => (
                <option
                  key={`${provider.instanceId}:${model.id}`}
                  value={`${encodeURIComponent(provider.instanceId!)}|${encodeURIComponent(model.id)}`}
                >
                  {model.displayName}
                </option>
              ))}
            </optgroup>
          )
      )}
    </select>
  );
}
