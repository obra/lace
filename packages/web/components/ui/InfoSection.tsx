'use client';
import React from 'react';
import { InfoIconButton } from './InfoIconButton';

export interface InfoSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const InfoSection: React.FC<InfoSectionProps> = ({
  title,
  defaultOpen = false,
  children,
  className = '',
}) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={['rounded-lg border border-base-200 p-4', className].join(' ')}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-base-content">{title}</h3>
        <InfoIconButton
          label={open ? 'Hide info' : 'Show info'}
          active={open}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        />
      </div>
      {open && <div className="text-sm text-base-content/80 space-y-2">{children}</div>}
    </div>
  );
};
