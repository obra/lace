// ABOUTME: Reusable model dropdown component for provider/model selection
// ABOUTME: Handles model filtering based on provider and shows appropriate fallback messages

'use client';

import { useMemo } from 'react';
import type { ProviderInfo, ModelInfo } from '@/types/api';

interface ModelDropdownProps {
  providers: ProviderInfo[];
  selectedProvider: string;
  selectedModel: string;
  onChange: (modelName: string) => void;
  className?: string;
  disabled?: boolean;
  label?: string;
}

export function ModelDropdown({
  providers,
  selectedProvider,
  selectedModel,
  onChange,
  className = "select select-bordered w-full",
  disabled = false,
  label
}: ModelDropdownProps) {
  // Get available models for the selected provider
  const availableModels = useMemo(() => {
    const provider = providers.find(p => p.name === selectedProvider);
    return provider?.models || [];
  }, [providers, selectedProvider]);

  return (
    <>
      {label && (
        <label className="label">
          <span className="label-text font-medium">{label}</span>
        </label>
      )}
      <select
        value={selectedModel}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        disabled={disabled}
      >
        {availableModels.length > 0 ? (
          availableModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.displayName}
            </option>
          ))
        ) : (
          <option disabled value="">
            {selectedProvider ? `No models available for ${selectedProvider}` : 'Select a provider first'}
          </option>
        )}
      </select>
    </>
  );
}