// ABOUTME: Shell-style text input component with cursor navigation and completion
// ABOUTME: Focused, simple implementation using Ink focus patterns for command line interface

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useFocus } from 'ink';

interface CompletionItem {
  value: string;
  description?: string;
  type: 'command' | 'file' | 'directory';
}

interface TextEditorInputProps {
  value?: string;
  placeholder?: string;
  focusId?: string;
  autoFocus?: boolean;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
  onCommandCompletion?: (prefix: string) => CompletionItem[];
  onFileCompletion?: (prefix: string) => CompletionItem[];
  history?: string[];
}

const TextEditorInput: React.FC<TextEditorInputProps> = ({
  value = '',
  placeholder = 'Type your message...',
  focusId = 'text-editor',
  autoFocus = false,
  onSubmit,
  onChange,
  onCommandCompletion,
  onFileCompletion,
  history = []
}) => {
  const { isFocused } = useFocus({ id: focusId, autoFocus });
  
  const [cursor, setCursor] = useState({ line: 0, column: 0 });
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [showCompletions, setShowCompletions] = useState(false);
  const [isInternalChange, setIsInternalChange] = useState(false);

  // Use value prop directly, split into lines
  const lines = value.split('\n');
  
  // Helper to convert line/column to character offset
  const getCharOffset = useCallback((line: number, column: number) => {
    let offset = 0;
    for (let i = 0; i < Math.min(line, lines.length); i++) {
      offset += lines[i].length + (i < lines.length - 1 ? 1 : 0); // +1 for newline
    }
    return offset + Math.min(column, lines[line]?.length || 0);
  }, [lines]);

  // Helper to convert character offset to line/column
  const getLineColumn = useCallback((offset: number) => {
    let currentOffset = 0;
    for (let line = 0; line < lines.length; line++) {
      const lineLength = lines[line].length;
      if (currentOffset + lineLength >= offset) {
        return { line, column: offset - currentOffset };
      }
      currentOffset += lineLength + 1; // +1 for newline
    }
    // If offset is beyond text, place at end of last line
    return { line: Math.max(0, lines.length - 1), column: lines[lines.length - 1]?.length || 0 };
  }, [lines]);

  // Only reset cursor position when value changes from external source (like history)
  React.useEffect(() => {
    if (!isInternalChange) {
      const { line, column } = getLineColumn(value.length);
      setCursor({
        line: Math.min(Math.max(0, line), lines.length - 1),
        column: Math.max(0, column)
      });
    }
    setIsInternalChange(false);
  }, [value, isInternalChange, getLineColumn, lines.length]);

  // Notify parent of changes and update cursor
  const updateText = useCallback((newText: string, newLine: number, newColumn: number) => {
    setIsInternalChange(true);
    setCursor({ line: newLine, column: newColumn });
    if (onChange) {
      onChange(newText);
    }
  }, [onChange]);

  // Insert text at cursor position
  const insertText = useCallback((input: string) => {
    const currentLine = lines[cursor.line] || '';
    const beforeCursor = currentLine.slice(0, cursor.column);
    const afterCursor = currentLine.slice(cursor.column);
    
    if (input === '\n') {
      // Handle newline specially
      const newLines = [...lines];
      newLines[cursor.line] = beforeCursor;
      newLines.splice(cursor.line + 1, 0, afterCursor);
      const newText = newLines.join('\n');
      updateText(newText, cursor.line + 1, 0);
    } else {
      // Regular text insertion
      const newLine = beforeCursor + input + afterCursor;
      const newLines = [...lines];
      newLines[cursor.line] = newLine;
      const newText = newLines.join('\n');
      updateText(newText, cursor.line, cursor.column + input.length);
    }
  }, [lines, cursor.line, cursor.column, updateText]);

  // Delete character at cursor
  const deleteChar = useCallback((direction: 'forward' | 'backward') => {
    const currentLine = lines[cursor.line] || '';
    
    if (direction === 'backward') {
      if (cursor.column > 0) {
        // Delete within current line
        const newLine = currentLine.slice(0, cursor.column - 1) + currentLine.slice(cursor.column);
        const newLines = [...lines];
        newLines[cursor.line] = newLine;
        const newText = newLines.join('\n');
        updateText(newText, cursor.line, cursor.column - 1);
      } else if (cursor.line > 0) {
        // Merge with previous line
        const prevLine = lines[cursor.line - 1];
        const mergedLine = prevLine + currentLine;
        const newLines = [...lines];
        newLines[cursor.line - 1] = mergedLine;
        newLines.splice(cursor.line, 1);
        const newText = newLines.join('\n');
        updateText(newText, cursor.line - 1, prevLine.length);
      }
    } else {
      // Forward delete
      if (cursor.column < currentLine.length) {
        // Delete within current line
        const newLine = currentLine.slice(0, cursor.column) + currentLine.slice(cursor.column + 1);
        const newLines = [...lines];
        newLines[cursor.line] = newLine;
        const newText = newLines.join('\n');
        updateText(newText, cursor.line, cursor.column);
      } else if (cursor.line < lines.length - 1) {
        // Merge with next line
        const nextLine = lines[cursor.line + 1];
        const mergedLine = currentLine + nextLine;
        const newLines = [...lines];
        newLines[cursor.line] = mergedLine;
        newLines.splice(cursor.line + 1, 1);
        const newText = newLines.join('\n');
        updateText(newText, cursor.line, cursor.column);
      }
    }
  }, [lines, cursor.line, cursor.column, updateText]);

  // Move cursor
  const moveCursor = useCallback((direction: 'left' | 'right' | 'home' | 'end' | 'up' | 'down') => {
    const currentLine = lines[cursor.line] || '';
    const oldCursor = { ...cursor };
    
    switch (direction) {
      case 'left':
        if (cursor.column > 0) {
          setCursor({ line: cursor.line, column: cursor.column - 1 });
        } else if (cursor.line > 0) {
          const newLine = cursor.line - 1;
          const newColumn = lines[newLine].length;
          setCursor({ line: newLine, column: newColumn });
        }
        break;
      case 'right':
        if (cursor.column < currentLine.length) {
          setCursor({ line: cursor.line, column: cursor.column + 1 });
        } else if (cursor.line < lines.length - 1) {
          setCursor({ line: cursor.line + 1, column: 0 });
        }
        break;
      case 'up':
        if (cursor.line > 0) {
          const newLine = cursor.line - 1;
          const targetLine = lines[newLine];
          const newColumn = Math.min(cursor.column, targetLine.length);
          setCursor({ line: newLine, column: newColumn });
        }
        break;
      case 'down':
        if (cursor.line < lines.length - 1) {
          const newLine = cursor.line + 1;
          const targetLine = lines[newLine];
          const newColumn = Math.min(cursor.column, targetLine.length);
          setCursor({ line: newLine, column: newColumn });
        }
        break;
      case 'home':
        setCursor({ line: cursor.line, column: 0 });
        break;
      case 'end':
        setCursor({ line: cursor.line, column: currentLine.length });
        break;
    }
  }, [cursor.line, cursor.column, lines]);

  // Handle tab completion
  const triggerCompletion = useCallback(() => {
    setShowCompletions(false);
    
    const currentLine = lines[cursor.line] || '';
    
    // Command completion (starts with slash)
    if (cursor.line === 0 && currentLine.startsWith('/')) {
      const match = currentLine.match(/^\/(\w*)$/);
      if (match && onCommandCompletion) {
        const items = onCommandCompletion(match[1]);
        if (items.length > 0) {
          setCompletions(items);
          setCompletionIndex(0);
          setShowCompletions(true);
        }
      }
      return;
    }

    // File completion (word at cursor)
    const beforeCursor = currentLine.slice(0, cursor.column);
    const match = beforeCursor.match(/(\S+)$/);
    if (match && onFileCompletion) {
      onFileCompletion(match[1]).then((items: CompletionItem[]) => {
        if (items.length > 0) {
          setCompletions(items);
          setCompletionIndex(0);
          setShowCompletions(true);
        }
      });
    }
  }, [lines, cursor.line, cursor.column, onCommandCompletion, onFileCompletion]);

  // Apply completion
  const applyCompletion = useCallback(() => {
    if (!showCompletions || completions.length === 0) return;
    
    const selectedItem = completions[completionIndex];
    if (!selectedItem) return;

    const currentLine = lines[cursor.line] || '';
    
    if (cursor.line === 0 && currentLine.startsWith('/')) {
      // Replace entire command
      const newLines = [...lines];
      newLines[0] = '/' + selectedItem.value;
      const newText = newLines.join('\n');
      updateText(newText, 0, selectedItem.value.length + 1);
    } else {
      // Replace word at cursor
      const beforeCursor = currentLine.slice(0, cursor.column);
      const match = beforeCursor.match(/(\S+)$/);
      if (match) {
        const replaceStart = cursor.column - match[1].length;
        const newLine = currentLine.slice(0, replaceStart) + selectedItem.value + currentLine.slice(cursor.column);
        const newLines = [...lines];
        newLines[cursor.line] = newLine;
        const newText = newLines.join('\n');
        updateText(newText, cursor.line, replaceStart + selectedItem.value.length);
      }
    }
    
    setShowCompletions(false);
  }, [showCompletions, completions, completionIndex, lines, cursor.line, cursor.column, updateText]);

  // Navigate history
  const navigateHistory = useCallback((direction: 'up' | 'down') => {
    if (history.length === 0) return;
    
    let newIndex = historyIndex;
    if (direction === 'up') {
      newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
    } else {
      newIndex = historyIndex === -1 ? -1 : Math.min(history.length - 1, historyIndex + 1);
      if (newIndex === history.length - 1 && historyIndex === history.length - 1) {
        newIndex = -1; // Back to empty
      }
    }
    
    setHistoryIndex(newIndex);
    const historyText = newIndex === -1 ? '' : history[newIndex];
    const historyLines = historyText.split('\n');
    const lastLine = historyLines.length - 1;
    const lastColumn = historyLines[lastLine]?.length || 0;
    updateText(historyText, lastLine, lastColumn);
  }, [history, historyIndex, updateText]);

  // Input handler
  useInput((input, key) => {
    // Handle completions first
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
      // Any other key dismisses completions and continues
      setShowCompletions(false);
    }

    // Enter creates newline, Shift+Enter submits
    if (key.return) {
      if (key.shift) {
        // Submit with Shift+Enter
        if (onSubmit) {
          onSubmit(value);
        }
      } else {
        // Insert newline with Enter
        insertText('\n');
      }
      return;
    }

    // Navigation
    if (key.leftArrow) {
      moveCursor('left');
      return;
    }
    if (key.rightArrow) {
      moveCursor('right');
      return;
    }
    if (key.home || (key.ctrl && input === 'a')) {
      moveCursor('home');
      return;
    }
    if (key.end || (key.ctrl && input === 'e')) {
      moveCursor('end');
      return;
    }

    // Up/Down arrows - history on single line, line navigation on multiline
    if (key.upArrow) {
      if (lines.length === 1) {
        navigateHistory('up');
      } else {
        moveCursor('up');
      }
      return;
    }
    if (key.downArrow) {
      if (lines.length === 1) {
        navigateHistory('down');
      } else {
        moveCursor('down');
      }
      return;
    }

    // Deletion
    if (key.backspace) {
      deleteChar('backward');
      return;
    }
    if (key.delete) {
      deleteChar('forward');
      return;
    }

    // Tab completion
    if (key.tab) {
      triggerCompletion();
      return;
    }

    // Regular character input
    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      insertText(input);
      return;
    }
  }, { isActive: isFocused });

  // Render multiple lines with cursor
  const renderLines = () => {
    if (!isFocused && value.length === 0) {
      return (
        <Box>
          <Text color="cyan">&gt; </Text>
          <Text color="dim">{placeholder}</Text>
        </Box>
      );
    }

    return lines.map((line, lineIndex) => {
      const isCurrentLine = lineIndex === cursor.line;
      const showPrompt = lineIndex === 0;

      return (
        <Box key={lineIndex}>
          {showPrompt && <Text color="cyan">&gt; </Text>}
          
          {isCurrentLine && isFocused ? (
            // Render line with cursor
            <>
              <Text>{line.slice(0, cursor.column)}</Text>
              <Text inverse>{line.slice(cursor.column, cursor.column + 1) || ' '}</Text>
              <Text>{line.slice(cursor.column + 1)}</Text>
            </>
          ) : (
            // Regular line without cursor
            <Text>{line || (lineIndex === 0 && line.length === 0 ? <Text color="dim">{placeholder}</Text> : '')}</Text>
          )}
        </Box>
      );
    });
  };

  return (
    <Box flexDirection="column">
      {/* Debug info */}
      <Box borderStyle="single" borderColor="red" padding={1}>
        <Text>Debug: line={cursor.line} col={cursor.column} focused={isFocused ? 'Y' : 'N'} lines={lines.length}</Text>
      </Box>
      {renderLines()}
      
      {/* Completion popup */}
      {showCompletions && completions.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          padding={1}
          marginTop={1}
          marginLeft={7} // Offset for prompt
        >
          <Text color="yellow" bold>Completions:</Text>
          {completions.slice(0, 8).map((item, index) => (
            <Text
              key={index}
              color={index === completionIndex ? 'black' : 'white'}
              backgroundColor={index === completionIndex ? 'yellow' : undefined}
            >
              {item.value}
              {item.description && (
                <Text color="dim"> - {item.description}</Text>
              )}
            </Text>
          ))}
          {completions.length > 8 && (
            <Text color="dim">... and {completions.length - 8} more</Text>
          )}
        </Box>
      )}
    </Box>
  );
};

export default TextEditorInput;