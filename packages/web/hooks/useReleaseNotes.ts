// ABOUTME: React hook for managing release notes display and user interaction
// ABOUTME: Handles checking if release notes should be shown and updating seen status

import { useState, useEffect } from 'react';
import {
  checkReleaseNotesStatus,
  markReleaseNotesAsSeen,
} from '@/lib/services/release-notes-service';

interface UseReleaseNotesResult {
  shouldShowModal: boolean;
  content: string;
  isLoading: boolean;
  handleMarkAsSeen: () => Promise<void>;
  dismissModal: () => void;
}

export function useReleaseNotes(userSettings?: Record<string, unknown>): UseReleaseNotesResult {
  const [shouldShowModal, setShouldShowModal] = useState(false);
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [currentHash, setCurrentHash] = useState('');

  useEffect(() => {
    // Don't check until we have actual user settings (not undefined)
    if (userSettings === undefined) {
      return;
    }

    async function checkStatus() {
      setIsLoading(true);
      try {
        const lastSeenHash = userSettings?.lastSeenReleaseNotesHash as string | undefined;
        const status = await checkReleaseNotesStatus(lastSeenHash);

        setShouldShowModal(status.shouldShow);
        setContent(status.content);
        setCurrentHash(status.currentHash);
      } catch (error) {
        console.warn('Failed to check release notes status:', error);
        setShouldShowModal(false);
        setContent('');
        setCurrentHash('');
      } finally {
        setIsLoading(false);
      }
    }

    void checkStatus();
  }, [userSettings]);

  const handleMarkAsSeen = async (): Promise<void> => {
    if (currentHash) {
      await markReleaseNotesAsSeen(currentHash);
    }
  };

  const dismissModal = (): void => {
    setShouldShowModal(false);
  };

  return {
    shouldShowModal,
    content,
    isLoading,
    handleMarkAsSeen,
    dismissModal,
  };
}
