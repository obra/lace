// ABOUTME: Service for managing release notes display logic and user settings integration
// ABOUTME: Handles checking if release notes should be shown and updating seen status

import type { ReleaseNotesMeta } from '@/types/release-notes';

// Static import of generated release notes metadata
// This file is generated at build time by scripts/generate-release-notes-meta.ts
// @ts-expect-error - JSON import may not exist in development, but will be generated at build time
// eslint-disable-next-line import/no-unresolved
import releaseNotesMetaModule from '@/app/generated/release-notes-meta.json';

// Function to get release notes metadata
export function loadReleaseNotesMeta(): ReleaseNotesMeta | null {
  try {
    return releaseNotesMetaModule as ReleaseNotesMeta;
  } catch {
    return null;
  }
}

export interface ReleaseNotesStatus {
  shouldShow: boolean;
  content: string;
  currentHash: string;
}

/**
 * Check if release notes should be shown to the user
 */
export async function checkReleaseNotesStatus(lastSeenHash?: string): Promise<ReleaseNotesStatus> {
  const meta = loadReleaseNotesMeta();

  if (!meta) {
    return {
      shouldShow: false,
      content: '',
      currentHash: '',
    };
  }

  const shouldShow = !lastSeenHash || lastSeenHash !== meta.hash;

  return {
    shouldShow,
    content: meta.content,
    currentHash: meta.hash,
  };
}

/**
 * Get current release notes content and hash
 */
export function getCurrentReleaseNotes(): { content: string; hash: string } | null {
  const meta = loadReleaseNotesMeta();

  if (!meta) {
    return null;
  }

  return {
    content: meta.content,
    hash: meta.hash,
  };
}

/**
 * Update user settings with the current release notes hash
 */
export async function markReleaseNotesAsSeen(currentHash: string): Promise<void> {
  try {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lastSeenReleaseNotesHash: currentHash,
      }),
    });

    if (!response.ok) {
      console.warn('Failed to update release notes seen status:', response.statusText);
    }
  } catch (error) {
    console.warn('Failed to update release notes seen status:', error);
  }
}
