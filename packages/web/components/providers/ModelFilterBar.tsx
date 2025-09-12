'use client';

import React, { type ChangeEvent } from 'react';

interface ModelFilters {
  requiredParameters?: string[];
  minContextLength?: number;
  maxPromptCostPerMillion?: number;
}

interface ModelFilterBarProps {
  filters: ModelFilters;
  onChange: (filters: ModelFilters) => void;
}

const CAPABILITIES = [
  { id: 'tools', label: 'Tools' },
  { id: 'vision', label: 'Vision' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'structured_outputs', label: 'Structured' },
  { id: 'function_calling', label: 'Functions' },
];

export function ModelFilterBar({ filters, onChange }: ModelFilterBarProps) {
  const handleCapabilityChange = (capability: string, checked: boolean) => {
    const current = filters.requiredParameters ?? [];
    const updated = checked ? [...current, capability] : current.filter((c) => c !== capability);

    onChange({ ...filters, requiredParameters: updated });
  };

  const handleContextChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onChange({
      ...filters,
      minContextLength: value ? parseInt(value, 10) : undefined,
    });
  };

  const handlePriceChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onChange({
      ...filters,
      maxPromptCostPerMillion: value ? parseFloat(value) : undefined,
    });
  };

  return (
    <div className="navbar bg-base-200 rounded-lg p-2">
      <div className="navbar-start">
        <div className="flex items-center gap-2">
          {CAPABILITIES.map((cap, index) => (
            <div key={cap.id} className="flex items-center">
              <label className="flex items-center gap-1 px-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={filters.requiredParameters?.includes(cap.id) ?? false}
                  onChange={(e) => handleCapabilityChange(cap.id, e.target.checked)}
                  aria-label={cap.label}
                />
                <span className="text-xs">{cap.label}</span>
              </label>
              {index < CAPABILITIES.length - 1 && (
                <div className="divider divider-horizontal m-0"></div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="navbar-end gap-3">
        <select
          className="select select-xs select-bordered"
          value={filters.minContextLength ?? ''}
          onChange={handleContextChange}
          aria-label="Context Size"
        >
          <option value="">Any context</option>
          <option value="32000">&gt; 32k</option>
          <option value="100000">&gt; 100k</option>
          <option value="500000">&gt; 500k</option>
        </select>
        <select
          className="select select-xs select-bordered"
          value={filters.maxPromptCostPerMillion ?? ''}
          onChange={handlePriceChange}
          aria-label="Max Price"
        >
          <option value="">Any price</option>
          <option value="0">Free only</option>
          <option value="1">&lt; $1/M</option>
          <option value="5">&lt; $5/M</option>
          <option value="10">&lt; $10/M</option>
        </select>
      </div>
    </div>
  );
}
