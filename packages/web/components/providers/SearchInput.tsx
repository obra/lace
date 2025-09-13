// ABOUTME: Reusable search input component for model filtering
// ABOUTME: Provides consistent search functionality across provider cards

'use client';

import type { ChangeEvent } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search models...',
  className = 'input input-bordered input-sm flex-1',
}: SearchInputProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <input
      type="text"
      placeholder={placeholder}
      className={className}
      value={value}
      onChange={handleChange}
    />
  );
}
