// ABOUTME: Simple text editor input with multi-line editing capabilities
// ABOUTME: Handles keyboard input and manages text buffer state

import React, { useEffect, useState, useCallback } from "react";
import { Box, Text, useInput, useFocus } from "ink";
import { useTextBuffer } from "../hooks/use-text-buffer.js";
import TextRenderer from "./text-renderer.js";
import FileAutocomplete from "./file-autocomplete.js";

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
    
    // Replace the current word with the completion
    const newLine = currentLine.slice(0, start) + completion + currentLine.slice(end);
    const newLines = [...bufferState.lines];
    newLines[bufferState.cursorLine] = newLine;
    
    bufferOps.setText(newLines.join('\n'));
    bufferOps.setCursorPosition(bufferState.cursorLine, start + completion.length);
    
    setAutocompleteVisible(false);
  }, [bufferState, bufferOps, getCurrentWord]);

  const showAutocomplete = useCallback(async () => {
    const { beforeCursor } = getCurrentWord();
    setAutocompleteQuery(beforeCursor);
    setAutocompleteSelectedIndex(0);
    setAutocompleteVisible(true);
    
    // Load completions
    try {
      const { FileScanner } = await import('../utils/file-scanner.js');
      const scanner = new FileScanner();
      const completions = await scanner.getCompletions(beforeCursor);
      setAutocompleteItems(completions);
    } catch (error) {
      console.error('Failed to load completions:', error);
      setAutocompleteItems([]);
    }
  }, [getCurrentWord]);

  const hideAutocomplete = useCallback(() => {
    setAutocompleteVisible(false);
    setAutocompleteQuery('');
    setAutocompleteSelectedIndex(0);
    setAutocompleteItems([]);
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
        if (autocompleteVisible) {
          hideAutocomplete();
        } else {
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

      // Navigation
      if (key.leftArrow) {
        bufferOps.moveCursor("left");
        return;
      }
      if (key.rightArrow) {
        bufferOps.moveCursor("right");
        return;
      }
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
      if (key.ctrl && input === "a") {
        bufferOps.moveCursor("home");
        return;
      }
      if (key.ctrl && input === "e") {
        bufferOps.moveCursor("end");
        return;
      }

      // Emacs-style editing commands
      if (key.ctrl && input === "k") {
        // Kill line (delete from cursor to end of line)
        bufferOps.killLine();
        return;
      }
      if (key.ctrl && input === "u") {
        // Kill line backward (delete from beginning of line to cursor)
        bufferOps.killLineBackward();
        return;
      }
      if (key.ctrl && input === "d") {
        // Delete character forward (like Delete key)
        bufferOps.deleteChar("forward");
        return;
      }
      if (key.ctrl && input === "h") {
        // Delete character backward (like Backspace key)
        bufferOps.deleteChar("backward");
        return;
      }

      // Paste functionality
      if ((key.ctrl && input === "v") || (key.meta && input === "v")) {
        // Ctrl+V on non-Mac, Cmd+V on Mac
        bufferOps.pasteFromClipboard().catch((error) => {
          console.warn('Paste operation failed:', error);
        });
        return;
      }

      // Deletion
      if (key.delete) {
        bufferOps.deleteChar("backward");
        return;
      }
      if (key.backspace) {
        bufferOps.deleteChar("forward");
        return;
      }

      // Regular character input
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        bufferOps.insertText(input);
        // Hide autocomplete when typing
        if (autocompleteVisible) {
          hideAutocomplete();
        }
        return;
      }
    },
    { isActive: actualIsFocused },
  );

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
          />
        </Box>
      </Box>
      
      {/* File autocomplete overlay - positioned inline below cursor line */}
      {autocompleteVisible && (
        <Box marginLeft={bufferState.cursorColumn + 2}>
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