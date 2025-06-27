// ABOUTME: Hook for timeline expansion toggle events using event emitter pattern
// ABOUTME: Allows expandable components to respond to left/right arrow keys when selected

import { useEffect, useCallback } from 'react';

// Simple event emitter for expansion toggle events
class ExpansionToggleEmitter {
  private listeners: Set<() => void> = new Set();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

// Global instance for expansion toggle events
const expansionToggleEmitter = new ExpansionToggleEmitter();

// Export function to emit toggle events
export function emitExpansionToggle(): void {
  expansionToggleEmitter.emit();
}

// Hook for expandable components to listen for toggle events
export function useTimelineExpansionToggle(isSelected: boolean, toggleExpansion: () => void): void {
  const handleToggle = useCallback(() => {
    if (isSelected) {
      toggleExpansion();
    }
  }, [isSelected, toggleExpansion]);

  useEffect(() => {
    return expansionToggleEmitter.subscribe(handleToggle);
  }, [handleToggle]);
}
