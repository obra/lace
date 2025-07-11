// ABOUTME: Modal wrapper component for automatic focus management in terminal UI
// ABOUTME: Thin wrapper around FocusLifecycleWrapper with modal-specific behavior

import React, { ReactNode } from 'react';
import { FocusLifecycleWrapper } from '~/interfaces/terminal/focus/focus-lifecycle-wrapper.js';

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
 * - Hides content when modal is closed (modal-specific behavior)
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
  return (
    <FocusLifecycleWrapper
      focusId={focusId}
      isActive={isOpen}
      renderWhenInactive={false}
      autoFocus={true}
      onFocusActivated={onFocusActivated}
      onFocusRestored={onFocusRestored}
    >
      {children}
    </FocusLifecycleWrapper>
  );
}
