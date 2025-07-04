// ABOUTME: State management layer for tool renderers - handles expansion, focus, and tool-specific state
// ABOUTME: Provides memoized handlers and integrates with existing timeline expansion infrastructure

import { useCallback, useState } from 'react';
import { useTimelineItemExpansion } from '../../hooks/useTimelineExpansionToggle.js';
import { ToolData } from './useToolData.js';

// Options for tool-specific state extensions
export interface ToolStateOptions {
  enableDelegateState?: boolean;
}

// Custom state for specific tools
export interface ToolCustomState {
  // Delegate-specific state
  delegationExpanded?: boolean;
  setDelegationExpanded?: (expanded: boolean) => void;
}

// Complete state interface
export interface ToolState {
  // Timeline expansion state
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  
  // Unified handler for components that expect boolean toggle
  handleExpandedChange: (expanded: boolean) => void;
  
  // Tool-specific custom state
  customState?: ToolCustomState;
}

// Main state management hook
export function useToolState(
  toolData: ToolData,
  isSelected: boolean,
  onToggle?: () => void,
  options?: ToolStateOptions
): ToolState {
  // Use existing timeline expansion infrastructure
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(
    isSelected,
    () => onToggle?.()
  );

  // Memoized handler for components that expect boolean toggle
  const handleExpandedChange = useCallback(
    (expanded: boolean) => {
      if (expanded) {
        onExpand();
      } else {
        onCollapse();
      }
    },
    [onExpand, onCollapse]
  );

  // Tool-specific custom state
  let customState: ToolCustomState | undefined;

  // Delegate-specific state management
  if (options?.enableDelegateState && toolData.toolName === 'delegate') {
    const [delegationExpanded, setDelegationExpanded] = useState(true);
    
    customState = {
      delegationExpanded,
      setDelegationExpanded,
    };
  }

  return {
    isExpanded,
    onExpand,
    onCollapse,
    handleExpandedChange,
    customState,
  };
}