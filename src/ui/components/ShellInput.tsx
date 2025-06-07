// ABOUTME: Simple text editor input using modular components
// ABOUTME: Composition of TextBuffer hook, TextRenderer, and input handling

import React, { useEffect, useState, useCallback } from 'react';
import { Box, Text, useInput, useFocus } from 'ink';
import { useTextBuffer } from './useTextBuffer';
import TextRenderer from './TextRenderer';

interface ShellInputProps {
  value?: string;
  placeholder?: string;
  focusId?: string;
  autoFocus?: boolean;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
  history?: string[];
  showDebug?: boolean;
}

const ShellInput: React.FC<ShellInputProps> = ({
  value = '',
  placeholder = 'Type your message...',
  focusId = 'text-editor',
  autoFocus = false,
  onSubmit,
  onChange,
  history = [],
  showDebug = false
}) => {
  const { isFocused } = useFocus({ id: focusId, autoFocus });
  const [bufferState, bufferOps] = useTextBuffer(value);

  // Only sync external value changes on first mount or significant changes (like history)
  const [lastExternalValue, setLastExternalValue] = useState(value);
  
  useEffect(() => {
    // Only update if the external value changed significantly (not from our onChange)
    if (value !== lastExternalValue && value !== bufferOps.getText()) {
      bufferOps.setText(value);
      setLastExternalValue(value);
    }
  }, [value, lastExternalValue, bufferOps]);

  // Debounced onChange to reduce conflicts
  const notifyChange = useCallback((newText: string) => {
    if (onChange && newText !== value) {
      setLastExternalValue(newText); // Pre-mark as our change
      onChange(newText);
    }
  }, [onChange, value]);

  // Notify parent when buffer actually changes
  useEffect(() => {
    const currentText = bufferOps.getText();
    notifyChange(currentText);
  }, [bufferState.lines, notifyChange, bufferOps]);

  // Input handler
  useInput((input, key) => {
    // Debug ALL key properties
    const keyProps = Object.keys(key).filter(k => key[k]).join(',');
    bufferOps.addDebug(`KEY: input="${input}" props=[${keyProps}]`);
    
    // Submit with Shift+Enter
    if (key.return && key.shift) {
      if (onSubmit) {
        onSubmit(bufferOps.getText());
      }
      return;
    }

    // Insert newline with Enter
    if (key.return) {
      bufferOps.insertText('\n');
      return;
    }

    // Navigation
    if (key.leftArrow) {
      bufferOps.moveCursor('left');
      return;
    }
    if (key.rightArrow) {
      bufferOps.moveCursor('right');
      return;
    }
    if (key.upArrow) {
      bufferOps.moveCursor('up');
      return;
    }
    if (key.downArrow) {
      bufferOps.moveCursor('down');
      return;
    }
    if (key.home || (key.ctrl && input === 'a')) {
      bufferOps.moveCursor('home');
      return;
    }
    if (key.end || (key.ctrl && input === 'e')) {
      bufferOps.moveCursor('end');
      return;
    }

    // Emacs-style editing commands
    if (key.ctrl && input === 'k') {
      // Kill line (delete from cursor to end of line)
      bufferOps.killLine();
      return;
    }
    if (key.ctrl && input === 'u') {
      // Kill line backward (delete from beginning of line to cursor)
      bufferOps.killLineBackward();
      return;
    }
    if (key.ctrl && input === 'd') {
      // Delete character forward (like Delete key)
      bufferOps.deleteChar('forward');
      return;
    }
    if (key.ctrl && input === 'h') {
      // Delete character backward (like Backspace key)
      bufferOps.deleteChar('backward');
      return;
    }

    // Deletion
    if (key.delete) {
      bufferOps.addDebug('DELETE/BACKSPACE KEY DETECTED in input handler');
      bufferOps.deleteChar('backward');
      return;
    }
    if (key.backspace) {
      bufferOps.deleteChar('forward');
      return;
    }

    // Regular character input
    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      bufferOps.insertText(input);
      return;
    }
  }, { isActive: isFocused });

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">&gt; </Text>
        <Box flexDirection="column" flexGrow={1}>
          <TextRenderer
            lines={bufferState.lines}
            cursorLine={bufferState.cursorLine}
            cursorColumn={bufferState.cursorColumn}
            isFocused={isFocused}
            placeholder={placeholder}
            showDebug={showDebug}
            debugLog={bufferState.debugLog}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default ShellInput;