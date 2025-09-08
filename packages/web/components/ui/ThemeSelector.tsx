'use client';

import React from 'react';
import { useTheme } from '@/components/providers/SettingsProvider';

// Limit app-visible themes to core options for now. Others retained for quick restore.
const availableThemes = [
  { name: 'light', colors: { primary: '#570DF8', secondary: '#F000B8', accent: '#37CDBE' } },
  { name: 'dark', colors: { primary: '#661AE6', secondary: '#D926AA', accent: '#1FB2A5' } },
  // { name: 'cupcake', colors: { primary: '#65C3C8', secondary: '#EF9FBC', accent: '#EEAF3A' } },
  // { name: 'corporate', colors: { primary: '#4B6BFB', secondary: '#7C3AED', accent: '#37CDBE' } },
  // { name: 'synthwave', colors: { primary: '#E779C1', secondary: '#58C7F3', accent: '#F7CC50' } },
  // { name: 'cyberpunk', colors: { primary: '#FF7598', secondary: '#75D1F0', accent: '#C07F00' } },
  // { name: 'business', colors: { primary: '#1C4E80', secondary: '#7C909A', accent: '#EA6947' } },
  // { name: 'emerald', colors: { primary: '#66CC8A', secondary: '#377CFB', accent: '#F68067' } },
  // { name: 'lofi', colors: { primary: '#808080', secondary: '#4D4D4D', accent: '#1A1A1A' } },
];

interface ThemeSelectorProps {
  currentTheme?: string;
  onThemeChange?: (theme: string) => void;
}

export function ThemeSelector({ currentTheme: propTheme, onThemeChange }: ThemeSelectorProps) {
  const { theme: contextTheme, setDaisyUITheme } = useTheme();

  // Use prop theme if provided, otherwise use context theme
  const currentTheme = propTheme ?? contextTheme.daisyui;

  const handleThemeChange = (themeName: string) => {
    if (onThemeChange) {
      onThemeChange(themeName);
    } else {
      setDaisyUITheme(themeName as 'light' | 'dark');
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-base-content">Theme</span>
        <span className="text-xs text-base-content/60 capitalize">{currentTheme}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {availableThemes.map((theme) => (
          <button
            key={theme.name}
            onClick={() => handleThemeChange(theme.name)}
            className={`relative p-2 rounded-lg border-2 transition-all hover:scale-105 ${
              currentTheme === theme.name
                ? 'border-primary'
                : 'border-base-300 hover:border-base-content/20'
            }`}
          >
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-5 rounded flex overflow-hidden border border-base-content/10">
                <div className="flex-1" style={{ backgroundColor: theme.colors.primary }}></div>
                <div className="flex-1" style={{ backgroundColor: theme.colors.secondary }}></div>
                <div className="flex-1" style={{ backgroundColor: theme.colors.accent }}></div>
              </div>
              <span className="text-xs text-base-content/80 capitalize">{theme.name}</span>
            </div>
            {currentTheme === theme.name && (
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full flex items-center justify-center">
                <i className="fas fa-check w-2 h-2 text-primary-content"></i>
              </div>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
