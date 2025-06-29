// ABOUTME: React context provider for hierarchical focus management in terminal UI
// ABOUTME: Wraps Ink's focus system with stack-based navigation and global keyboard handling

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode, useMemo } from 'react';
import { useFocusManager, useInput } from 'ink';
import { FocusStack } from './focus-stack.js';
import { FocusRegions } from './focus-regions.js';
import { logger } from '../../../utils/logger.js';

/**
 * Context value interface for Lace focus management
 * Hybrid approach: maintain old API while fixing underlying issues
 */
interface LaceFocusContextValue {
  /**
   * Current focused region ID
   */
  currentFocus: string;
  
  /**
   * Push a new focus onto the stack and update Ink's focus
   */
  pushFocus: (focusId: string) => void;
  
  /**
   * Pop the current focus and return to the previous one
   */
  popFocus: () => string | undefined;
  
  /**
   * Get a copy of the current focus stack for debugging
   */
  getFocusStack: () => string[];
  
  /**
   * Check if a specific focus ID is currently active
   */
  isFocusActive: (focusId: string) => boolean;
}

/**
 * React context for Lace focus management
 */
const LaceFocusContext = createContext<LaceFocusContextValue | null>(null);

/**
 * Props for LaceFocusProvider component
 */
interface LaceFocusProviderProps {
  children: ReactNode;
}

/**
 * Provider component that manages hierarchical focus state and global keyboard handling.
 * 
 * This provider:
 * - Maintains a focus stack for hierarchical navigation
 * - Wraps Ink's focus management with stack-based logic
 * - Provides global Escape key handling for "going back"
 * - Disables Ink's Tab cycling to prevent conflicts
 * 
 * Usage:
 * ```tsx
 * <LaceFocusProvider>
 *   <TerminalInterface />
 * </LaceFocusProvider>
 * ```
 */
export function LaceFocusProvider({ children }: LaceFocusProviderProps) {
  const inkFocus = useFocusManager();
  const [focusStack] = useState(() => new FocusStack());
  const [currentFocus, setCurrentFocus] = useState(focusStack.current());

  // Set initial focus ONCE only - the infinite loop bug fix
  useEffect(() => {
    // Disable Ink's focus cycling completely, then set initial focus
    inkFocus.disableFocus();
    inkFocus.focus(FocusRegions.shell);
  }, []); // Empty deps - run only once, not on every inkFocus change

  // Intercept Tab to prevent default cycling - HIGH PRIORITY
  useInput((input, key) => {
    if (key.tab) {
      // Consume tab events to prevent default cycling
      logger.debug('LaceFocusProvider: Tab intercepted and consumed');
      return;
    }
  }, { isActive: true }); // Always active to ensure it runs before component handlers

  // Global Escape handler - vi-like behavior with proper focus switching
  useInput((input, key) => {
    if (key.escape) {
      logger.debug('LaceFocusProvider: Global escape pressed', {
        currentFocus,
        stackBefore: focusStack.getStack(),
      });
      
      // Vi-like behavior: shell escape goes to timeline using focusNext
      if (currentFocus === FocusRegions.shell) {
        // From shell, navigate to timeline using focusNext (which works)
        const newFocus = focusStack.push(FocusRegions.timeline);
        setCurrentFocus(newFocus);
        inkFocus.focusNext(); // Use focusNext instead of focus(id)
        logger.debug('LaceFocusProvider: Shell -> Timeline navigation (using focusNext)');
      } else if (currentFocus === FocusRegions.timeline) {
        // From timeline, go back to shell (pop stack)
        const newFocus = popFocus();
        logger.debug('LaceFocusProvider: Timeline -> Shell navigation', {
          newFocus,
          stackAfter: focusStack.getStack(),
        });
      } else {
        // From anywhere else (modals, etc), pop back
        const newFocus = popFocus();
        logger.debug('LaceFocusProvider: Pop focus completed', {
          newFocus,
          stackAfter: focusStack.getStack(),
        });
      }
    }
  });

  /**
   * Push a new focus onto the stack and update Ink's focus
   */
  const pushFocus = useCallback((focusId: string) => {
    logger.debug('LaceFocusProvider: pushFocus called', {
      fromFocus: currentFocus,
      toFocus: focusId,
      stackBefore: focusStack.getStack(),
    });
    const newFocus = focusStack.push(focusId);
    setCurrentFocus(newFocus);
    
    logger.debug('LaceFocusProvider: Calling inkFocus.focus', {
      focusId,
      newFocus,
    });
    try {
      inkFocus.focus(focusId);
    } catch (error) {
      logger.warn('LaceFocusProvider: Failed to focus component', {
        focusId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    
    logger.debug('LaceFocusProvider: pushFocus completed', {
      newCurrentFocus: newFocus,
      stackAfter: focusStack.getStack(),
    });
  }, [inkFocus, focusStack, currentFocus]);

  /**
   * Pop the current focus and return to the previous one
   */
  const popFocus = useCallback(() => {
    const newFocus = focusStack.pop();
    if (newFocus) {
      setCurrentFocus(newFocus);
      
      logger.debug('LaceFocusProvider: Calling inkFocus.focus (pop)', {
        focusId: newFocus,
      });
      try {
        inkFocus.focus(newFocus);
      } catch (error) {
        logger.warn('LaceFocusProvider: Failed to focus component on pop', {
          focusId: newFocus,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      
      return newFocus;
    }
    return undefined;
  }, [inkFocus, focusStack]);

  /**
   * Get a copy of the current focus stack for debugging
   */
  const getFocusStack = useCallback(() => {
    return focusStack.getStack();
  }, [focusStack]);

  /**
   * Check if a specific focus ID is currently active
   */
  const isFocusActive = useCallback((focusId: string) => {
    return currentFocus === focusId;
  }, [currentFocus]);

  // Global escape handling via useInput above - pops the focus stack
  // Components use pushFocus() to navigate deeper into the hierarchy

  // Memoize context value to prevent unnecessary re-renders of all consumers
  // This is critical for FocusLifecycleWrapper stability - when context functions
  // change, useEffect dependencies trigger cleanup and re-focus
  const contextValue: LaceFocusContextValue = useMemo(() => ({
    currentFocus,
    pushFocus,
    popFocus,
    getFocusStack,
    isFocusActive,
  }), [currentFocus, pushFocus, popFocus, getFocusStack, isFocusActive]);

  return (
    <LaceFocusContext.Provider value={contextValue}>
      {children}
    </LaceFocusContext.Provider>
  );
}

/**
 * Hook to access the Lace focus context.
 * Must be used within a LaceFocusProvider.
 * 
 * @returns The focus context value
 * @throws Error if used outside of LaceFocusProvider
 */
export function useLaceFocusContext(): LaceFocusContextValue {
  const context = useContext(LaceFocusContext);
  if (!context) {
    throw new Error('useLaceFocusContext must be used within a LaceFocusProvider');
  }
  return context;
}