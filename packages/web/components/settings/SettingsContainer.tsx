// ABOUTME: Container component managing settings modal state and theme persistence
// ABOUTME: Provides integration point between settings UI and application state

'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlug, faUser, faCog, faServer } from '@/lib/fontawesome';
import { useTheme } from '@/components/providers/ThemeProvider';
import { SettingsTabs } from './SettingsTabs';
import { UISettingsPanel } from './panels/UISettingsPanel';
import { UserSettingsPanel } from './panels/UserSettingsPanel';
import { ProvidersPanel } from './panels/ProvidersPanel';
import { MCPPanel } from './panels/MCPPanel';

interface SettingsContainerProps {
  children: (props: { onOpenSettings: () => void }) => React.ReactNode;
}

export function SettingsContainer({ children }: SettingsContainerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, setDaisyUITheme } = useTheme();

  const handleThemeChange = useCallback(
    (newTheme: string) => {
      if (newTheme === 'light' || newTheme === 'dark') {
        setDaisyUITheme(newTheme);
      }
    },
    [setDaisyUITheme]
  );

  const handleOpenSettings = useCallback(() => setIsOpen(true), []);
  const handleCloseSettings = useCallback(() => setIsOpen(false), []);

  // Memoize the children callback props to prevent unnecessary re-renders
  const childrenProps = useMemo(
    () => ({
      onOpenSettings: handleOpenSettings,
    }),
    [handleOpenSettings]
  );

  // Memoize the settings panels to avoid recreating on every render
  const uiSettingsPanel = useMemo(
    () => <UISettingsPanel currentTheme={theme.daisyui} onThemeChange={handleThemeChange} />,
    [theme.daisyui, handleThemeChange]
  );

  const userSettingsPanel = useMemo(() => <UserSettingsPanel />, []);

  const providersPanel = useMemo(() => <ProvidersPanel />, []);

  const mcpPanel = useMemo(() => <MCPPanel />, []);

  // Tab configuration with icons
  const tabConfig = [
    {
      id: 'providers',
      label: 'Providers',
      icon: <FontAwesomeIcon icon={faPlug} className="w-4 h-4" />,
    },
    {
      id: 'mcp',
      label: 'MCP Servers',
      icon: <FontAwesomeIcon icon={faServer} className="w-4 h-4" />,
    },
    { id: 'ui', label: 'UI', icon: <FontAwesomeIcon icon={faCog} className="w-4 h-4" /> },
    { id: 'user', label: 'User', icon: <FontAwesomeIcon icon={faUser} className="w-4 h-4" /> },
  ];

  return (
    <>
      {children(childrenProps)}

      <Modal
        isOpen={isOpen}
        onClose={handleCloseSettings}
        title="Configuration"
        size="full"
        className="w-[80vw] h-[80vh] max-w-none max-h-none md:w-[90vw] md:h-[85vh] sm:w-[95vw] sm:h-[90vh] bg-base-100/60 backdrop-blur-md border border-base-300/60 shadow-xl"
      >
        <div className="h-[calc(80vh-8rem)] -m-4 flex flex-col rounded-xl overflow-hidden">
          <SettingsTabs defaultTab="providers" tabs={tabConfig}>
            <div data-tab="providers" className="flex-1 overflow-y-auto p-6">
              {providersPanel}
            </div>
            <div data-tab="mcp" className="flex-1 overflow-y-auto p-6">
              {mcpPanel}
            </div>
            <div data-tab="ui" className="flex-1 overflow-y-auto p-6">
              {uiSettingsPanel}
            </div>
            <div data-tab="user" className="flex-1 overflow-y-auto p-6">
              {userSettingsPanel}
            </div>
          </SettingsTabs>
        </div>
      </Modal>
    </>
  );
}
