// ABOUTME: Context provider for managing scroll behavior across chat components
// ABOUTME: Provides methods to trigger autoscroll from different parts of the app

'use client';

import React, { createContext, useContext, useCallback, useRef } from 'react';

interface ScrollContextValue {
  // Trigger forced scroll to bottom (e.g., when user sends message)
  triggerAutoscroll: (force?: boolean) => void;
  // Register a scroll handler (used by timeline components)
  registerScrollHandler: (handler: (force?: boolean) => void) => void;
}

const ScrollContext = createContext<ScrollContextValue | undefined>(undefined);

export function ScrollProvider({ children }: { children: React.ReactNode }) {
  const scrollHandlerRef = useRef<((force?: boolean) => void) | null>(null);

  const triggerAutoscroll = useCallback((force = false) => {
    if (scrollHandlerRef.current) {
      scrollHandlerRef.current(force);
    }
  }, []);

  const registerScrollHandler = useCallback((handler: (force?: boolean) => void) => {
    scrollHandlerRef.current = handler;
  }, []);

  return (
    <ScrollContext.Provider value={{ triggerAutoscroll, registerScrollHandler }}>
      {children}
    </ScrollContext.Provider>
  );
}

export function useScrollContext() {
  const context = useContext(ScrollContext);
  if (context === undefined) {
    throw new Error('useScrollContext must be used within a ScrollProvider');
  }
  return context;
}
