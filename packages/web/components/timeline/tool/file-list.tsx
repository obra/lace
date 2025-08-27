// ABOUTME: File list tool renderer implementation for directory listing display
// ABOUTME: Provides custom display logic for file listing operations

import { faList } from '@fortawesome/free-solid-svg-icons';
import type { ToolRenderer } from './types';

export const fileListRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'path' in args) {
      const path = (args as { path?: unknown }).path;
      if (typeof path === 'string' && path.trim()) {
        return `Listed files in ${path}`;
      }
    }
    return 'Listed files in directory';
  },

  getIcon: () => {
    return faList;
  },
};
