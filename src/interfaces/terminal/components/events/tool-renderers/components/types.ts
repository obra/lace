// ABOUTME: Type definitions for tool renderer data providers
// ABOUTME: Allows tool renderers to provide data without managing layout

import { ReactNode } from 'react';

export interface ToolRendererData {
  // Header information
  icon: string;
  title: ReactNode;
  sizeIndicator?: string; // e.g., "1.2KB", "42 lines", "3 files"

  // Preview content (shown when collapsed)
  preview?: ReactNode;

  // Full content (shown when expanded)
  content: ReactNode;

  // Status
  status: 'pending' | 'success' | 'error';
}
