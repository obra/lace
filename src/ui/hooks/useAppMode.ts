// ABOUTME: Custom hook for managing application mode state (normal, navigation, search)
// ABOUTME: Provides mode coordination and filter state management for cross-cutting concerns

import { useState } from "react";

type AppMode = 'normal' | 'navigation' | 'search';
type FilterMode = 'all' | 'conversation' | 'search';

interface AppModeState {
  mode: AppMode;
  filterMode: FilterMode;
  searchTerm: string;
  searchResultIndex: number;
}

interface AppModeActions {
  enterNavigationMode: () => void;
  enterSearchMode: () => void;
  exitToNormalMode: () => void;
  setFilterMode: (mode: FilterMode) => void;
  setSearchTerm: (term: string) => void;
  setSearchResultIndex: (index: number) => void;
  resetScrollPosition: () => void;
}

export const useAppMode = () => {
  const [mode, setMode] = useState<AppMode>('normal');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchResultIndex, setSearchResultIndex] = useState<number>(0);

  const enterNavigationMode = () => {
    setMode('navigation');
  };

  const enterSearchMode = () => {
    setMode('search');
    setFilterMode('search');
    setSearchTerm('');
    setSearchResultIndex(0);
  };

  const exitToNormalMode = () => {
    setMode('normal');
    if (filterMode === 'search') {
      setFilterMode('all');
    }
  };

  const updateFilterMode = (newMode: FilterMode) => {
    setFilterMode(newMode);
    setSearchResultIndex(0);
  };

  const updateSearchTerm = (term: string) => {
    setSearchTerm(term);
    setSearchResultIndex(0);
  };

  const updateSearchResultIndex = (index: number) => {
    setSearchResultIndex(index);
  };

  const resetScrollPosition = () => {
    setSearchResultIndex(0);
  };

  const state: AppModeState = {
    mode,
    filterMode,
    searchTerm,
    searchResultIndex,
  };

  const actions: AppModeActions = {
    enterNavigationMode,
    enterSearchMode,
    exitToNormalMode,
    setFilterMode: updateFilterMode,
    setSearchTerm: updateSearchTerm,
    setSearchResultIndex: updateSearchResultIndex,
    resetScrollPosition,
  };

  return { ...state, ...actions };
};

export default useAppMode;