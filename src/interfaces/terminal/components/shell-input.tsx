// ABOUTME: Simple text editor input with multi-line editing capabilities
// ABOUTME: Handles keyboard input and manages text buffer state

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Box, Text, useInput, useFocus, useFocusManager } from "ink";
import { useTextBuffer } from "../hooks/use-text-buffer.js";
import TextRenderer from "./text-renderer.js";
import FileAutocomplete from "./file-autocomplete.js";
import { logger } from "../../../utils/logger.js";

// Keyboard shortcut system - list-based approach
type KeyboardShortcut = string[];  // e.g., ['ctrl', 'a'] or ['meta', 'shift', 'z']

const KEYBOARD_SHORTCUTS: Record<string, KeyboardShortcut | KeyboardShortcut[]> = {
  MOVE_TO_START: ['ctrl', 'a'],
  MOVE_TO_END: ['ctrl', 'e'],
  KILL_LINE: ['ctrl', 'k'],
  KILL_LINE_BACKWARD: ['ctrl', 'u'],
  DELETE_FORWARD: ['ctrl', 'd'],
  DELETE_BACKWARD: ['ctrl', 'h'],
  PASTE: [
    ['ctrl', 'v'],   // Non-Mac
    ['meta', 'v']    // Mac  
  ]
};

const matchesShortcut = (input: string, key: any, shortcut: KeyboardShortcut): boolean => {
  // Last element is the key, everything else are modifiers
  const keyChar = shortcut[shortcut.length - 1];
  const modifiers = shortcut.slice(0, -1);
  
  if (input !== keyChar) {
    return false;
  }
  
  // Check that all required modifiers are pressed
  for (const modifier of modifiers) {
    if (!key[modifier]) {
      return false;
    }
  }
  
  // Check that no extra modifiers are pressed
  const allModifiers = ['ctrl', 'meta', 'alt', 'shift'];
  for (const modifier of allModifiers) {
    if (!modifiers.includes(modifier) && key[modifier]) {
      return false;
    }
  }
  
  return true;
};

const matchesAction = (input: string, key: any, action: string): boolean => {
  const shortcuts = KEYBOARD_SHORTCUTS[action];
  if (Array.isArray(shortcuts) && Array.isArray(shortcuts[0])) {
    // Multiple shortcuts (KeyboardShortcut[])
    return shortcuts.some(shortcut => matchesShortcut(input, key, shortcut as KeyboardShortcut));
  } else {
    // Single shortcut (KeyboardShortcut)
    return matchesShortcut(input, key, shortcuts as KeyboardShortcut);
  }
};

interface ShellInputProps {
  value?: string;
  placeholder?: string;
  focusId?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
  focusWithHistory?: (focusId: string) => void;
}

const ShellInput: React.FC<ShellInputProps> = ({
  value = "",
  placeholder = "Type your message...",
  focusId = "text-editor",
  autoFocus = false,
  disabled = false,
  onSubmit,
  onChange,
  focusWithHistory,
}) => {
  // Safe focus handling - avoid useFocus in test environments where raw mode may not work reliably
  const [isFocused, setIsFocused] = useState(autoFocus);

  // Only use useFocus if we're in a real terminal environment
  const useRealFocus =
    process.env.NODE_ENV !== "test" &&
    typeof process.stdin?.isTTY === "boolean" &&
    process.stdin.isTTY;

  const focusResult = useRealFocus
    ? useFocus({ id: focusId, autoFocus: autoFocus && !disabled })
    : null;
  const actualIsFocused = useRealFocus ? focusResult?.isFocused : isFocused && !disabled;
  
  // Debug focus changes
  useEffect(() => {
    logger.debug('ShellInput: Focus changed', {
      focusId,
      actualIsFocused,
      useRealFocus,
      focusResultIsFocused: focusResult?.isFocused,
      manualIsFocused: isFocused,
      disabled
    });
  }, [actualIsFocused, focusId, useRealFocus, focusResult?.isFocused, isFocused, disabled]);
  const { focus, enableFocus, disableFocus } = useFocusManager();
  const [bufferState, bufferOps] = useTextBuffer(value);

  // Autocomplete state - use single state object to prevent multiple re-renders
  const [autocompleteState, setAutocompleteState] = useState({
    visible: false,
    query: "",
    selectedIndex: 0,
    items: [] as string[],
    originalItems: [] as string[]
  });
  
  // Destructure for backwards compatibility
  const autocompleteVisible = autocompleteState.visible;
  const autocompleteQuery = autocompleteState.query;
  const autocompleteSelectedIndex = autocompleteState.selectedIndex;
  const autocompleteItems = autocompleteState.items;
  const autocompleteOriginalItems = autocompleteState.originalItems;

  // Only sync external value changes on first mount or significant changes
  const [lastExternalValue, setLastExternalValue] = useState(value);

  useEffect(() => {
    // Only update if the external value changed significantly (not from our onChange)
    if (value !== lastExternalValue && value !== bufferOps.getText()) {
      bufferOps.setText(value);
      setLastExternalValue(value);
    }
  }, [value, lastExternalValue, bufferOps]);

  // Debounced onChange to reduce conflicts
  const notifyChange = useCallback(
    (newText: string) => {
      if (onChange && newText !== value) {
        setLastExternalValue(newText); // Pre-mark as our change
        onChange(newText);
      }
    },
    [onChange, value],
  );

  // Notify parent when buffer actually changes
  useEffect(() => {
    const currentText = bufferOps.getText();
    notifyChange(currentText);
  }, [bufferState.lines, notifyChange, bufferOps]);

  // Autocomplete helper methods
  const getCurrentWord = useCallback(() => {
    const currentLine = bufferState.lines[bufferState.cursorLine] || '';
    const cursorPos = bufferState.cursorColumn;
    
    // Find word boundaries (spaces, quotes, etc.)
    let start = cursorPos;
    let end = cursorPos;
    
    // Move start backward to find beginning of word
    while (start > 0 && !/\s/.test(currentLine[start - 1])) {
      start--;
    }
    
    // Move end forward to find end of word
    while (end < currentLine.length && !/\s/.test(currentLine[end])) {
      end++;
    }
    
    return {
      word: currentLine.slice(start, end),
      start,
      end,
      beforeCursor: currentLine.slice(start, cursorPos)
    };
  }, [bufferState.cursorLine, bufferState.cursorColumn, bufferState.lines]);

  const handleAutocompleteSelect = useCallback((completion: string) => {
    const { start, end } = getCurrentWord();
    const currentLine = bufferState.lines[bufferState.cursorLine] || '';
    
    // Replace the current word with the completion (trim any extra spaces)
    const cleanCompletion = completion.trim();
    const newLine = currentLine.slice(0, start) + cleanCompletion + currentLine.slice(end);
    const newLines = [...bufferState.lines];
    newLines[bufferState.cursorLine] = newLine;
    
    bufferOps.setText(newLines.join('\n'));
    bufferOps.setCursorPosition(bufferState.cursorLine, start + cleanCompletion.length);
    
    setAutocompleteState(prev => ({ ...prev, visible: false }));
  }, [bufferState, bufferOps, getCurrentWord]);

  const showAutocomplete = useCallback(async () => {
    const { beforeCursor } = getCurrentWord();
    const currentLine = bufferState.lines[bufferState.cursorLine] || '';
    const trimmedLine = currentLine.trim();
    
    setAutocompleteState(prev => ({ 
      ...prev, 
      query: beforeCursor, 
      selectedIndex: 0, 
      visible: true 
    }));
    
    try {
      let completions: string[] = [];
      
      // Context-aware completion logic
      if (trimmedLine.startsWith('/') && bufferState.cursorLine === 0) {
        // Command completion at start of prompt
        const { CommandRegistry } = await import('../../../commands/registry.js');
        const registry = await CommandRegistry.createWithAutoDiscovery();
        const commands = registry.getAllCommands();
        
        const commandPrefix = beforeCursor.startsWith('/') ? beforeCursor.slice(1) : beforeCursor;
        completions = commands
          .filter(cmd => cmd.name.startsWith(commandPrefix))
          .map(cmd => `/${cmd.name}`);
      } else {
        // File/directory completion
        const { FileScanner } = await import('../utils/file-scanner.js');
        const scanner = new FileScanner();
        
        if (beforeCursor.startsWith('./')) {
          // Relative path from current directory
          const relativePath = beforeCursor.slice(2);
          completions = await scanner.getCompletions(relativePath);
          completions = completions.map(item => `./${item}`);
        } else {
          // Standard path completion (works for paths with "/", empty string, and prefix matching)
          completions = await scanner.getCompletions(beforeCursor);
        }
      }
      
      setAutocompleteState(prev => ({ 
        ...prev, 
        items: completions, 
        originalItems: completions 
      }));
    } catch (error) {
      console.error('Failed to load completions:', error);
      setAutocompleteState(prev => ({ 
        ...prev, 
        items: [], 
        originalItems: [] 
      }));
    }
  }, [getCurrentWord, bufferState.cursorLine, bufferState.lines]);

  const filterAutocompleteWithText = useCallback((beforeCursor: string) => {
    if (!autocompleteVisible || autocompleteOriginalItems.length === 0) {
      return;
    }
    
    // For directory completion, extract the directory prefix and the filter query
    const lastSlash = beforeCursor.lastIndexOf('/');
    const directoryPrefix = lastSlash >= 0 ? beforeCursor.slice(0, lastSlash + 1) : '';
    const filterQuery = lastSlash >= 0 ? beforeCursor.slice(lastSlash + 1) : beforeCursor;
    
    // Filter original items based on the query
    const filtered = autocompleteOriginalItems.filter(item => {
      // Extract the name part after the directory prefix
      let itemName = item;
      if (directoryPrefix && item.startsWith(directoryPrefix)) {
        itemName = item.slice(directoryPrefix.length);
        // Remove trailing slash for directory names when filtering
        if (itemName.endsWith('/')) {
          itemName = itemName.slice(0, -1);
        }
      }
      
      const matches = itemName.toLowerCase().includes(filterQuery.toLowerCase());
      return matches;
    });
    setAutocompleteState(prev => ({ 
      ...prev, 
      items: filtered, 
      selectedIndex: 0 
    }));
  }, [autocompleteVisible, autocompleteOriginalItems]);

  const filterAutocomplete = useCallback(() => {
    const { beforeCursor } = getCurrentWord();
    filterAutocompleteWithText(beforeCursor);
  }, [getCurrentWord, filterAutocompleteWithText]);

  const hideAutocomplete = useCallback(() => {
    // Single state update to prevent multiple re-renders that confuse Ink's focus management
    setAutocompleteState({
      visible: false,
      query: "",
      selectedIndex: 0,
      items: [],
      originalItems: []
    });
  }, []);

  // Input handler
  useInput(
    (input, key) => {
      // Do nothing if disabled
      if (disabled) {
        return;
      }

      // Handle Tab key for autocomplete
      if (key.tab) {
        if (autocompleteVisible && autocompleteItems.length > 0) {
          // Apply the selected completion
          const selectedItem = autocompleteItems[autocompleteSelectedIndex];
          if (selectedItem) {
            handleAutocompleteSelect(selectedItem);
          }
        } else {
          // Only show autocomplete if there's meaningful content to complete
          const { beforeCursor } = getCurrentWord();
          const currentLine = bufferState.lines[bufferState.cursorLine] || '';
          const trimmedLine = currentLine.trim();
          
          // Don't trigger autocomplete if we're in completely empty content or just whitespace
          // Allow autocomplete if there's text before cursor OR if the line has any content
          if (beforeCursor.trim().length > 0 || trimmedLine.length > 0) {
            showAutocomplete();
          }
        }
        return;
      }

      // Handle Escape - close autocomplete or let global handler manage focus
      if (key.escape) {
        if (autocompleteVisible) {
          logger.debug('ShellInput: Escape pressed - closing autocomplete', { 
            actualIsFocused, 
            autocompleteVisible, 
            focusId
          });
          hideAutocomplete();
          // Explicitly re-focus ShellInput since hideAutocomplete causes focus loss
          setTimeout(() => {
            logger.debug('ShellInput: Re-focusing after autocomplete close', { focusId });
            focus(focusId);
          }, 0);
          return;
        } else {
          logger.debug('ShellInput: Escape pressed - navigating to timeline', { 
            actualIsFocused, 
            focusId
          });
          // No autocomplete - navigate to timeline
          if (focusWithHistory) {
            focusWithHistory('timeline');
          } else {
            focus('timeline');
          }
          return;
        }
      }
      // Handle Enter - autocomplete selection or submit/newline
      if (key.return) {
        // If autocomplete is visible, select the highlighted item
        if (autocompleteVisible && autocompleteItems.length > 0) {
          const selectedItem = autocompleteItems[autocompleteSelectedIndex];
          if (selectedItem) {
            handleAutocompleteSelect(selectedItem);
          }
          return;
        }

        // Normal Enter handling
        const currentLine = bufferState.lines[bufferState.cursorLine] || "";
        const trimmedLine = currentLine.trim();

        if (trimmedLine.endsWith("\\")) {
          // Line ends with backslash - remove backslash and insert newline
          const lineWithoutBackslash = currentLine.replace(/\\(\s*)$/, "$1"); // Remove backslash but keep trailing whitespace
          const newLines = [...bufferState.lines];
          newLines[bufferState.cursorLine] = lineWithoutBackslash;
          newLines.splice(bufferState.cursorLine + 1, 0, ""); // Insert empty line after current
          bufferOps.setText(newLines.join("\n"));
          bufferOps.setCursorPosition(bufferState.cursorLine + 1, 0); // Move to start of next line
        } else {
          // Submit the message
          if (onSubmit) {
            onSubmit(bufferOps.getText());
          }
        }
        return;
      }

      // Right arrow applies completion like Tab
      if (key.rightArrow) {
        if (autocompleteVisible && autocompleteItems.length > 0) {
          // Apply the selected completion
          const selectedItem = autocompleteItems[autocompleteSelectedIndex];
          if (selectedItem) {
            handleAutocompleteSelect(selectedItem);
          }
        } else {
          bufferOps.moveCursor("right");
        }
        return;
      }

      // Navigation - these keys cancel autocomplete
      if (key.leftArrow || matchesAction(input, key, 'MOVE_TO_START') || matchesAction(input, key, 'MOVE_TO_END') ||
          matchesAction(input, key, 'KILL_LINE') || matchesAction(input, key, 'KILL_LINE_BACKWARD') || 
          matchesAction(input, key, 'DELETE_FORWARD') || matchesAction(input, key, 'DELETE_BACKWARD')) {
        
        if (autocompleteVisible) {
          hideAutocomplete();
        }
        
        // Execute the original navigation/editing command
        if (key.leftArrow) {
          bufferOps.moveCursor("left");
        } else if (matchesAction(input, key, 'MOVE_TO_START')) {
          bufferOps.moveCursor("home");
        } else if (matchesAction(input, key, 'MOVE_TO_END')) {
          bufferOps.moveCursor("end");
        } else if (matchesAction(input, key, 'KILL_LINE')) {
          bufferOps.killLine();
        } else if (matchesAction(input, key, 'KILL_LINE_BACKWARD')) {
          bufferOps.killLineBackward();
        } else if (matchesAction(input, key, 'DELETE_FORWARD')) {
          bufferOps.deleteChar("forward");
        } else if (matchesAction(input, key, 'DELETE_BACKWARD')) {
          bufferOps.deleteChar("backward");
        }
        return;
      }
      
      // Up/Down arrows for autocomplete navigation or cursor movement
      if (key.upArrow) {
        if (autocompleteVisible && autocompleteItems.length > 0) {
          setAutocompleteState(prev => ({ 
            ...prev, 
            selectedIndex: Math.max(0, prev.selectedIndex - 1) 
          }));
        } else {
          bufferOps.moveCursor("up");
        }
        return;
      }
      if (key.downArrow) {
        if (autocompleteVisible && autocompleteItems.length > 0) {
          setAutocompleteState(prev => ({ 
            ...prev, 
            selectedIndex: Math.min(autocompleteItems.length - 1, prev.selectedIndex + 1) 
          }));
        } else {
          bufferOps.moveCursor("down");
        }
        return;
      }

      // Paste functionality
      if (matchesAction(input, key, 'PASTE')) {
        // Ctrl+V on non-Mac, Cmd+V on Mac
        bufferOps.pasteFromClipboard().catch((error) => {
          console.warn('Paste operation failed:', error);
        });
        return;
      }

      // Deletion - filter autocomplete instead of canceling
      if (key.delete || key.backspace) {
        // Get the expected new text before performing deletion
        let newBeforeCursor = '';
        if (autocompleteVisible) {
          const { beforeCursor } = getCurrentWord();
          if (key.delete && beforeCursor.length > 0) {
            // Backspace: remove last character
            newBeforeCursor = beforeCursor.slice(0, -1);
          } else if (key.backspace) {
            // Forward delete: more complex, just use setTimeout for now
            newBeforeCursor = beforeCursor;
          }
        }
        
        if (key.delete) {
          bufferOps.deleteChar("backward");
        } else {
          bufferOps.deleteChar("forward");
        }
        
        // Filter autocomplete after deletion
        if (autocompleteVisible) {
          if (key.delete && newBeforeCursor !== '') {
            filterAutocompleteWithText(newBeforeCursor);
          } else {
            // For forward delete or edge cases, use setTimeout for deferred execution in Node.js
            setTimeout(() => {
              filterAutocomplete();
            }, 0);
          }
        }
        return;
      }

      // Regular character input - handle both single characters and paste (multi-character)
      if (input && input.length >= 1 && !key.ctrl && !key.meta) {
        bufferOps.insertText(input);
        
        // For single character input, filter autocomplete when typing
        if (input.length === 1 && autocompleteVisible) {
          // Get the expected new text and filter with it
          const { beforeCursor } = getCurrentWord();
          const newBeforeCursor = beforeCursor + input;
          filterAutocompleteWithText(newBeforeCursor);
        } else if (input.length > 1) {
          // For multi-character input (like paste), hide autocomplete
          hideAutocomplete();
        }
        return;
      }
    },
    { isActive: actualIsFocused },
  );

  // Calculate inline completion preview
  const inlineCompletion = useMemo(() => {
    if (!autocompleteVisible || autocompleteItems.length === 0) {
      return undefined;
    }
    
    const selectedItem = autocompleteItems[autocompleteSelectedIndex];
    if (!selectedItem) {
      return undefined;
    }
    
    const { beforeCursor } = getCurrentWord();
    // Show the remaining part of the completion after what's already typed
    const cleanSelectedItem = selectedItem.trim();
    const cleanBeforeCursor = beforeCursor.trim();
    
    if (cleanSelectedItem.startsWith(cleanBeforeCursor)) {
      const remaining = cleanSelectedItem.slice(cleanBeforeCursor.length);
      return remaining;
    }
    
    return undefined;
  }, [autocompleteVisible, autocompleteItems, autocompleteSelectedIndex, getCurrentWord]);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">&gt; </Text>
        <Box flexDirection="column" flexGrow={1}>
          <TextRenderer
            lines={bufferState.lines}
            cursorLine={bufferState.cursorLine}
            cursorColumn={bufferState.cursorColumn}
            isFocused={actualIsFocused ?? false}
            placeholder={placeholder}
            inlineCompletion={inlineCompletion}
          />
        </Box>
      </Box>
      
      {/* File autocomplete overlay - positioned aligned with prompt */}
      {autocompleteVisible && (
        <Box marginLeft={2}>
          <FileAutocomplete
            items={autocompleteItems}
            selectedIndex={autocompleteSelectedIndex}
            isVisible={autocompleteVisible}
            maxItems={5}
          />
        </Box>
      )}
    </Box>
  );
};

export default ShellInput;