// ABOUTME: UI-specific settings panel containing theme selector and display preferences
// ABOUTME: Handles theme changes and visual customization options

'use client';

import React from 'react';
import { ThemeSelector } from '@/components/ui/ThemeSelector';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { SettingField } from '@/components/settings/SettingField';
import { Alert } from '@/components/ui/Alert';
import { useTheme } from '@/components/providers/ThemeProvider';

interface UISettingsPanelProps {
  currentTheme?: string;
  onThemeChange?: (theme: string) => void;
}

export function UISettingsPanel({ currentTheme, onThemeChange }: UISettingsPanelProps) {
  const { theme, setTimelineWidth } = useTheme();
  return (
    <SettingsPanel title="UI Settings">
      <Alert
        variant="success"
        title="Settings are saved"
        description="Your UI preferences are automatically saved and will persist between sessions."
        className="mb-6"
      />
      <SettingField label="Color Theme" description="Choose between light and dark appearance">
        <ThemeSelector currentTheme={currentTheme} onThemeChange={onThemeChange} />
      </SettingField>

      <SettingField
        label="Timeline Width"
        description="Control how wide the conversation timeline appears"
      >
        <div className="flex gap-2">
          {(['narrow', 'medium', 'wide', 'full'] as const).map((width) => (
            <button
              key={width}
              onClick={() => setTimelineWidth(width)}
              className={`btn btn-sm ${
                theme.timeline.width === width ? 'btn-primary' : 'btn-outline btn-neutral'
              }`}
            >
              {width.charAt(0).toUpperCase() + width.slice(1)}
            </button>
          ))}
        </div>
      </SettingField>
    </SettingsPanel>
  );
}
