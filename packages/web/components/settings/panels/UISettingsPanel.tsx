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
      <SettingField>
        <ThemeSelector 
          currentTheme={currentTheme}
          onThemeChange={onThemeChange}
        />
      </SettingField>
    </SettingsPanel>
  );
}