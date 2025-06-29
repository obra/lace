// ABOUTME: Generic focus lifecycle management wrapper for terminal UI components
// ABOUTME: Handles automatic focus stack push/pop based on isActive state changes

import React, { useEffect, ReactNode } from 'react';
import { useLaceFocusContext } from './focus-provider.js';
import { logger } from '../../../utils/logger.js';

/**
 * Props for the FocusLifecycleWrapper component
 */
interface FocusLifecycleWrapperProps {
  /**
   * Unique focus ID for this component
   */
  focusId: string;
  
  /**
   * Whether the component should be focused (generic trigger)
   */
  isActive: boolean;
  
  /**
   * The content to render
   */
  children: ReactNode;
  
  /**
   * Whether to render children when inactive
   * - true: always render children (for timeline items)
   * - false: hide children when inactive (for modals)
   */
  renderWhenInactive?: boolean;
  
  /**
   * Optional callback when focus is activated
   */
  onFocusActivated?: () => void;
  
  /**
   * Optional callback when focus is restored to previous context
   */
  onFocusRestored?: () => void;
}

/**
 * A wrapper component that automatically manages focus lifecycle for any component.
 * 
 * This component:
 * - Automatically pushes focus onto the stack when isActive becomes true
 * - Automatically pops focus from the stack when isActive becomes false
 * - Ensures proper cleanup if the component unmounts while active
 * - Provides callbacks for focus lifecycle events
 * - Supports both modal-style (hide when inactive) and persistent rendering
 * 
 * The focus management is tied to the `isActive` prop, making it reusable
 * for modals, timeline items, and other focusable components.
 * 
 * @example Modal usage
 * ```tsx
 * function MyModal({ isVisible, onClose }) {
 *   return (
 *     <FocusLifecycleWrapper 
 *       focusId="my-modal" 
 *       isActive={isVisible}
 *       renderWhenInactive={false}
 *       onFocusRestored={onClose}
 *     >
 *       <Box>Modal content</Box>
 *     </FocusLifecycleWrapper>
 *   );
 * }
 * ```
 * 
 * @example Timeline item usage
 * ```tsx
 * function FocusableTimelineItem({ isFocused }) {
 *   return (
 *     <FocusLifecycleWrapper 
 *       focusId="timeline-item-123" 
 *       isActive={isFocused}
 *       renderWhenInactive={true}
 *     >
 *       <Box>Always visible timeline content</Box>
 *     </FocusLifecycleWrapper>
 *   );
 * }
 * ```
 */
export function FocusLifecycleWrapper({
  focusId,
  isActive,
  children,
  renderWhenInactive = false,
  onFocusActivated,
  onFocusRestored,
}: FocusLifecycleWrapperProps) {
  const { pushFocus, popFocus } = useLaceFocusContext();

  // Handle focus lifecycle when active state changes
  useEffect(() => {
    logger.debug('FocusLifecycleWrapper: useEffect triggered', {
      focusId,
      isActive,
    });
    
    if (isActive) {
      // Component is becoming active - push focus
      logger.debug('FocusLifecycleWrapper: calling pushFocus', {
        focusId,
      });
      pushFocus(focusId);
      onFocusActivated?.();
      
      // Return cleanup function for when component becomes inactive
      return () => {
        logger.debug('FocusLifecycleWrapper: cleanup - calling popFocus', {
          focusId,
        });
        const restoredFocus = popFocus();
        if (restoredFocus) {
          onFocusRestored?.();
        }
      };
    }
    
    // If component is not active, no cleanup needed
    return undefined;
  }, [isActive, focusId, pushFocus, popFocus, onFocusActivated, onFocusRestored]);

  // Render children based on renderWhenInactive setting
  if (!isActive && !renderWhenInactive) {
    return null;
  }

  return <React.Fragment>{children}</React.Fragment>;
}