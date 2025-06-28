// ABOUTME: Hook and emitters for timeline expansion events using event emitter pattern
// ABOUTME: Provides directional expand/collapse events and shared state management for timeline items

import React, { useCallback, useEffect, useState, createContext, useContext } from 'react';
import { logger } from '../../../../../utils/logger.js';

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
}

// Context for timeline expansion emitter
const ExpansionEmitterContext = createContext<ExpansionEmitter | null>(null);

// Provider component for timeline expansion context
export function TimelineExpansionProvider({ children }: { children: React.ReactNode }) {
  const [emitter] = useState(() => new ExpansionEmitter());
  return (
    <ExpansionEmitterContext.Provider value={emitter}>
      {children}
    </ExpansionEmitterContext.Provider>
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

// Export hooks to emit directional events  
export function useExpansionExpand() {
  const emitter = useExpansionEmitter();
  return useCallback(() => emitter.emitExpand(), [emitter]);
}

export function useExpansionCollapse() {
  const emitter = useExpansionEmitter();
  return useCallback(() => emitter.emitCollapse(), [emitter]);
}

// Combined hook that provides complete expansion state management
export function useTimelineItemExpansion(isSelected: boolean, onToggle?: () => void): {
  isExpanded: boolean;
  handleExpandedChange: (expanded: boolean) => void;
} {
  const [isExpanded, setIsExpanded] = useState(false);
  const emitter = useExpansionEmitter();

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

    const unsubscribeExpand = emitter.subscribeExpand(expand);
    const unsubscribeCollapse = emitter.subscribeCollapse(collapse);

    return () => {
      unsubscribeExpand();
      unsubscribeCollapse();
    };
  }, [isSelected, expand, collapse, emitter]);

  return {
    isExpanded,
    handleExpandedChange,
  };
}
