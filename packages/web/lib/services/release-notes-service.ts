// ABOUTME: Service for managing release notes display logic and user settings integration
// ABOUTME: Handles checking if release notes should be shown and updating seen status

import { api } from '@/lib/api-client';

// Static import of release notes content
import { RELEASE_NOTES } from '@/app/release-notes';

export interface ReleaseNotesStatus {
  shouldShow: boolean;
  content: string;
  currentHash: string;
}

/**
 * Calculate simple hash of release notes content for browser compatibility
 */
function getReleaseNotesHash(): string {
  let hash = 0;
  for (let i = 0; i < RELEASE_NOTES.length; i++) {
    const char = RELEASE_NOTES.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Check if release notes should be shown to the user
 *
 * @param lastSeenHash - Hash of the last release notes version the user has seen
 * @returns Object indicating whether to show modal, content, and current hash
 */
export function checkReleaseNotesStatus(lastSeenHash?: string): ReleaseNotesStatus {
  const currentHash = getReleaseNotesHash();
  const shouldShow = !lastSeenHash || lastSeenHash !== currentHash;

  return {
    shouldShow,
    content: RELEASE_NOTES,
    currentHash,
  };
}

/**
 * Get current release notes content and hash
 *
 * @returns Object containing the release notes markdown content and its hash
 */
export function getCurrentReleaseNotes(): { content: string; hash: string } {
  return {
    content: RELEASE_NOTES,
    hash: getReleaseNotesHash(),
  };
}

/**
 * Update user settings with the current release notes hash
 *
 * @param currentHash - Hash of the release notes version to mark as seen
 * @returns Promise that resolves when settings are updated
 */
export async function markReleaseNotesAsSeen(currentHash: string): Promise<void> {
  try {
    await api.patch('/api/settings', {
      lastSeenReleaseNotesHash: currentHash,
    });
  } catch (error) {
    console.warn('Failed to update release notes seen status:', error);
  }
}
