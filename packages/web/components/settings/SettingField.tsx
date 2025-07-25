// ABOUTME: Field wrapper component for individual settings with consistent label and layout
// ABOUTME: Provides standardized field structure with label, description, and control area

'use client';

import React from 'react';

interface SettingFieldProps {
  label?: string;
  description?: string;
  required?: boolean;
  layout?: 'vertical' | 'horizontal';
  className?: string;
  children: React.ReactNode;
}

export function SettingField({ 
  label, 
  description, 
  required = false, 
  layout = 'vertical',
  className = '', 
  children 
}: SettingFieldProps) {
  const isHorizontal = layout === 'horizontal';
  
  return (
    <div className={`flex gap-3 ${isHorizontal ? 'flex-row items-start' : 'flex-col'} ${className}`}>
      {/* Label and description */}
      {label && (
        <div className={`${isHorizontal ? 'flex-shrink-0 w-48' : 'w-full'}`}>
          <div className="flex items-center gap-1">
            <span className="text-sm font-medium text-base-content">{label}</span>
            {required && <span className="text-error text-sm">*</span>}
          </div>
          {description && (
            <p className="text-xs text-base-content/60 mt-1">{description}</p>
          )}
        </div>
      )}
      
      {/* Control area */}
      <div className={`${isHorizontal ? 'flex-1' : 'w-full'} space-y-2`}>
        {children}
      </div>
    </div>
  );
}