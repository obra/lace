// ABOUTME: Provider component that manages release notes modal display on app load
// ABOUTME: Integrates with user settings and shows modal when release notes are newer than last seen

'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { ReleaseNotesModal } from '@/components/ui/ReleaseNotesModal';
import { useReleaseNotes } from '@/hooks/useReleaseNotes';
import { api } from '@/lib/api-client';

interface ReleaseNotesContextType {
  isReleaseNotesAvailable: boolean;
}

const ReleaseNotesContext = createContext<ReleaseNotesContextType | null>(null);

export function useReleaseNotesContext() {
  const context = useContext(ReleaseNotesContext);
  if (!context) {
    throw new Error('useReleaseNotesContext must be used within ReleaseNotesProvider');
  }
  return context;
}

interface ReleaseNotesProviderProps {
  children: ReactNode;
}

export function ReleaseNotesProvider({ children }: ReleaseNotesProviderProps) {
  const [rawUserSettings, setRawUserSettings] = useState<Record<string, unknown> | null>(null);

  // Load raw user settings to get lastSeenReleaseNotesHash
  useEffect(() => {
    let cancelled = false;

    const loadRawSettings = async () => {
      try {
        const settings = await api.get<Record<string, unknown>>('/api/settings');
        if (!cancelled) {
          setRawUserSettings(settings);
        }
      } catch (error) {
        console.warn('Failed to load user settings for release notes:', error);
        if (!cancelled) {
          setRawUserSettings({});
        }
      }
    };

    void loadRawSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const { shouldShowModal, content, isLoading, handleMarkAsSeen, dismissModal } = useReleaseNotes(
    rawUserSettings || undefined
  );

  const handleMarkAsSeenAndClose = async () => {
    await handleMarkAsSeen();
    dismissModal();
  };

  // Only show modal if settings have loaded and we should show it (automatic on first load)
  const isModalOpen = shouldShowModal && !isLoading && rawUserSettings !== null;
  const isReleaseNotesAvailable = content.length > 0;

  const contextValue: ReleaseNotesContextType = {
    isReleaseNotesAvailable,
  };

  return (
    <ReleaseNotesContext.Provider value={contextValue}>
      {children}

      {/* Release Notes Modal - only for automatic "first load after update" display */}
      <ReleaseNotesModal
        isOpen={isModalOpen}
        onClose={dismissModal}
        content={content}
        onMarkAsSeen={handleMarkAsSeenAndClose}
      />
    </ReleaseNotesContext.Provider>
  );
}
