// ABOUTME: Custom hook for managing view state (scroll position, view mode)
// ABOUTME: Handles view coordination between conversation and log modes

import { useState } from "react";

type ViewMode = 'conversation' | 'log';

interface ViewState {
  scrollPosition: number;
  viewMode: ViewMode;
  totalMessages: number;
}

interface ViewActions {
  setScrollPosition: (position: number | ((prev: number) => number)) => void;
  setViewMode: (mode: ViewMode | ((prev: ViewMode) => ViewMode)) => void;
  setTotalMessages: (total: number) => void;
  toggleViewMode: () => void;
  resetScrollPosition: () => void;
  scrollUp: () => void;
  scrollDown: () => void;
}

export const useViewState = () => {
  const [scrollPosition, setScrollPosition] = useState<number>(0);
  const [viewMode, setViewMode] = useState<ViewMode>('conversation');
  const [totalMessages, setTotalMessages] = useState<number>(0);

  const updateScrollPosition = (position: number | ((prev: number) => number)) => {
    if (typeof position === 'function') {
      setScrollPosition(prev => {
        const newPos = position(prev);
        return Math.max(0, Math.min(newPos, totalMessages - 1));
      });
    } else {
      setScrollPosition(Math.max(0, Math.min(position, totalMessages - 1)));
    }
  };

  const toggleViewMode = () => {
    setViewMode(prev => prev === 'conversation' ? 'log' : 'conversation');
  };

  const resetScrollPosition = () => {
    setScrollPosition(0);
  };

  const scrollUp = () => {
    updateScrollPosition(prev => prev - 1);
  };

  const scrollDown = () => {
    updateScrollPosition(prev => prev + 1);
  };

  const state: ViewState = {
    scrollPosition,
    viewMode,
    totalMessages,
  };

  const actions: ViewActions = {
    setScrollPosition: updateScrollPosition,
    setViewMode,
    setTotalMessages,
    toggleViewMode,
    resetScrollPosition,
    scrollUp,
    scrollDown,
  };

  return { ...state, ...actions };
};

export default useViewState;