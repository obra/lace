// ABOUTME: URL fetch tool renderer implementation for web requests
// ABOUTME: Provides custom display logic for URL fetching and web content retrieval

import { faGlobe } from '@fortawesome/free-solid-svg-icons';
import type { ToolRenderer, ToolResult } from './types';

export const urlFetchRenderer: ToolRenderer = {
  getSummary: (args: unknown, result?: ToolResult): string => {
    if (typeof args === 'object' && args !== null && 'url' in args) {
      const url = (args as { url?: unknown }).url;
      if (typeof url === 'string' && url.trim()) {
        return `Fetched: ${url}`;
      }
    }
    return 'Fetched URL';
  },

  getIcon: () => {
    return faGlobe;
  },
};
