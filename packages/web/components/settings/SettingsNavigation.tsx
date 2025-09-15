// ABOUTME: Navigation tabs for settings pages using React Router NavLink
// ABOUTME: Provides horizontal tab navigation between different settings sections

'use client';

import React from 'react';
import { NavLink } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { SETTINGS_TAB_CONFIGS, type SettingsTab } from '@/lib/settings-config';

interface SettingsNavigationProps {
  activeTab: SettingsTab;
}

export function SettingsNavigation({ activeTab }: SettingsNavigationProps) {
  return (
    <div className="border-b border-base-300">
      <div className="max-w-4xl mx-auto px-6">
        <nav className="flex space-x-8" aria-label="Settings navigation">
          {SETTINGS_TAB_CONFIGS.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.path}
              className={({ isActive }) =>
                `
                flex items-center gap-2 py-4 px-1 border-b-2 transition-colors
                ${
                  isActive || tab.id === activeTab
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-base-content/70 hover:text-base-content hover:border-base-300'
                }
              `
              }
            >
              <FontAwesomeIcon icon={tab.icon} className="w-4 h-4" />
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
