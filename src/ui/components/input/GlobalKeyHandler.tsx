// ABOUTME: Invisible component that handles global keyboard shortcuts
// ABOUTME: Manages Ctrl+C, Ctrl+L, Escape key handling with callback functions

import React, { useRef, useState } from "react";
import { useInput } from "ink";

interface GlobalKeyHandlerProps {
  // Processing state
  isLoading: boolean;
  isStreaming: boolean;
  
  // Navigation state
  isNavigationMode: boolean;
  toolApprovalRequest: any;
  
  // Callbacks for global actions
  onAbort: () => boolean; // Should return true if abort succeeded
  onToggleView: () => void;
  onExitNavigation: () => void;
  onCancelledMessage: (message: string) => void;
  
  // Focus management
  onFocusTextEditor: () => void;
}

export const GlobalKeyHandler: React.FC<GlobalKeyHandlerProps> = ({
  isLoading,
  isStreaming,
  isNavigationMode,
  toolApprovalRequest,
  onAbort,
  onToggleView,
  onExitNavigation,
  onCancelledMessage,
  onFocusTextEditor,
}) => {
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const ctrlCTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useInput((input, key) => {
    // Handle Ctrl+C with proper logic
    if (key.ctrl && input === "c") {
      // If processing, abort and reset counter
      if (isLoading || isStreaming) {
        const aborted = onAbort();
        if (aborted) {
          onCancelledMessage("Operation cancelled by user (Ctrl+C)");
          setCtrlCCount(0);
          if (ctrlCTimeoutRef.current) {
            clearTimeout(ctrlCTimeoutRef.current);
          }
          return;
        }
      }

      // Handle exit logic
      setCtrlCCount((prev) => prev + 1);

      if (ctrlCCount === 0) {
        console.log("\nPress Ctrl+C again to exit...");
        if (ctrlCTimeoutRef.current) {
          clearTimeout(ctrlCTimeoutRef.current);
        }
        ctrlCTimeoutRef.current = setTimeout(() => {
          setCtrlCCount(0);
        }, 2000);
      } else {
        process.exit(0);
      }
      return;
    }

    // Global Ctrl+L handler for toggling view mode
    if (key.ctrl && input === "l") {
      onToggleView();
      return;
    }

    // Global Escape handler for aborting processing (but not navigation)
    if (key.escape && (isLoading || isStreaming)) {
      const aborted = onAbort();
      if (aborted) {
        onCancelledMessage("Operation cancelled by user (Esc)");
        return;
      }
    }

    // Navigation mode escape/quit handler (only when navigation is active)
    if (isNavigationMode && !toolApprovalRequest) {
      if (key.escape || input === "q") {
        onExitNavigation();
        onFocusTextEditor();
        return;
      }
    }
  });

  return null; // Invisible component that just handles global keys
};

export default GlobalKeyHandler;