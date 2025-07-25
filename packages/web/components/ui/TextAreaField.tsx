// ABOUTME: TextAreaField component for multi-line text input with DaisyUI styling
// ABOUTME: Provides consistent textarea styling with label, help text, and error states

'use client';

import React from 'react';

interface TextAreaFieldProps {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  helpText?: string;
  className?: string;
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  required = false,
  disabled = false,
  error = false,
  helpText,
  className = ''
}: TextAreaFieldProps) {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e.target.value);
  };

  const textareaClasses = [
    'textarea',
    'textarea-bordered',
    'w-full',
    error ? 'textarea-error' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className="form-control w-full">
      <label className="label">
        <span className="label-text">
          {label}
          {required && <span className="text-error ml-1">*</span>}
        </span>
      </label>
      <textarea
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        rows={rows}
        required={required}
        disabled={disabled}
        className={textareaClasses}
        aria-label={label}
      />
      {helpText && (
        <label className="label">
          <span className="label-text-alt text-base-content/60">{helpText}</span>
        </label>
      )}
    </div>
  );
}