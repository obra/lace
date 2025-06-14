// ABOUTME: Enhanced input component that handles both text editing and message navigation
// ABOUTME: Wraps ShellInput with navigation key handlers for j/k, space, c/a, /, n/N navigation

import React from "react";
import { useInput } from "ink";
import ShellInput from "../ShellInput";
import { CompletionManager } from "../../completion/index.js";

interface NavigationInputProps {
  // ShellInput props
  value?: string;
  placeholder?: string;
  focusId?: string;
  autoFocus?: boolean;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
  history?: string[];
  showDebug?: boolean;
  completionManager?: CompletionManager;
  
  // Navigation state
  isNavigationMode: boolean;
  toolApprovalRequest: any;
  scrollPosition: number;
  totalMessages: number;
  filteredConversation: any[];
  filterMode: string;
  searchResults: any[];
  searchResultIndex: number;
  
  // Navigation callbacks
  onNavigationScroll: (position: number) => void;
  onToggleFold: (message: any) => void;
  onFilterModeChange: (mode: string) => void;
  onSearchModeEnter: () => void;
  onSearchNavigation: (direction: 'next' | 'prev') => void;
  onExitNavigation: () => void;
  onFocusSearch: () => void;
}

export const NavigationInput: React.FC<NavigationInputProps> = ({
  // ShellInput props
  value,
  placeholder,
  focusId,
  autoFocus,
  onSubmit,
  onChange,
  history,
  showDebug,
  completionManager,
  
  // Navigation state
  isNavigationMode,
  toolApprovalRequest,
  scrollPosition,
  totalMessages,
  filteredConversation,
  filterMode,
  searchResults,
  searchResultIndex,
  
  // Navigation callbacks
  onNavigationScroll,
  onToggleFold,
  onFilterModeChange,
  onSearchModeEnter,
  onSearchNavigation,
  onExitNavigation,
  onFocusSearch,
}) => {
  // Navigation mode handlers (only when navigation is active)
  useInput((input, key) => {
    if (isNavigationMode && !toolApprovalRequest) {
      if (input === "j" || key.downArrow) {
        // Scroll down
        const newPosition = Math.min(scrollPosition + 1, totalMessages - 1);
        onNavigationScroll(newPosition);
      } else if (input === "k" || key.upArrow) {
        // Scroll up
        const newPosition = Math.max(scrollPosition - 1, 0);
        onNavigationScroll(newPosition);
      } else if (input === " ") {
        // Toggle fold state
        const currentMessage = filteredConversation[scrollPosition];
        if (currentMessage && currentMessage.type === "agent_activity") {
          onToggleFold(currentMessage);
        }
      } else if (input === "c") {
        // Conversation filter mode
        onFilterModeChange("conversation");
      } else if (input === "a") {
        // Show all mode
        onFilterModeChange("all");
      } else if (input === "/") {
        // Enter search mode
        onSearchModeEnter();
        onFocusSearch();
      } else if (
        input === "n" &&
        filterMode === "search" &&
        searchResults.length > 0
      ) {
        // Next search result
        onSearchNavigation('next');
      } else if (
        input === "N" &&
        filterMode === "search" &&
        searchResults.length > 0
      ) {
        // Previous search result
        onSearchNavigation('prev');
      }
      return; // Navigation mode consumes all input
    }
  }, { isActive: isNavigationMode && !toolApprovalRequest });

  return (
    <ShellInput
      value={value}
      placeholder={placeholder}
      focusId={focusId}
      autoFocus={autoFocus}
      onSubmit={onSubmit}
      onChange={onChange}
      history={history}
      showDebug={showDebug}
      completionManager={completionManager}
    />
  );
};

export default NavigationInput;