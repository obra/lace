'use client';
import React from 'react';

export interface AccentInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  invalid?: boolean;
}

export const AccentInput = React.forwardRef<HTMLInputElement, AccentInputProps>(
  ({ label, helperText, invalid = false, className = '', ...props }, ref) => {
    return (
      <label className="form-control w-full">
        {label && <span className="label-text mb-1 text-base-content/80">{label}</span>}
        <input
          ref={ref}
          {...props}
          className={[
            'input w-full',
            invalid ? 'input-error' : 'input-bordered',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100',
            'ring-hover',
            className,
          ].join(' ')}
        />
        {helperText && (
          <span className={'mt-1 text-xs ' + (invalid ? 'text-error' : 'text-base-content/60')}>
            {helperText}
          </span>
        )}
      </label>
    );
  }
);
AccentInput.displayName = 'AccentInput';

export default AccentInput;
