'use client';
import React from 'react';

interface AccentSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  invalid?: boolean;
  options?: Array<{ label: string; value: string }>;
}

export const AccentSelect = React.forwardRef<HTMLSelectElement, AccentSelectProps>(
  ({ label, helperText, invalid = false, className = '', children, options, ...props }, ref) => {
    return (
      <label className="form-control w-full">
        {label && <span className="label-text mb-1 text-base-content/80">{label}</span>}
        <select
          ref={ref}
          {...props}
          className={[
            'select w-full',
            invalid ? 'select-error' : 'select-bordered',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100',
            'ring-hover',
            className,
          ].join(' ')}
        >
          {children}
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {helperText && (
          <span className={'mt-1 text-xs ' + (invalid ? 'text-error' : 'text-base-content/60')}>
            {helperText}
          </span>
        )}
      </label>
    );
  }
);
AccentSelect.displayName = 'AccentSelect';
