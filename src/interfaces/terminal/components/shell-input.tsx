// ABOUTME: Simple text editor input with multi-line editing capabilities
// ABOUTME: Handles keyboard input and manages text buffer state

import React, { useEffect, useState, useCallback } from "react";
import { Box, Text, useInput, useFocus } from "ink";
import { useTextBuffer } from "../hooks/use-text-buffer.js";
import TextRenderer from "./text-renderer.js";

interface ShellInputProps {
  value?: string;
  placeholder?: string;
  focusId?: string;
  autoFocus?: boolean;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
}

const ShellInput: React.FC<ShellInputProps> = ({
  value = "",
  placeholder = "Type your message...",
  focusId = "text-editor",
  autoFocus = false,
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
    ? useFocus({ id: focusId, autoFocus })
    : null;
  const actualIsFocused = useRealFocus ? focusResult?.isFocused : isFocused;
  const [bufferState, bufferOps] = useTextBuffer(value);

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

  // Input handler
  useInput(
    (input, key) => {
      // Handle Enter - submit or newline based on line ending
      if (key.return) {
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
        bufferOps.moveCursor("up");
        return;
      }
      if (key.downArrow) {
        bufferOps.moveCursor("down");
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
    </Box>
  );
};

export default ShellInput;