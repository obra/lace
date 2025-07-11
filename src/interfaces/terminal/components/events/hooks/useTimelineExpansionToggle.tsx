// ABOUTME: Hook and emitters for timeline expansion events using event emitter pattern
// ABOUTME: Allows timeline-level controls to send expand/collapse events to selected timeline items
//
// ARCHITECTURE OVERVIEW:
// =====================
// This module implements a timeline-to-item communication system for expansion controls:
//
// 1. TIMELINE LEVEL (sender):
//    - Uses useExpansionExpand() and useExpansionCollapse() hooks
//    - Typically called from keyboard shortcuts or UI controls
//    - Emits expansion events through the ExpansionEmitter
//
// 2. TIMELINE ITEMS (receivers):
//    - Use useTimelineItemExpansion() hook which includes event listeners
//    - Only listen to events when isSelected=true (the current timeline cursor position)
//    - Maintain their own individual expansion state
//
// 3. CONTEXT SCOPING:
//    - Each TimelineExpansionProvider creates an isolated ExpansionEmitter
//    - Multiple conversations/timelines don't interfere with each other
//    - Events only affect items within the same provider scope
//
// EXAMPLE FLOW:
// - User presses 'e' key in timeline → Timeline calls emitExpand()
// - Only the currently selected timeline item receives the expand event
// - That item updates its own expansion state and re-renders

import React, { useCallback, useEffect, useState, createContext, useContext } from 'react';
import { logger } from '~/utils/logger.js';

// Event emitter for timeline-to-item expansion and focus communication
class ExpansionEmitter {
  private expandListeners: Set<() => void> = new Set();
  private collapseListeners: Set<() => void> = new Set();
  private focusEntryListeners: Set<() => void> = new Set();

  subscribeExpand(listener: () => void): () => void {
    this.expandListeners.add(listener);
    return () => {
      this.expandListeners.delete(listener);
    };
  }

  subscribeCollapse(listener: () => void): () => void {
    this.collapseListeners.add(listener);
    return () => {
      this.collapseListeners.delete(listener);
    };
  }

  subscribeFocusEntry(listener: () => void): () => void {
    this.focusEntryListeners.add(listener);
    return () => {
      this.focusEntryListeners.delete(listener);
    };
  }

  emitExpand(): void {
    this.expandListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        logger.error('Error in expansion listener', {
          error: error instanceof Error ? error.message : String(error),
          operation: 'expand',
        });
      }
    });
  }

  emitCollapse(): void {
    this.collapseListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        logger.error('Error in collapse listener', {
          error: error instanceof Error ? error.message : String(error),
          operation: 'collapse',
        });
      }
    });
  }

  emitFocusEntry(): void {
    this.focusEntryListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        logger.error('Error in focus entry listener', {
          error: error instanceof Error ? error.message : String(error),
          operation: 'focus-entry',
        });
      }
    });
  }
}

// Context for timeline expansion emitter
const ExpansionEmitterContext = createContext<ExpansionEmitter | null>(null);

// Provider component for timeline expansion context
// NOTE: Each provider instance creates its own ExpansionEmitter, so different
// conversation views or timeline instances will have isolated expansion state.
// This allows timeline-level controls to communicate with their own timeline items.
export function TimelineExpansionProvider({ children }: { children: React.ReactNode }) {
  const [emitter] = useState(() => new ExpansionEmitter());
  return (
    <ExpansionEmitterContext.Provider value={emitter}>{children}</ExpansionEmitterContext.Provider>
  );
}

// Hook to get the expansion emitter from context
function useExpansionEmitter(): ExpansionEmitter {
  const emitter = useContext(ExpansionEmitterContext);
  if (!emitter) {
    throw new Error('useExpansionEmitter must be used within a TimelineExpansionProvider');
  }
  return emitter;
}

// Hooks for timeline-level controls to emit expansion events
// These are used by Timeline components to send expand/collapse commands
// to the currently selected timeline item (e.g., from keyboard shortcuts)
export function useExpansionExpand() {
  const emitter = useExpansionEmitter();
  return useCallback(() => emitter.emitExpand(), [emitter]);
}

export function useExpansionCollapse() {
  const emitter = useExpansionEmitter();
  return useCallback(() => emitter.emitCollapse(), [emitter]);
}

export function useTimelineFocusEntry() {
  const emitter = useExpansionEmitter();
  return useCallback(() => emitter.emitFocusEntry(), [emitter]);
}

// Hook for timeline items to listen for focus entry events
// This hook provides event listener registration that only listens when isSelected=true
// Usage by timeline items that can accept focus (like delegate tools):
// - Call this hook with isSelected indicating if this item has the timeline cursor
// - When isSelected=true, this item will respond to timeline-level focus entry events
export function useTimelineItemFocusEntry(isSelected: boolean, onFocusEntry?: () => void): void {
  const emitter = useExpansionEmitter();

  useEffect(() => {
    if (!isSelected || !onFocusEntry) return; // Only the selected item responds to focus entry events

    const unsubscribeFocusEntry = emitter.subscribeFocusEntry(onFocusEntry);

    return () => {
      unsubscribeFocusEntry();
    };
  }, [isSelected, onFocusEntry, emitter]);
}

// Hook for timeline items to manage expansion state and listen for timeline events
// This hook provides:
// 1. Individual expansion state management for each timeline item
// 2. Event listener registration that only listens when isSelected=true
// 3. Directional expand/collapse methods for manual control
//
// Usage by timeline items:
// - Call this hook with isSelected indicating if this item has the timeline cursor
// - When isSelected=true, this item will respond to timeline-level expand/collapse events
// - Use onExpand/onCollapse for manual expansion control (e.g., mouse clicks)
export function useTimelineItemExpansion(
  isSelected: boolean,
  onExpansionChange?: (expanded: boolean) => void
): {
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
} {
  const [isExpanded, setIsExpanded] = useState(false);
  const emitter = useExpansionEmitter();

  // Internal expansion state management
  const expand = useCallback(() => {
    setIsExpanded(true);
    onExpansionChange?.(true);
  }, [onExpansionChange]);

  const collapse = useCallback(() => {
    setIsExpanded(false);
    onExpansionChange?.(false);
  }, [onExpansionChange]);

  // Public API for manual expansion control
  const onExpand = useCallback(() => {
    if (!isExpanded) {
      expand();
    }
  }, [isExpanded, expand]);

  const onCollapse = useCallback(() => {
    if (isExpanded) {
      collapse();
    }
  }, [isExpanded, collapse]);

  // KEY FEATURE: Listen for timeline-level expansion events when this item is selected
  // This enables keyboard shortcuts and other timeline controls to expand/collapse
  // the currently selected item without each timeline needing to track item state
  useEffect(() => {
    if (!isSelected) return; // Only the selected item responds to timeline events

    const unsubscribeExpand = emitter.subscribeExpand(expand);
    const unsubscribeCollapse = emitter.subscribeCollapse(collapse);

    return () => {
      unsubscribeExpand();
      unsubscribeCollapse();
    };
  }, [isSelected, expand, collapse, emitter]);

  return {
    isExpanded,
    onExpand,
    onCollapse,
  };
}
