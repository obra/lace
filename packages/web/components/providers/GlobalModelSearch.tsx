// ABOUTME: Global search and filter component for all provider models
// ABOUTME: Provides unified search/filter interface across all providers

'use client';

import { SearchInput } from './SearchInput';
import { CapabilityFilters } from './CapabilityFilters';
import { FilterDropdowns } from './FilterDropdowns';

export interface GlobalModelFilters {
  searchQuery: string;
  requiredParameters: string[];
  minContextLength?: number;
  maxPromptCostPerMillion?: number;
}

interface GlobalModelSearchProps {
  filters: GlobalModelFilters;
  onChange: (filters: GlobalModelFilters) => void;
  resultCount?: number;
  totalCount?: number;
}

export function GlobalModelSearch({
  filters,
  onChange,
  resultCount,
  totalCount,
}: GlobalModelSearchProps) {
  return (
    <div className="card bg-base-100 shadow-sm border border-base-300 mb-6">
      <div className="card-body p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold">Model Search</h3>
          {resultCount !== undefined && totalCount !== undefined && (
            <span className="text-sm opacity-70">
              {resultCount} of {totalCount} models
            </span>
          )}
        </div>

        {/* Global Search and Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <SearchInput
            value={filters.searchQuery}
            onChange={(value) => onChange({ ...filters, searchQuery: value })}
            placeholder="Search models across all providers..."
            className="input input-bordered input-sm flex-1 min-w-64"
          />

          <CapabilityFilters
            selectedCapabilities={filters.requiredParameters}
            onChange={(capabilities) => onChange({ ...filters, requiredParameters: capabilities })}
          />

          <FilterDropdowns
            contextFilter={filters.minContextLength}
            priceFilter={filters.maxPromptCostPerMillion}
            onContextChange={(value) => onChange({ ...filters, minContextLength: value })}
            onPriceChange={(value) => onChange({ ...filters, maxPromptCostPerMillion: value })}
          />
        </div>
      </div>
    </div>
  );
}
