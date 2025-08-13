import React from 'react';
import clsx from 'clsx';

/**
 * GlassCard
 * Dim-theme friendly glass panel with blur, subtle borders and depth.
 */
export interface GlassCardProps extends React.HTMLAttributes<HTMLElement> {
  as?: React.ElementType;
}

export function GlassCard({ as: Tag = 'div', className, children, ...rest }: GlassCardProps) {
  return (
    <Tag
      className={clsx(
        'glass-card rounded-2xl',
        // Fill + borders + blur
        'bg-[rgba(12,16,14,.55)] border border-white/10 outline-1 outline-black/40',
        'backdrop-blur-[14px] saturate-[1.4] shadow-[0_14px_44px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.06)]',
        'p-4 md:p-6',
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export default GlassCard;
