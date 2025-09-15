// ABOUTME: Navigation tabs for settings pages using React Router NavLink
// ABOUTME: Provides horizontal tab navigation between different settings sections

'use client';

import React from 'react';
import { NavLink } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlug, faUser, faCog, faServer } from '@/lib/fontawesome';

interface SettingsNavigationProps {
  activeTab: 'providers' | 'mcp' | 'ui' | 'user';
}

const tabs = [
  {
    id: 'providers',
    label: 'Providers',
    icon: faPlug,
    path: '/settings/providers',
  },
  {
    id: 'mcp',
    label: 'MCP Servers',
    icon: faServer,
    path: '/settings/mcp',
  },
  {
    id: 'ui',
    label: 'UI',
    icon: faCog,
    path: '/settings/ui',
  },
  {
    id: 'user',
    label: 'User',
    icon: faUser,
    path: '/settings/user',
  },
] as const;

export function SettingsNavigation({ activeTab }: SettingsNavigationProps) {
  return (
    <div className="border-b border-base-300">
      <div className="max-w-4xl mx-auto px-6">
        <nav className="flex space-x-8" aria-label="Settings navigation">
          {tabs.map((tab) => (
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
