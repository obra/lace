// ABOUTME: Simple text editor input using modular components
// ABOUTME: Composition of TextBuffer hook, TextRenderer, and input handling

import React, { useEffect, useState, useCallback } from 'react';
import { Box, Text, useInput, useFocus } from 'ink';
import { useTextBuffer } from './useTextBuffer';
import TextRenderer from './TextRenderer';
import { CompletionManager, CompletionItem, CompletionContext } from '../completion/index.js';

interface ShellInputProps {
  value?: string;
  placeholder?: string;
  focusId?: string;
  autoFocus?: boolean;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
  history?: string[];
  showDebug?: boolean;
  completionManager?: CompletionManager;
}

const ShellInput: React.FC<ShellInputProps> = ({
  value = '',
  placeholder = 'Type your message...',
  focusId = 'text-editor',
  autoFocus = false,
  onSubmit,
  onChange,
  history = [],
  showDebug = false,
  completionManager
}) => {
  const { isFocused } = useFocus({ id: focusId, autoFocus });
  const [bufferState, bufferOps] = useTextBuffer(value);

  // Completion state
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [showCompletions, setShowCompletions] = useState(false);
  const [completionPrefix, setCompletionPrefix] = useState('');

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

  // Trigger completion logic
  const triggerCompletion = useCallback(async () => {
    setShowCompletions(false);
    
    if (!completionManager) {
      bufferOps.addDebug('No completion manager available');
      return;
    }

    const currentLine = bufferState.lines[bufferState.cursorLine] || '';
    const { cursorLine, cursorColumn } = bufferState;
    
    const context: CompletionContext = {
      line: currentLine,
      column: cursorColumn,
      lineNumber: cursorLine,
      fullText: bufferOps.getText(),
      cwd: process.cwd()
    };

    try {
      const result = await completionManager.getCompletions(context);
      bufferOps.addDebug(`Completion: found ${result.items.length} items for "${result.prefix}"`);
      
      if (result.items.length > 0) {
        setCompletions(result.items);
        setCompletionIndex(0);
        setCompletionPrefix(result.prefix);
        setShowCompletions(true);
      }
    } catch (error) {
      bufferOps.addDebug(`Completion error: ${error.message}`);
    }
  }, [bufferState, bufferOps, completionManager]);

  // Apply selected completion
  const applyCompletion = useCallback(() => {
    if (!showCompletions || completions.length === 0) return;
    
    const selectedItem = completions[completionIndex];
    if (!selectedItem) return;

    const currentLine = bufferState.lines[bufferState.cursorLine] || '';
    const { cursorLine, cursorColumn } = bufferState;
    
    if (cursorLine === 0 && currentLine.startsWith('/') && selectedItem.type === 'command') {
      // Replace entire command (from / to cursor)
      const newLine = '/' + selectedItem.value;
      bufferOps.setText(newLine);
      bufferOps.setCursorPosition(0, newLine.length);
    } else {
      // Replace word/path before cursor using the stored prefix
      const prefixLength = completionPrefix.length;
      const replaceStart = cursorColumn - prefixLength;
      const newLine = currentLine.slice(0, replaceStart) + selectedItem.value + currentLine.slice(cursorColumn);
      const newLines = [...bufferState.lines];
      newLines[cursorLine] = newLine;
      bufferOps.setText(newLines.join('\n'));
      bufferOps.setCursorPosition(cursorLine, replaceStart + selectedItem.value.length);
    }
    
    setShowCompletions(false);
    bufferOps.addDebug(`Applied completion: ${selectedItem.value}`);
  }, [showCompletions, completions, completionIndex, completionPrefix, bufferState, bufferOps]);

  // Input handler
  useInput((input, key) => {
    // Debug ALL key properties
    const keyProps = Object.keys(key).filter(k => key[k]).join(',');
    bufferOps.addDebug(`KEY: input="${input}" props=[${keyProps}]`);
    
    // Handle completion mode
    if (showCompletions) {
      if (key.escape) {
        setShowCompletions(false);
        return;
      }
      if (key.upArrow) {
        setCompletionIndex(Math.max(0, completionIndex - 1));
        return;
      }
      if (key.downArrow) {
        setCompletionIndex(Math.min(completions.length - 1, completionIndex + 1));
        return;
      }
      if (key.tab || key.return) {
        applyCompletion();
        return;
      }
      // Any other key dismisses completions and continues processing
      setShowCompletions(false);
    }
    
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

    // Tab completion
    if (key.tab) {
      triggerCompletion();
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
      
      {/* Completion overlay */}
      {showCompletions && completions.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          padding={1}
          marginTop={1}
          marginLeft={2} // Offset for prompt
        >
          <Text color="yellow" bold>Completions ({completions.length}):</Text>
          {completions.slice(0, 8).map((item, index) => (
            <Box key={index} flexDirection="row">
              <Text
                color={index === completionIndex ? 'black' : 'white'}
                backgroundColor={index === completionIndex ? 'yellow' : undefined}
              >
                {item.value}
              </Text>
              {item.description && (
                <Text color="dim"> - {item.description}</Text>
              )}
              <Text color="dim"> [{item.type}]</Text>
            </Box>
          ))}
          {completions.length > 8 && (
            <Text color="dim">... and {completions.length - 8} more</Text>
          )}
          <Text color="dim" marginTop={1}>
            ↑↓ navigate • Tab/Enter apply • Esc cancel
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default ShellInput;