'use client';
import React from 'react';

export interface AdvancedSettingsCollapseProps {
  title?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const AdvancedSettingsCollapse: React.FC<AdvancedSettingsCollapseProps> = ({
  title = 'Advanced settings',
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="rounded-lg border border-accent/40 bg-base-100/40">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-left font-medium text-accent"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="text-xs text-accent/80">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="px-3 pb-3 text-sm text-base-content/80">{children}</div>}
    </div>
  );
};
