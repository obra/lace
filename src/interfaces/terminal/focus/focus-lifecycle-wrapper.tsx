// ABOUTME: Generic focus lifecycle management wrapper for terminal UI components
// ABOUTME: Handles automatic focus stack push/pop based on isActive state changes

import React, { useEffect, ReactNode, useRef } from 'react';
import { useLaceFocusContext } from './focus-provider.js';
import { useLaceFocus } from './use-lace-focus.js';
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
   * Whether to automatically take focus when becoming active
   * - true: automatically focus when isActive becomes true (for modals)
   * - false: only push onto focus stack, don't auto-focus (default)
   */
  autoFocus?: boolean;
  
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
  autoFocus = false,
  onFocusActivated,
  onFocusRestored,
}: FocusLifecycleWrapperProps) {
  const { pushFocus, popFocus } = useLaceFocusContext();
  const { takeFocus } = useLaceFocus(focusId);
  const cleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef(isActive);
  
  // Update ref to track current active state
  isActiveRef.current = isActive;

  // Handle focus lifecycle when active state changes
  useEffect(() => {
    logger.debug('FocusLifecycleWrapper: useEffect triggered', {
      focusId,
      isActive,
    });
    
    // Clear any pending cleanup
    if (cleanupTimeoutRef.current) {
      clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }
    
    if (isActive) {
      // Component is becoming active - push focus
      logger.debug('FocusLifecycleWrapper: calling pushFocus', {
        focusId,
        autoFocus,
      });
      pushFocus(focusId);
      
      // Auto-focus if requested
      if (autoFocus) {
        logger.debug('FocusLifecycleWrapper: auto-focusing component', {
          focusId,
        });
        takeFocus();
      }
      
      onFocusActivated?.();
      
      // Return cleanup function for when component becomes inactive
      return () => {
        // Add small delay to prevent immediate cleanup during re-render cycles
        cleanupTimeoutRef.current = setTimeout(() => {
          // Only cleanup if still inactive after delay
          if (!isActiveRef.current) {
            logger.debug('FocusLifecycleWrapper: delayed cleanup - calling popFocus', {
              focusId,
            });
            const restoredFocus = popFocus();
            if (restoredFocus) {
              onFocusRestored?.();
            }
          } else {
            logger.debug('FocusLifecycleWrapper: cleanup cancelled - component became active again', {
              focusId,
            });
          }
          cleanupTimeoutRef.current = null;
        }, 10); // 10ms delay to survive React re-render cycles
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