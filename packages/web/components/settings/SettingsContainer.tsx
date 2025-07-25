// ABOUTME: Container component managing settings modal state and theme persistence
// ABOUTME: Provides integration point between settings UI and application state

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { SettingsModal } from './SettingsModal';
import { SettingsTabs } from './SettingsTabs';
import { UISettingsPanel } from './panels/UISettingsPanel';
import { UserSettingsPanel } from './panels/UserSettingsPanel';

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

  const handleThemeChange = useCallback((theme: string) => {
    // Update state and localStorage immediately for consistency
    setCurrentTheme(theme);
    localStorage.setItem('theme', theme);
    
    // Batch DOM operation to avoid unnecessary reflows
    requestAnimationFrame(() => {
      document.documentElement.setAttribute('data-theme', theme);
    });
  }, []);

  const handleOpenSettings = useCallback(() => setIsOpen(true), []);
  const handleCloseSettings = useCallback(() => setIsOpen(false), []);

  // Memoize the children callback props to prevent unnecessary re-renders
  const childrenProps = useMemo(() => ({ 
    onOpenSettings: handleOpenSettings 
  }), [handleOpenSettings]);

  // Memoize the settings panels to avoid recreating on every render
  const uiSettingsPanel = useMemo(() => (
    <UISettingsPanel 
      currentTheme={currentTheme}
      onThemeChange={handleThemeChange}
    />
  ), [currentTheme, handleThemeChange]);

  const userSettingsPanel = useMemo(() => (
    <UserSettingsPanel />
  ), []);

  return (
    <>
      {children(childrenProps)}
      
      <SettingsModal isOpen={isOpen} onClose={handleCloseSettings}>
        <SettingsTabs defaultTab="ui">
          <div data-tab="ui">
            {uiSettingsPanel}
          </div>
          <div data-tab="user">
            {userSettingsPanel}
          </div>
        </SettingsTabs>
      </SettingsModal>
    </>
  );
}