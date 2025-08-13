// ABOUTME: UI-specific settings panel containing theme selector and display preferences
// ABOUTME: Handles theme changes and visual customization options

'use client';

import React from 'react';
import { ThemeSelector } from '@/components/ui/ThemeSelector';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { SettingField } from '@/components/settings/SettingField';

interface UISettingsPanelProps {
  currentTheme?: string;
  onThemeChange?: (theme: string) => void;
}

export function UISettingsPanel({ currentTheme, onThemeChange }: UISettingsPanelProps) {
  return (
    <SettingsPanel title="UI Settings">
      <div className="bg-success/10 border border-success/20 rounded-lg p-3 mb-6">
        <div className="flex items-start gap-2">
          <svg
            className="w-4 h-4 text-success mt-0.5 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.236 4.53L8.124 10.5a.75.75 0 00-1.248 .832l2.5 3.75a.75.75 0 001.32-.116l4-5.5z"
              clipRule="evenodd"
            />
          </svg>
          <div className="text-sm">
            <div className="font-medium text-success">Settings are saved</div>
            <div className="text-base-content/70 mt-1">
              Your UI preferences are automatically saved and will persist between sessions.
            </div>
          </div>
        </div>
      </div>
      <SettingField>
        <ThemeSelector currentTheme={currentTheme} onThemeChange={onThemeChange} />
      </SettingField>
    </SettingsPanel>
  );
}
