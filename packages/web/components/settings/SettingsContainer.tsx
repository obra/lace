// ABOUTME: Container component managing settings modal state and theme persistence
// ABOUTME: Provides integration point between settings UI and application state

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { SettingsModal } from './SettingsModal';
import { SettingsTabs } from './SettingsTabs';
import { UISettingsPanel } from './panels/UISettingsPanel';
import { UserSettingsPanel } from './panels/UserSettingsPanel';
import { ProvidersPanel } from './panels/ProvidersPanel';
import { SystemPanel } from './panels/SystemPanel';
import { AboutPanel } from './panels/AboutPanel';

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

  const providersPanel = useMemo(() => (
    <ProvidersPanel />
  ), []);

  const systemPanel = useMemo(() => (
    <SystemPanel />
  ), []);

  const aboutPanel = useMemo(() => (
    <AboutPanel />
  ), []);

  // Tab configuration with icons
  const tabConfig = [
    { id: 'providers', label: 'Providers', icon: '🔗' },
    { id: 'ui', label: 'UI', icon: '🎨' },
    { id: 'user', label: 'User', icon: '👤' },
    { id: 'system', label: 'System', icon: '⚙️' },
    { id: 'about', label: 'About', icon: 'ℹ️' },
  ];

  return (
    <>
      {children(childrenProps)}
      
      <SettingsModal isOpen={isOpen} onClose={handleCloseSettings}>
        <SettingsTabs defaultTab="providers" tabs={tabConfig}>
          <div data-tab="providers">
            {providersPanel}
          </div>
          <div data-tab="ui">
            {uiSettingsPanel}
          </div>
          <div data-tab="user">
            {userSettingsPanel}
          </div>
          <div data-tab="system">
            {systemPanel}
          </div>
          <div data-tab="about">
            {aboutPanel}
          </div>
        </SettingsTabs>
      </SettingsModal>
    </>
  );
}