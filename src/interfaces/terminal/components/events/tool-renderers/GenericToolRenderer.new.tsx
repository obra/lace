// ABOUTME: Generic tool renderer using three-layer architecture for consistent fallback behavior
// ABOUTME: Provides standardized display for any tool execution with input/output patterns

import React, { forwardRef, useImperativeHandle } from 'react';
import { TimelineItemRef } from '../../timeline-item-focus.js';
import { ToolDisplay } from './components/ToolDisplay.js';
import { useToolData } from './hooks/useToolData.js';
import { useToolState } from './hooks/useToolState.js';

// Extract tool execution timeline item type
type ToolExecutionItem = {
  type: 'tool_execution';
  call: any;
  result?: any;
  timestamp: Date;
  callId: string;
};

interface GenericToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

export const GenericToolRenderer = forwardRef<TimelineItemRef, GenericToolRendererProps>(({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}, ref) => {
  
  // Layer 1: Data processing
  const toolData = useToolData(item);
  
  // Layer 2: State management  
  const toolState = useToolState(toolData, isSelected, onToggle);
  
  // Expose ref methods (compatibility)
  useImperativeHandle(ref, () => ({
    enterFocus: () => {
      // Generic renderer doesn't need special focus handling
    },
  }), []);

  // Layer 3: Display using default components
  // The ToolDisplay component provides sensible defaults for header, preview, and content
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      // No custom components - use all defaults
    />
  );
});