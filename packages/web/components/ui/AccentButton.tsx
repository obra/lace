import React from 'react';
import clsx from 'clsx';

export interface AccentButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  iconLeft?: React.ReactNode;
}

export function AccentButton({ className, iconLeft, children, ...rest }: AccentButtonProps) {
  return (
    <button
      {...rest}
      className={clsx(
        'btn no-animation',
        // Accent look tuned for dim
        'bg-gradient-to-br from-emerald-500 to-cyan-400 text-black hover:from-emerald-400 hover:to-cyan-300',
        'border-0 shadow-[0_10px_30px_rgba(0,0,0,.35)]',
        'ring-hover',
        className
      )}
    >
      {iconLeft ? <span className="mr-2 inline-flex items-center">{iconLeft}</span> : null}
      {children}
    </button>
  );
}

export default AccentButton;
