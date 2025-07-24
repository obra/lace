// ABOUTME: Container component managing settings modal state and theme persistence
// ABOUTME: Provides integration point between settings UI and application state

'use client';

import React, { useState, useEffect } from 'react';
import { SettingsModal } from './SettingsModal';
import { SettingsTabs } from './SettingsTabs';
import { UISettingsPanel } from './panels/UISettingsPanel';

interface SettingsContainerProps {
  children: (props: { onOpenSettings: () => void }) => React.ReactNode;
}

export function SettingsContainer({ children }: SettingsContainerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState('dark');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setCurrentTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  };

  const handleOpenSettings = () => setIsOpen(true);
  const handleCloseSettings = () => setIsOpen(false);

  return (
    <>
      {children({ onOpenSettings: handleOpenSettings })}
      
      <SettingsModal isOpen={isOpen} onClose={handleCloseSettings}>
        <SettingsTabs defaultTab="ui">
          <div data-tab="ui">
            <UISettingsPanel 
              currentTheme={currentTheme}
              onThemeChange={handleThemeChange}
            />
          </div>
        </SettingsTabs>
      </SettingsModal>
    </>
  );
}