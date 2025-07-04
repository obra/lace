// ABOUTME: State management for delegate tool renderer including focus and nested expansion
// ABOUTME: Handles complex state coordination between main tool, focus regions, and delegation timeline

import { useState, useCallback } from 'react';
import { useInput } from 'ink';
import { useToolState } from './useToolState.js';
import { useLaceFocus, FocusRegions } from '../../../../focus/index.js';
import { useTimelineItemFocusEntry } from '../../hooks/useTimelineExpansionToggle.js';
import { logger } from '../../../../../../utils/logger.js';

export interface DelegateToolState {
  // Base tool state
  baseState: ReturnType<typeof useToolState>;

  // Focus state
  isEntered: boolean;
  isFocused: boolean;
  focusId: string;
  setIsEntered: (entered: boolean) => void;

  // Delegation expansion
  delegationExpanded: boolean;
  setDelegationExpanded: (expanded: boolean) => void;

  // Handlers
  handleFocusEntry: () => void;
}

export function useDelegateToolState(
  delegateThreadId: string | null,
  isSelected: boolean = false,
  onToggle?: () => void
): DelegateToolState {
  // Base tool state
  const baseState = useToolState(isSelected, onToggle);

  // Focus state management
  const [isEntered, setIsEntered] = useState(false);
  const focusId = delegateThreadId ? FocusRegions.delegate(delegateThreadId) : 'none';
  const { isFocused } = useLaceFocus(focusId, { autoFocus: false });

  // Delegation expansion state
  const [delegationExpanded, setDelegationExpanded] = useState(true);

  // Handle keyboard input when focused
  useInput(
    (input: string, key: { escape?: boolean }) => {
      if (!isFocused) return;

      if (key.escape) {
        logger.debug('DelegateToolRenderer: Escape pressed, exiting delegate focus');
        setIsEntered(false);
        return;
      }

      // Let embedded TimelineViewport handle navigation keys
    },
    { isActive: isFocused }
  );

  // Handle focus entry
  const handleFocusEntry = useCallback(() => {
    logger.debug('DelegateToolRenderer: handleFocusEntry called', {
      delegateThreadId,
    });
    if (delegateThreadId) {
      setIsEntered(true);
      logger.debug('DelegateToolRenderer: setIsEntered(true) called via event', {
        delegateThreadId,
        focusId: FocusRegions.delegate(delegateThreadId),
      });
    } else {
      logger.warn('DelegateToolRenderer: handleFocusEntry called but no delegateThreadId');
    }
  }, [delegateThreadId, focusId]);

  // Listen for focus entry events
  useTimelineItemFocusEntry(isSelected, handleFocusEntry);

  return {
    baseState,
    isEntered,
    isFocused,
    focusId,
    setIsEntered,
    delegationExpanded,
    setDelegationExpanded,
    handleFocusEntry,
  };
}
