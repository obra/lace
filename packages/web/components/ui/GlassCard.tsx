import React from 'react';
import clsx from 'clsx';

/**
 * GlassCard
 * Dim-theme friendly glass panel with blur, subtle borders and depth.
 */
interface GlassCardProps extends React.HTMLAttributes<HTMLElement> {
  as?: React.ElementType;
}

export function GlassCard({ as: Tag = 'div', className, children, ...rest }: GlassCardProps) {
  return (
    <Tag
      className={clsx(
        'rounded-2xl',
        'bg-base-100/80 border border-base-300/50',
        'backdrop-blur-md saturate-150',
        'shadow-lg',
        'p-4 md:p-6',
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
