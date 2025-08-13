// ABOUTME: Reusable provider dropdown component for provider selection
// ABOUTME: Filters to only show configured providers and handles provider change events

'use client';

import { useMemo } from 'react';
import type { ProviderInfo } from '@/types/api';

interface ProviderDropdownProps {
  providers: ProviderInfo[];
  selectedProvider: string;
  onChange: (providerType: string, availableModels: { id: string; displayName: string }[]) => void;
  className?: string;
  disabled?: boolean;
  label?: string;
}

export function ProviderDropdown({
  providers,
  selectedProvider,
  onChange,
  className = 'select select-bordered w-full',
  disabled = false,
  label,
}: ProviderDropdownProps) {
  // Get available providers (only those that are configured)
  const availableProviders = useMemo(() => {
    return providers.filter((p) => p.configured);
  }, [providers]);

  const handleProviderChange = (providerName: string) => {
    const provider = providers.find((p) => p.name === providerName);
    const availableModels = provider?.models || [];
    onChange(providerName, availableModels);
  };

  return (
    <>
      {label && (
        <label className="label">
          <span className="label-text font-medium">{label}</span>
        </label>
      )}
      <select
        value={selectedProvider}
        onChange={(e) => handleProviderChange(e.target.value)}
        className={className}
        disabled={disabled}
      >
        {availableProviders.length > 0 ? (
          availableProviders.map((provider) => (
            <option key={provider.name} value={provider.name}>
              {provider.displayName}
            </option>
          ))
        ) : (
          <option disabled value="">
            No providers configured
          </option>
        )}
      </select>
    </>
  );
}
