'use client';
import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfo } from '@fortawesome/free-solid-svg-icons';

export interface InfoIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
  active?: boolean;
}

export const InfoIconButton: React.FC<InfoIconButtonProps> = ({
  label = 'Show info',
  active = false,
  className = '',
  ...props
}) => {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={[
        'inline-flex items-center justify-center rounded-full',
        'w-8 h-8',
        'text-white bg-emerald-500/90 hover:bg-emerald-500 focus:outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100',
        active ? 'ring-2 ring-accent/70' : '',
        className,
      ].join(' ')}
      {...props}
    >
      <FontAwesomeIcon icon={faInfo} className="w-4 h-4" />
    </button>
  );
};
