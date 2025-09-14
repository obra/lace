// ABOUTME: Context and price filter dropdowns for model management
// ABOUTME: Provides consistent filtering controls for context size and pricing

'use client';

import type { ChangeEvent } from 'react';

interface FilterDropdownsProps {
  contextFilter?: number;
  priceFilter?: number;
  onContextChange: (value: number | undefined) => void;
  onPriceChange: (value: number | undefined) => void;
}

export function FilterDropdowns({
  contextFilter,
  priceFilter,
  onContextChange,
  onPriceChange,
}: FilterDropdownsProps) {
  const handleContextChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onContextChange(value ? parseInt(value, 10) : undefined);
  };

  const handlePriceChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onPriceChange(value ? parseFloat(value) : undefined);
  };

  return (
    <div className="flex items-center gap-2">
      <select
        className="select select-xs select-bordered"
        value={contextFilter ?? ''}
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
        value={priceFilter ?? ''}
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
  );
}
