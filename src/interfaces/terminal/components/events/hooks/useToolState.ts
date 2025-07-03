// ABOUTME: State management hook for tool renderer components with expansion and focus handling
// ABOUTME: Provides consistent state patterns and handlers that work with existing timeline infrastructure

import { useState, useCallback } from 'react';
import { useTimelineItemExpansion } from './useTimelineExpansionToggle.js';
import { ToolData } from './useToolData.js';

// Tool-specific state that can be extended for complex tools
export interface ToolState {
  // Core expansion state (integrated with timeline)
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  handleExpandedChange: (expanded: boolean) => void;
  
  // Generic tool-specific state for complex tools
  customState: Record<string, unknown>;
  setCustomState: (key: string, value: unknown) => void;
}

/**
 * Hook for managing tool renderer state
 * 
 * This hook provides consistent state management patterns for all tool renderers,
 * building on top of the existing timeline expansion infrastructure while allowing
 * for tool-specific state extensions.
 * 
 * @param toolData - Parsed tool data from useToolData
 * @param isSelected - Whether this timeline item is currently selected
 * @param onToggle - Callback for expansion toggle events
 * @returns State object with handlers
 */
export function useToolState(
  toolData: ToolData,
  isSelected: boolean = false,
  onToggle?: () => void
): ToolState {
  
  // Use existing expansion management for consistent behavior
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(
    isSelected,
    () => onToggle?.()
  );

  // Generic tool-specific state for complex tools (like delegate expansion)
  const [customState, setCustomStateInternal] = useState<Record<string, unknown>>({});
  
  // Handler that works with TimelineEntryCollapsibleBox interface
  const handleExpandedChange = useCallback((expanded: boolean) => {
    if (expanded) {
      onExpand();
    } else {
      onCollapse();
    }
  }, [onExpand, onCollapse]);
  
  // Custom state setter with key-value pattern
  const setCustomState = useCallback((key: string, value: unknown) => {
    setCustomStateInternal(prev => ({
      ...prev,
      [key]: value
    }));
  }, []);

  return {
    isExpanded,
    onExpand,
    onCollapse,
    handleExpandedChange,
    customState,
    setCustomState,
  };
}

/**
 * Extended state hook for complex tools that need focus management
 * 
 * This is for tools like delegate that need more sophisticated state management
 * with focus handling and nested component state.
 */
export interface ExtendedToolState extends ToolState {
  // Focus management for complex tools
  focusState: Record<string, unknown>;
  setFocusState: (key: string, value: unknown) => void;
}

export function useExtendedToolState(
  toolData: ToolData,
  isSelected: boolean = false,
  onToggle?: () => void
): ExtendedToolState {
  
  const baseState = useToolState(toolData, isSelected, onToggle);
  
  // Additional focus state for complex tools
  const [focusState, setFocusStateInternal] = useState<Record<string, unknown>>({});
  
  const setFocusState = useCallback((key: string, value: unknown) => {
    setFocusStateInternal(prev => ({
      ...prev,
      [key]: value
    }));
  }, []);

  return {
    ...baseState,
    focusState,
    setFocusState,
  };
}