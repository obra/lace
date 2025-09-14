// ABOUTME: Capability checkbox filters for model management
// ABOUTME: Provides checkboxes for Tools, Vision, Reasoning, etc.

'use client';

interface CapabilityFiltersProps {
  selectedCapabilities: string[];
  onChange: (capabilities: string[]) => void;
}

const CAPABILITIES = [
  { id: 'tools', label: 'Tools' },
  { id: 'vision', label: 'Vision' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'structured_outputs', label: 'Structured' },
  { id: 'function_calling', label: 'Functions' },
];

export function CapabilityFilters({ selectedCapabilities, onChange }: CapabilityFiltersProps) {
  const handleCapabilityChange = (capability: string, checked: boolean) => {
    const updated = checked
      ? [...selectedCapabilities, capability]
      : selectedCapabilities.filter((c) => c !== capability);

    onChange(updated);
  };

  return (
    <div className="flex items-center gap-2">
      {CAPABILITIES.map((cap) => (
        <label key={cap.id} className="flex items-center gap-1">
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={selectedCapabilities.includes(cap.id)}
            onChange={(e) => handleCapabilityChange(cap.id, e.target.checked)}
            aria-label={cap.label}
          />
          <span className="text-xs">{cap.label}</span>
        </label>
      ))}
    </div>
  );
}
