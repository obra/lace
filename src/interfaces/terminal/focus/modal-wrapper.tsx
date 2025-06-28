// ABOUTME: Modal wrapper component for automatic focus management in terminal UI
// ABOUTME: Handles focus stack push/pop lifecycle for modal components

import React, { useEffect, ReactNode } from 'react';
import { useLaceFocusContext } from './focus-provider.js';

/**
 * Props for the ModalWrapper component
 */
interface ModalWrapperProps {
  /**
   * Unique focus ID for this modal
   */
  focusId: string;
  
  /**
   * Whether the modal is currently open/visible
   */
  isOpen: boolean;
  
  /**
   * The modal content to render
   */
  children: ReactNode;
  
  /**
   * Optional callback when modal focus is activated
   */
  onFocusActivated?: () => void;
  
  /**
   * Optional callback when modal focus is restored to previous context
   */
  onFocusRestored?: () => void;
}

/**
 * A wrapper component that automatically manages focus lifecycle for modal components.
 * 
 * This component:
 * - Automatically pushes focus onto the stack when the modal opens
 * - Automatically pops focus from the stack when the modal closes
 * - Ensures proper cleanup if the component unmounts while open
 * - Provides callbacks for focus lifecycle events
 * 
 * The focus management is tied to the `isOpen` prop, making it easy to integrate
 * with existing modal state management.
 * 
 * @example
 * ```tsx
 * function MyModal({ isVisible, onClose }) {
 *   return (
 *     <ModalWrapper 
 *       focusId="my-modal" 
 *       isOpen={isVisible}
 *       onFocusRestored={onClose}
 *     >
 *       <Box>
 *         <Text>Modal content here</Text>
 *       </Box>
 *     </ModalWrapper>
 *   );
 * }
 * ```
 * 
 * @example
 * ```tsx
 * function ApprovalModal({ request, onDecision }) {
 *   const isOpen = request !== null;
 *   
 *   return (
 *     <ModalWrapper 
 *       focusId={FocusRegions.modal('approval')} 
 *       isOpen={isOpen}
 *     >
 *       {isOpen && (
 *         <ApprovalForm 
 *           request={request} 
 *           onDecision={onDecision} 
 *         />
 *       )}
 *     </ModalWrapper>
 *   );
 * }
 * ```
 */
export function ModalWrapper({
  focusId,
  isOpen,
  children,
  onFocusActivated,
  onFocusRestored,
}: ModalWrapperProps) {
  const { pushFocus, popFocus } = useLaceFocusContext();

  // Handle focus lifecycle when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Modal is opening - push focus
      pushFocus(focusId);
      onFocusActivated?.();
      
      // Return cleanup function for when modal closes
      return () => {
        const restoredFocus = popFocus();
        if (restoredFocus) {
          onFocusRestored?.();
        }
      };
    }
    
    // If modal is not open, no cleanup needed
    return undefined;
  }, [isOpen, focusId, pushFocus, popFocus, onFocusActivated, onFocusRestored]);

  // Only render children when modal is open
  if (!isOpen) {
    return null;
  }

  return <React.Fragment>{children}</React.Fragment>;
}