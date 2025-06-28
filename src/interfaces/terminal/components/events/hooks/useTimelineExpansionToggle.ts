// ABOUTME: Hook and emitters for timeline expansion events using event emitter pattern
// ABOUTME: Provides directional expand/collapse events and shared state management for timeline items

import { useCallback, useEffect, useState } from 'react';

// Event emitter for expansion events
class ExpansionEmitter {
  private expandListeners: Set<() => void> = new Set();
  private collapseListeners: Set<() => void> = new Set();

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

  emitExpand(): void {
    this.expandListeners.forEach((listener) => listener());
  }

  emitCollapse(): void {
    this.collapseListeners.forEach((listener) => listener());
  }
}

// Global instance for expansion events
const expansionEmitter = new ExpansionEmitter();

// Export functions to emit directional events
export function emitExpansionExpand(): void {
  expansionEmitter.emitExpand();
}

export function emitExpansionCollapse(): void {
  expansionEmitter.emitCollapse();
}


// Combined hook that provides complete expansion state management
export function useTimelineItemExpansion(isSelected: boolean, onToggle?: () => void) {
  const [isExpanded, setIsExpanded] = useState(false);

  const expand = useCallback(() => {
    setIsExpanded(true);
    onToggle?.();
  }, [onToggle]);

  const collapse = useCallback(() => {
    setIsExpanded(false);
    onToggle?.();
  }, [onToggle]);


  const handleExpandedChange = useCallback(
    (expanded: boolean) => {
      setIsExpanded(expanded);
      onToggle?.();
    },
    [onToggle]
  );

  // Listen for directional expansion events when selected
  useEffect(() => {
    if (!isSelected) return;

    const unsubscribeExpand = expansionEmitter.subscribeExpand(expand);
    const unsubscribeCollapse = expansionEmitter.subscribeCollapse(collapse);

    return () => {
      unsubscribeExpand();
      unsubscribeCollapse();
    };
  }, [isSelected, expand, collapse]);

  return {
    isExpanded,
    handleExpandedChange,
  };
}

