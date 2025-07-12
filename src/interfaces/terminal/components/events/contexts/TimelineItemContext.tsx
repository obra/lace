// ABOUTME: Context for timeline items to access selection, expansion, and toggle state
// ABOUTME: Eliminates prop drilling and simplifies timeline item components

import React, { createContext, useContext, ReactNode } from 'react';
import { useTimelineItemExpansion } from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle';

interface TimelineItemContextValue {
  // Selection state
  isSelected: boolean;

  // Expansion state and controls
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;

  // Toggle callback (for external listeners)
  onToggle?: () => void;

  // Focus state (for multi-line items)
  focusedLine?: number;
  itemStartLine?: number;
}

const TimelineItemContext = createContext<TimelineItemContextValue | null>(null);

interface TimelineItemProviderProps {
  children: ReactNode;
  isSelected: boolean;
  onToggle?: () => void;
  focusedLine?: number;
  itemStartLine?: number;
}

export function TimelineItemProvider({
  children,
  isSelected,
  onToggle,
  focusedLine,
  itemStartLine,
}: TimelineItemProviderProps) {
  // Use the existing expansion hook
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(isSelected, onToggle);

  return (
    <TimelineItemContext.Provider
      value={{
        isSelected,
        isExpanded,
        onExpand,
        onCollapse,
        onToggle,
        focusedLine,
        itemStartLine,
      }}
    >
      {children}
    </TimelineItemContext.Provider>
  );
}

// Hook to consume timeline item context
export function useTimelineItem() {
  const context = useContext(TimelineItemContext);
  if (!context) {
    throw new Error('useTimelineItem must be used within TimelineItemProvider');
  }
  return context;
}

// Optional hook that doesn't throw if context is missing
// Useful for components that might be used outside timeline context
export function useTimelineItemOptional() {
  return useContext(TimelineItemContext);
}
