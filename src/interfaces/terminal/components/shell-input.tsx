// ABOUTME: Simple text editor input with multi-line editing capabilities
// ABOUTME: Handles keyboard input and manages text buffer state

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Box, Text, useInput, useFocus } from "ink";
import { useTextBuffer } from "../hooks/use-text-buffer.js";
import TextRenderer from "./text-renderer.js";
import FileAutocomplete from "./file-autocomplete.js";

// Keyboard shortcut constants
const KEYBOARD_SHORTCUTS = {
  // Navigation shortcuts
  CTRL_A: 'a', // Move to beginning of line
  CTRL_E: 'e', // Move to end of line
  
  // Editing shortcuts  
  CTRL_K: 'k', // Kill line (delete to end)
  CTRL_U: 'u', // Kill line backward (delete to beginning)
  CTRL_D: 'd', // Delete character forward
  CTRL_H: 'h', // Delete character backward
  
  // Clipboard shortcuts
  CTRL_V: 'v', // Paste (non-Mac)
  CMD_V: 'v',  // Paste (Mac)
} as const;

interface ShellInputProps {
  value?: string;
  placeholder?: string;
  focusId?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
}

const ShellInput: React.FC<ShellInputProps> = ({
  value = "",
  placeholder = "Type your message...",
  focusId = "text-editor",
  autoFocus = false,
  disabled = false,
  onSubmit,
  onChange,
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
  const [bufferState, bufferOps] = useTextBuffer(value);

  // Autocomplete state
  const [autocompleteVisible, setAutocompleteVisible] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState("");
  const [autocompleteSelectedIndex, setAutocompleteSelectedIndex] = useState(0);
  const [autocompleteItems, setAutocompleteItems] = useState<string[]>([]);
  const [autocompleteOriginalItems, setAutocompleteOriginalItems] = useState<string[]>([]);

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
    
    setAutocompleteVisible(false);
  }, [bufferState, bufferOps, getCurrentWord]);

  const showAutocomplete = useCallback(async () => {
    const { beforeCursor } = getCurrentWord();
    const currentLine = bufferState.lines[bufferState.cursorLine] || '';
    const trimmedLine = currentLine.trim();
    
    setAutocompleteQuery(beforeCursor);
    setAutocompleteSelectedIndex(0);
    setAutocompleteVisible(true);
    
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
        } else if (beforeCursor.includes('/') || beforeCursor === '') {
          // Standard path completion
          completions = await scanner.getCompletions(beforeCursor);
        } else {
          // Substring search across all project files
          completions = await scanner.findBySubstring(beforeCursor);
        }
      }
      
      setAutocompleteItems(completions);
      setAutocompleteOriginalItems(completions);
    } catch (error) {
      console.error('Failed to load completions:', error);
      setAutocompleteItems([]);
      setAutocompleteOriginalItems([]);
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
    setAutocompleteItems(filtered);
    setAutocompleteSelectedIndex(0);
  }, [autocompleteVisible, autocompleteOriginalItems]);

  const filterAutocomplete = useCallback(() => {
    const { beforeCursor } = getCurrentWord();
    filterAutocompleteWithText(beforeCursor);
  }, [getCurrentWord, filterAutocompleteWithText]);

  const hideAutocomplete = useCallback(() => {
    setAutocompleteVisible(false);
    setAutocompleteQuery('');
    setAutocompleteSelectedIndex(0);
    setAutocompleteItems([]);
    setAutocompleteOriginalItems([]);
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
          // Show autocomplete
          showAutocomplete();
        }
        return;
      }

      // Handle Escape to close autocomplete
      if (key.escape && autocompleteVisible) {
        hideAutocomplete();
        return;
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
      if (key.leftArrow || 
          (key.ctrl && (input === KEYBOARD_SHORTCUTS.CTRL_A || input === KEYBOARD_SHORTCUTS.CTRL_E)) ||
          (key.ctrl && (input === KEYBOARD_SHORTCUTS.CTRL_K || input === KEYBOARD_SHORTCUTS.CTRL_U || input === KEYBOARD_SHORTCUTS.CTRL_D || input === KEYBOARD_SHORTCUTS.CTRL_H))) {
        
        if (autocompleteVisible) {
          hideAutocomplete();
        }
        
        // Execute the original navigation/editing command
        if (key.leftArrow) {
          bufferOps.moveCursor("left");
        } else if (key.ctrl && input === KEYBOARD_SHORTCUTS.CTRL_A) {
          bufferOps.moveCursor("home");
        } else if (key.ctrl && input === KEYBOARD_SHORTCUTS.CTRL_E) {
          bufferOps.moveCursor("end");
        } else if (key.ctrl && input === KEYBOARD_SHORTCUTS.CTRL_K) {
          bufferOps.killLine();
        } else if (key.ctrl && input === KEYBOARD_SHORTCUTS.CTRL_U) {
          bufferOps.killLineBackward();
        } else if (key.ctrl && input === KEYBOARD_SHORTCUTS.CTRL_D) {
          bufferOps.deleteChar("forward");
        } else if (key.ctrl && input === KEYBOARD_SHORTCUTS.CTRL_H) {
          bufferOps.deleteChar("backward");
        }
        return;
      }
      
      // Up/Down arrows for autocomplete navigation or cursor movement
      if (key.upArrow) {
        if (autocompleteVisible && autocompleteItems.length > 0) {
          setAutocompleteSelectedIndex(prev => Math.max(0, prev - 1));
        } else {
          bufferOps.moveCursor("up");
        }
        return;
      }
      if (key.downArrow) {
        if (autocompleteVisible && autocompleteItems.length > 0) {
          setAutocompleteSelectedIndex(prev => Math.min(autocompleteItems.length - 1, prev + 1));
        } else {
          bufferOps.moveCursor("down");
        }
        return;
      }

      // Paste functionality
      if ((key.ctrl && input === KEYBOARD_SHORTCUTS.CTRL_V) || (key.meta && input === KEYBOARD_SHORTCUTS.CMD_V)) {
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
            // For forward delete or edge cases, use requestAnimationFrame for better performance
            requestAnimationFrame(() => {
              filterAutocomplete();
            });
          }
        }
        return;
      }

      // Regular character input - filter autocomplete instead of hiding
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        bufferOps.insertText(input);
        
        // Filter autocomplete when typing
        if (autocompleteVisible) {
          // Get the expected new text and filter with it
          const { beforeCursor } = getCurrentWord();
          const newBeforeCursor = beforeCursor + input;
          filterAutocompleteWithText(newBeforeCursor);
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