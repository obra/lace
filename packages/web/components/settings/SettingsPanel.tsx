// ABOUTME: Base panel component for settings sections with consistent header and content layout
// ABOUTME: Provides standardized structure for settings content with optional title and description

'use client';

import React from 'react';

interface SettingsPanelProps {
  title?: string;
  description?: string;
  icon?: string;
  className?: string;
  children: React.ReactNode;
}

export function SettingsPanel({ title, description, icon, className = '', children }: SettingsPanelProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Panel header */}
      {title && (
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-base-content flex items-center gap-2">
            {icon && <span>{icon}</span>}
            {title}
          </h3>
          {description && (
            <p className="text-sm text-base-content/60">{description}</p>
          )}
        </div>
      )}
      
      {/* Panel content */}
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}