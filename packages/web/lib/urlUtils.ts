// ABOUTME: Client-safe URL utilities for Google Docs and other services
// ABOUTME: Provides URL parsing and validation functions for external services

export function extractGoogleDocId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Handle different Google Docs URL formats
    const patterns = [
      /\/document\/d\/([a-zA-Z0-9-_]+)/,
      /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
      /\/presentation\/d\/([a-zA-Z0-9-_]+)/,
    ];

    for (const pattern of patterns) {
      const match = urlObj.pathname.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function isGoogleDocsUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'docs.google.com';
  } catch {
    return false;
  }
}
