// ABOUTME: Centralized configuration for settings tabs and navigation
// ABOUTME: Single source of truth for settings tab definitions, types, and metadata

import { faPlug, faUser, faCog, faServer, faNewspaper } from '@/lib/fontawesome';

export const SETTINGS_TABS = {
  PROVIDERS: 'providers',
  MCP: 'mcp',
  UI: 'ui',
  USER: 'user',
  RELEASE_NOTES: 'release-notes',
} as const;

export type SettingsTab = (typeof SETTINGS_TABS)[keyof typeof SETTINGS_TABS];

export interface SettingsTabConfig {
  id: SettingsTab;
  label: string;
  icon: typeof faPlug; // FontAwesome icon type
  path: string;
}

export const SETTINGS_TAB_CONFIGS: readonly SettingsTabConfig[] = [
  {
    id: SETTINGS_TABS.PROVIDERS,
    label: 'Providers',
    icon: faPlug,
    path: '/settings/providers',
  },
  {
    id: SETTINGS_TABS.MCP,
    label: 'MCP Servers',
    icon: faServer,
    path: '/settings/mcp',
  },
  {
    id: SETTINGS_TABS.UI,
    label: 'UI',
    icon: faCog,
    path: '/settings/ui',
  },
  {
    id: SETTINGS_TABS.USER,
    label: 'User',
    icon: faUser,
    path: '/settings/user',
  },
  {
    id: SETTINGS_TABS.RELEASE_NOTES,
    label: 'Release Notes',
    icon: faNewspaper,
    path: '/settings/release-notes',
  },
] as const;
