// ABOUTME: React context provider for hierarchical focus management in terminal UI
// ABOUTME: Wraps Ink's focus system with stack-based navigation and global keyboard handling

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { useFocusManager, useInput } from 'ink';
import { FocusStack } from './focus-stack.js';
import { FocusRegions } from './focus-regions.js';

/**
 * Context value interface for Lace focus management
 */
interface LaceFocusContextValue {
  /**
   * Current focus ID at the top of the stack
   */
  currentFocus: string;
  
  /**
   * Push a new focus context onto the stack and focus it
   * @param focusId - The focus ID to push and focus
   */
  pushFocus: (focusId: string) => void;
  
  /**
   * Pop the current focus context and return to the previous one
   * @returns The new current focus ID, or undefined if no change
   */
  popFocus: () => string | undefined;
  
  /**
   * Get the current focus stack for debugging
   * @returns Copy of the current focus stack
   */
  getFocusStack: () => string[];
  
  /**
   * Check if a specific focus ID is currently active
   * @param focusId - The focus ID to check
   * @returns True if the focus ID is currently active
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

  // Disable Ink's automatic Tab cycling to prevent conflicts with autocomplete
  useEffect(() => {
    inkFocus.disableFocus();
  }, [inkFocus]);

  /**
   * Push a new focus onto the stack and update Ink's focus
   */
  const pushFocus = useCallback((focusId: string) => {
    const newFocus = focusStack.push(focusId);
    setCurrentFocus(newFocus);
    inkFocus.focus(focusId);
  }, [inkFocus, focusStack]);

  /**
   * Pop the current focus and return to the previous one
   */
  const popFocus = useCallback(() => {
    const newFocus = focusStack.pop();
    if (newFocus) {
      setCurrentFocus(newFocus);
      inkFocus.focus(newFocus);
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

  // Global Escape key handler for hierarchical navigation
  useInput(useCallback((input, key) => {
    if (key.escape) {
      popFocus();
    }
  }, [popFocus]));

  const contextValue: LaceFocusContextValue = {
    currentFocus,
    pushFocus,
    popFocus,
    getFocusStack,
    isFocusActive,
  };

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