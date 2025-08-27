// ABOUTME: Search tool renderer implementation for grep/search operations
// ABOUTME: Provides custom display logic for search and pattern matching tools

import { faSearch } from '@fortawesome/free-solid-svg-icons';
import type { ToolRenderer } from './types';

export const searchRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null) {
      const argsObj = args as Record<string, unknown>;
      const pattern = argsObj.pattern || argsObj.query;
      if (typeof pattern === 'string' && pattern.trim()) {
        return `Searched for: ${pattern}`;
      }
    }
    return 'Searched for pattern';
  },

  getIcon: () => {
    return faSearch;
  },
};
