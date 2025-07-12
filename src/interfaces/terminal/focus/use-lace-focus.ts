// ABOUTME: Custom React hook for component-level focus management in terminal UI
// ABOUTME: Bridges Ink's useFocus with Lace's hierarchical focus stack system

import React from 'react';
import { useFocus } from 'ink';
import { useLaceFocusContext } from '~/interfaces/terminal/focus/focus-provider';
import { logger } from '~/utils/logger';

/**
 * Options for configuring focus behavior
 */
interface UseLaceFocusOptions {
  /**
   * Whether this component should automatically receive focus when mounted
   * @default false
   */
  autoFocus?: boolean;
}

/**
 * Return value from useLaceFocus hook
 */
interface UseLaceFocusResult {
  /**
   * Whether this component is currently focused.
   * Combines Ink's focus state with Lace's focus stack.
   */
  isFocused: boolean;

  /**
   * Push this component's focus ID onto the stack and focus it.
   * Use this when the component should become the active focus context.
   */
  takeFocus: () => void;

  /**
   * Check if this component's focus ID is anywhere in the focus stack.
   * Useful for components that should show different states when in the focus hierarchy.
   */
  isInFocusPath: boolean;
}

/**
 * Custom hook for managing component focus within Lace's hierarchical focus system.
 *
 * This hook:
 * - Registers the component with Ink's focus system
 * - Combines Ink's focus state with Lace's focus stack
 * - Provides methods to participate in focus navigation
 * - Handles the interaction between flat (Ink) and hierarchical (Lace) focus
 *
 * @param id - Unique focus identifier for this component
 * @param options - Configuration options for focus behavior
 * @returns Object with focus state and control methods
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isFocused, takeFocus } = useLaceFocus('my-component');
 *
 *   useInput((input, key) => {
 *     if (!isFocused) return;
 *     // Handle keyboard input only when focused
 *   }, { isActive: isFocused });
 *
 *   return <Box>...</Box>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * function ModalComponent({ isOpen }) {
 *   const { takeFocus } = useLaceFocus('modal-approval');
 *
 *   useEffect(() => {
 *     if (isOpen) {
 *       takeFocus(); // Auto-focus when modal opens
 *     }
 *   }, [isOpen, takeFocus]);
 *
 *   return isOpen ? <Box>...</Box> : null;
 * }
 * ```
 */
export function useLaceFocus(id: string, options: UseLaceFocusOptions = {}): UseLaceFocusResult {
  const { autoFocus = false } = options;
  const { pushFocus, getFocusStack, isFocusActive } = useLaceFocusContext();

  // Register with Ink's focus system
  const { isFocused: inkIsFocused } = useFocus({
    id,
    autoFocus,
  });

  // A component is truly focused when both:
  // 1. Ink considers it focused (it's the active component)
  // 2. Lace's focus stack has it as the current focus
  const isFocused = inkIsFocused && isFocusActive(id);

  // Debug logging for focus state
  React.useEffect(() => {
    logger.debug(`useLaceFocus[${id}]: Focus state changed`, {
      id,
      inkIsFocused,
      isFocusActive: isFocusActive(id),
      isFocused,
      focusStack: getFocusStack(),
      // Add debugging for Ink registration
      autoFocus: autoFocus,
    });
  }, [id, inkIsFocused, isFocusActive, isFocused, getFocusStack, autoFocus]);

  // Check if this component's ID is anywhere in the focus stack
  const focusStack = getFocusStack();
  const isInFocusPath = focusStack.includes(id);

  /**
   * Push this component's focus ID onto the stack and make it active
   */
  const takeFocus = React.useCallback(() => {
    pushFocus(id);
  }, [pushFocus, id]);

  return {
    isFocused,
    takeFocus,
    isInFocusPath,
  };
}
