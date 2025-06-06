// ABOUTME: Advanced text input component combining shell and editor ergonomics
// ABOUTME: Supports multi-line, completion, history, and modern editing features

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, useFocus } from 'ink';

interface HistoryManager {
  entries: string[];
  position: number;
  searchTerm: string;
  searchMode: boolean;
}

interface CompletionItem {
  value: string;
  description?: string;
  type: 'command' | 'file' | 'directory';
}

interface CompletionEngine {
  active: boolean;
  items: CompletionItem[];
  selectedIndex: number;
  trigger: string;
}

interface TextBuffer {
  lines: string[];
  cursorLine: number;
  cursorColumn: number;
  selection: {
    start: { line: number; column: number } | null;
    end: { line: number; column: number } | null;
  };
}

interface TextEditorInputProps {
  value?: string;
  placeholder?: string;
  focusId?: string;
  autoFocus?: boolean;
  multiLine?: boolean;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
  onCommandCompletion?: (prefix: string) => CompletionItem[];
  onFileCompletion?: (prefix: string) => CompletionItem[];
  history?: string[];
  showLineNumbers?: boolean;
  maxLines?: number;
}

const TextEditorInput: React.FC<TextEditorInputProps> = ({
  value = '',
  placeholder = 'Type your message...',
  focusId = 'text-editor',
  autoFocus = false,
  multiLine = true,
  onSubmit,
  onChange,
  onCommandCompletion,
  onFileCompletion,
  history = [],
  showLineNumbers = false,
  maxLines = 10
}) => {
  const { isFocused } = useFocus({ id: focusId, autoFocus });
  
  // Core text buffer state
  const [buffer, setBuffer] = useState<TextBuffer>(() => {
    const lines = value ? value.split('\n') : [''];
    return {
      lines,
      cursorLine: lines.length - 1,
      cursorColumn: lines[lines.length - 1]?.length || 0,
      selection: { start: null, end: null }
    };
  });

  // Mode and state management
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [insertMode, setInsertMode] = useState<'insert' | 'overwrite'>('insert');
  
  // History management
  const [historyManager, setHistoryManager] = useState<HistoryManager>({
    entries: history,
    position: -1,
    searchTerm: '',
    searchMode: false
  });

  // Completion system
  const [completion, setCompletion] = useState<CompletionEngine>({
    active: false,
    items: [],
    selectedIndex: 0,
    trigger: ''
  });

  // Undo/redo stacks
  const [undoStack, setUndoStack] = useState<TextBuffer[]>([]);
  const [redoStack, setRedoStack] = useState<TextBuffer[]>([]);
  
  // Internal refs
  const lastChangeRef = useRef<number>(0);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Get current text content
  const getCurrentText = useCallback(() => {
    return buffer.lines.join('\n');
  }, [buffer.lines]);

  // Update external value when buffer changes
  useEffect(() => {
    const newText = getCurrentText();
    if (onChange && newText !== value) {
      // Debounce onChange calls
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        onChange(newText);
      }, 100);
    }
  }, [buffer, onChange, value, getCurrentText]);

  // Save state for undo
  const saveUndo = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-19), { ...buffer }]); // Keep last 20 states
    setRedoStack([]); // Clear redo stack on new change
  }, [buffer]);

  // Move cursor to specific position
  const moveCursor = useCallback((line: number, column: number) => {
    setBuffer(prev => ({
      ...prev,
      cursorLine: Math.max(0, Math.min(line, prev.lines.length - 1)),
      cursorColumn: Math.max(0, Math.min(column, prev.lines[line]?.length || 0))
    }));
  }, []);

  // Insert text at cursor
  const insertText = useCallback((text: string) => {
    saveUndo();
    
    setBuffer(prev => {
      const newLines = [...prev.lines];
      const currentLine = newLines[prev.cursorLine] || '';
      
      if (text.includes('\n')) {
        // Multi-line insertion
        const insertLines = text.split('\n');
        const beforeCursor = currentLine.slice(0, prev.cursorColumn);
        const afterCursor = currentLine.slice(prev.cursorColumn);
        
        // Replace current line with first part + first insert line
        newLines[prev.cursorLine] = beforeCursor + insertLines[0];
        
        // Insert middle lines
        for (let i = 1; i < insertLines.length - 1; i++) {
          newLines.splice(prev.cursorLine + i, 0, insertLines[i]);
        }
        
        // Insert last line + remaining text
        if (insertLines.length > 1) {
          newLines.splice(prev.cursorLine + insertLines.length - 1, 0, 
            insertLines[insertLines.length - 1] + afterCursor);
        }
        
        return {
          ...prev,
          lines: newLines,
          cursorLine: prev.cursorLine + insertLines.length - 1,
          cursorColumn: insertLines[insertLines.length - 1].length
        };
      } else {
        // Single line insertion
        const newLine = currentLine.slice(0, prev.cursorColumn) + text + currentLine.slice(prev.cursorColumn);
        newLines[prev.cursorLine] = newLine;
        
        return {
          ...prev,
          lines: newLines,
          cursorColumn: prev.cursorColumn + text.length
        };
      }
    });
  }, [saveUndo]);

  // Delete text (backspace/delete)
  const deleteText = useCallback((direction: 'backward' | 'forward', wordMode = false) => {
    saveUndo();
    
    setBuffer(prev => {
      const newLines = [...prev.lines];
      const currentLine = newLines[prev.cursorLine] || '';
      
      if (direction === 'backward') {
        if (prev.cursorColumn > 0) {
          // Delete within current line
          let deleteCount = 1;
          if (wordMode) {
            // Delete whole word
            const beforeCursor = currentLine.slice(0, prev.cursorColumn);
            const match = beforeCursor.match(/\S*\s*$/);
            deleteCount = match ? match[0].length : 1;
          }
          
          const newLine = currentLine.slice(0, prev.cursorColumn - deleteCount) + 
                          currentLine.slice(prev.cursorColumn);
          newLines[prev.cursorLine] = newLine;
          
          return {
            ...prev,
            lines: newLines,
            cursorColumn: prev.cursorColumn - deleteCount
          };
        } else if (prev.cursorLine > 0) {
          // Merge with previous line
          const prevLine = newLines[prev.cursorLine - 1];
          const mergedLine = prevLine + currentLine;
          newLines[prev.cursorLine - 1] = mergedLine;
          newLines.splice(prev.cursorLine, 1);
          
          return {
            ...prev,
            lines: newLines,
            cursorLine: prev.cursorLine - 1,
            cursorColumn: prevLine.length
          };
        }
      } else {
        // Forward delete
        if (prev.cursorColumn < currentLine.length) {
          let deleteCount = 1;
          if (wordMode) {
            const afterCursor = currentLine.slice(prev.cursorColumn);
            const match = afterCursor.match(/^\s*\S*/);
            deleteCount = match ? match[0].length : 1;
          }
          
          const newLine = currentLine.slice(0, prev.cursorColumn) + 
                          currentLine.slice(prev.cursorColumn + deleteCount);
          newLines[prev.cursorLine] = newLine;
          
          return { ...prev, lines: newLines };
        } else if (prev.cursorLine < prev.lines.length - 1) {
          // Merge with next line
          const nextLine = newLines[prev.cursorLine + 1];
          newLines[prev.cursorLine] = currentLine + nextLine;
          newLines.splice(prev.cursorLine + 1, 1);
          
          return { ...prev, lines: newLines };
        }
      }
      
      return prev;
    });
  }, [saveUndo]);

  // Handle new line insertion
  const insertNewLine = useCallback(() => {
    if (!multiLine && mode === 'single') {
      // Submit in single-line mode
      if (onSubmit) {
        onSubmit(getCurrentText());
      }
      return;
    }

    saveUndo();
    setMode('multi');
    
    setBuffer(prev => {
      const newLines = [...prev.lines];
      const currentLine = newLines[prev.cursorLine] || '';
      const beforeCursor = currentLine.slice(0, prev.cursorColumn);
      const afterCursor = currentLine.slice(prev.cursorColumn);
      
      newLines[prev.cursorLine] = beforeCursor;
      newLines.splice(prev.cursorLine + 1, 0, afterCursor);
      
      return {
        ...prev,
        lines: newLines,
        cursorLine: prev.cursorLine + 1,
        cursorColumn: 0
      };
    });
  }, [multiLine, mode, onSubmit, getCurrentText, saveUndo]);

  // Trigger completion
  const triggerCompletion = useCallback((prefix: string, type: 'command' | 'file') => {
    let items: CompletionItem[] = [];
    
    if (type === 'command' && onCommandCompletion) {
      items = onCommandCompletion(prefix);
    } else if (type === 'file' && onFileCompletion) {
      items = onFileCompletion(prefix);
    }
    
    setCompletion({
      active: items.length > 0,
      items,
      selectedIndex: 0,
      trigger: prefix
    });
  }, [onCommandCompletion, onFileCompletion]);

  // Register input handlers using regular useInput hook
  useInput((input, key) => {

    // Input handling logic
    // Handle completion mode
    if (completion.active) {
      if (key.escape) {
        setCompletion(prev => ({ ...prev, active: false }));
        return;
      }
      
      if (key.upArrow) {
        setCompletion(prev => ({
          ...prev,
          selectedIndex: Math.max(0, prev.selectedIndex - 1)
        }));
        return;
      }
      
      if (key.downArrow) {
        setCompletion(prev => ({
          ...prev,
          selectedIndex: Math.min(prev.items.length - 1, prev.selectedIndex + 1)
        }));
        return;
      }
      
      if (key.tab || key.return) {
        const selectedItem = completion.items[completion.selectedIndex];
        if (selectedItem) {
          // Replace the trigger with the completion
          const currentLine = buffer.lines[buffer.cursorLine] || '';
          const beforeTrigger = currentLine.slice(0, buffer.cursorColumn - completion.trigger.length);
          const afterCursor = currentLine.slice(buffer.cursorColumn);
          const newLine = beforeTrigger + selectedItem.value + afterCursor;
          
          setBuffer(prev => {
            const newLines = [...prev.lines];
            newLines[prev.cursorLine] = newLine;
            return {
              ...prev,
              lines: newLines,
              cursorColumn: beforeTrigger.length + selectedItem.value.length
            };
          });
        }
        setCompletion(prev => ({ ...prev, active: false }));
        return;
      }
    }

        // Handle history search mode
        if (historyManager.searchMode) {
          if (key.escape) {
            setHistoryManager(prev => ({ ...prev, searchMode: false, searchTerm: '' }));
            return;
          }
          
          if (key.return) {
            // TODO: Implement history search
            setHistoryManager(prev => ({ ...prev, searchMode: false }));
            return;
          }
          
          if (key.backspace) {
            setHistoryManager(prev => ({ 
              ...prev, 
              searchTerm: prev.searchTerm.slice(0, -1) 
            }));
            return;
          }
          
          if (input && !key.ctrl && !key.meta) {
            setHistoryManager(prev => ({ 
              ...prev, 
              searchTerm: prev.searchTerm + input 
            }));
            return;
          }
        }

        // Multi-line mode detection
        if (key.shift && key.return) {
          insertNewLine();
          return;
        }

        // Line continuation with backslash
        if (input === '\\' && !key.ctrl && !key.meta) {
          const currentLine = buffer.lines[buffer.cursorLine] || '';
          if (buffer.cursorColumn === currentLine.length) {
            insertText('\\');
            return;
          }
        }

        // Submit with Ctrl+Enter in multi-line mode
        if (key.ctrl && key.return && mode === 'multi') {
          if (onSubmit) {
            onSubmit(getCurrentText());
          }
          return;
        }

        // Regular Enter handling
        if (key.return) {
          const currentLine = buffer.lines[buffer.cursorLine] || '';
          
          // Check for line continuation
          if (currentLine.endsWith('\\')) {
            // Remove backslash and continue to next line
            setBuffer(prev => {
              const newLines = [...prev.lines];
              newLines[prev.cursorLine] = currentLine.slice(0, -1);
              return { ...prev, lines: newLines };
            });
            insertNewLine();
            return;
          }
          
          // Empty line in multi-line mode submits
          if (mode === 'multi' && currentLine.trim() === '') {
            if (onSubmit) {
              onSubmit(getCurrentText());
            }
            return;
          }
          
          insertNewLine();
          return;
        }

        // Navigation
        if (key.leftArrow) {
          if (key.ctrl) {
            // Move by word
            const currentLine = buffer.lines[buffer.cursorLine] || '';
            const beforeCursor = currentLine.slice(0, buffer.cursorColumn);
            const match = beforeCursor.match(/\S*\s*$/);
            const moveDistance = match ? match[0].length : 1;
            moveCursor(buffer.cursorLine, Math.max(0, buffer.cursorColumn - moveDistance));
          } else {
            // Move by character
            if (buffer.cursorColumn > 0) {
              moveCursor(buffer.cursorLine, buffer.cursorColumn - 1);
            } else if (buffer.cursorLine > 0) {
              const prevLine = buffer.lines[buffer.cursorLine - 1] || '';
              moveCursor(buffer.cursorLine - 1, prevLine.length);
            }
          }
          return;
        }

        if (key.rightArrow) {
          if (key.ctrl) {
            // Move by word
            const currentLine = buffer.lines[buffer.cursorLine] || '';
            const afterCursor = currentLine.slice(buffer.cursorColumn);
            const match = afterCursor.match(/^\s*\S*/);
            const moveDistance = match ? match[0].length : 1;
            moveCursor(buffer.cursorLine, Math.min(currentLine.length, buffer.cursorColumn + moveDistance));
          } else {
            // Move by character
            const currentLine = buffer.lines[buffer.cursorLine] || '';
            if (buffer.cursorColumn < currentLine.length) {
              moveCursor(buffer.cursorLine, buffer.cursorColumn + 1);
            } else if (buffer.cursorLine < buffer.lines.length - 1) {
              moveCursor(buffer.cursorLine + 1, 0);
            }
          }
          return;
        }

        // Line navigation in multi-line mode
        if (mode === 'multi') {
          if (key.upArrow) {
            if (buffer.cursorLine > 0) {
              const targetLine = buffer.lines[buffer.cursorLine - 1] || '';
              moveCursor(buffer.cursorLine - 1, Math.min(buffer.cursorColumn, targetLine.length));
            }
            return;
          }

          if (key.downArrow) {
            if (buffer.cursorLine < buffer.lines.length - 1) {
              const targetLine = buffer.lines[buffer.cursorLine + 1] || '';
              moveCursor(buffer.cursorLine + 1, Math.min(buffer.cursorColumn, targetLine.length));
            }
            return;
          }
        } else {
          // History navigation in single-line mode
          if (key.upArrow || key.downArrow) {
            const direction = key.upArrow ? -1 : 1;
            const newPosition = Math.max(-1, Math.min(historyManager.entries.length - 1, historyManager.position + direction));
            
            if (newPosition !== historyManager.position) {
              const historyText = newPosition === -1 ? '' : historyManager.entries[newPosition];
              setBuffer({
                lines: [historyText],
                cursorLine: 0,
                cursorColumn: historyText.length,
                selection: { start: null, end: null }
              });
              setHistoryManager(prev => ({ ...prev, position: newPosition }));
            }
            return;
          }
        }

        // Home/End keys
        if (key.home || (key.ctrl && input === 'a')) {
          moveCursor(buffer.cursorLine, 0);
          return;
        }

        if (key.end || (key.ctrl && input === 'e')) {
          const currentLine = buffer.lines[buffer.cursorLine] || '';
          moveCursor(buffer.cursorLine, currentLine.length);
          return;
        }

        // Delete operations
        if (key.backspace) {
          deleteText('backward', key.ctrl);
          return;
        }

        if (key.delete) {
          deleteText('forward', key.ctrl);
          return;
        }

        // Undo/Redo
        if (key.ctrl && input === 'z') {
          if (undoStack.length > 0) {
            const previousState = undoStack[undoStack.length - 1];
            setRedoStack(prev => [...prev, { ...buffer }]);
            setUndoStack(prev => prev.slice(0, -1));
            setBuffer(previousState);
          }
          return;
        }

        if (key.ctrl && input === 'y') {
          if (redoStack.length > 0) {
            const nextState = redoStack[redoStack.length - 1];
            setUndoStack(prev => [...prev, { ...buffer }]);
            setRedoStack(prev => prev.slice(0, -1));
            setBuffer(nextState);
          }
          return;
        }

        // Tab completion
        if (key.tab) {
          const currentLine = buffer.lines[buffer.cursorLine] || '';
          const beforeCursor = currentLine.slice(0, buffer.cursorColumn);
          
          // Command completion
          if (beforeCursor.startsWith('/')) {
            const commandMatch = beforeCursor.match(/^\/(\w*)$/);
            if (commandMatch) {
              triggerCompletion(commandMatch[1], 'command');
              return;
            }
          }
          
          // File path completion
          const pathMatch = beforeCursor.match(/(\S+)$/);
          if (pathMatch) {
            triggerCompletion(pathMatch[1], 'file');
            return;
          }
        }

        // History search
        if (key.ctrl && input === 'r') {
          setHistoryManager(prev => ({ 
            ...prev, 
            searchMode: true, 
            searchTerm: '' 
          }));
          return;
        }

        // Escape - exit multi-line mode
        if (key.escape) {
          if (mode === 'multi') {
            setMode('single');
            // Collapse to single line
            setBuffer(prev => ({
              lines: [prev.lines.join(' ')],
              cursorLine: 0,
              cursorColumn: prev.lines.join(' ').length,
              selection: { start: null, end: null }
            }));
          }
          return;
        }

        // Insert mode toggle
        if (key.insert) {
          setInsertMode(prev => prev === 'insert' ? 'overwrite' : 'insert');
          return;
        }

        // Regular character input
        if (input && !key.ctrl && !key.meta && input.length === 1) {
          insertText(input);
          return;
        }

    // End of input handling
  }, { isActive: isFocused });

  // Render the component
  const renderLines = () => {
    const lines = buffer.lines.length === 0 ? [''] : buffer.lines;
    
    return lines.map((line, lineIndex) => {
      const isCurrentLine = lineIndex === buffer.cursorLine;
      const showLineNumber = showLineNumbers && mode === 'multi';
      
      return (
        <Box key={lineIndex} flexDirection="row">
          {showLineNumber && (
            <Text color="dim">{String(lineIndex + 1).padStart(2, ' ')}  </Text>
          )}
          
          <Text color={mode === 'multi' && lineIndex > 0 ? 'cyan' : 'cyan'}>
            {mode === 'multi' && lineIndex > 0 ? '    > ' : 'lace> '}
          </Text>
          
          <Text>
            {line || (lineIndex === 0 && !line ? (
              <Text color="dim">{placeholder}</Text>
            ) : '')}
            {isCurrentLine && (
              <Text color={insertMode === 'insert' ? 'white' : 'yellow'}>
                {insertMode === 'insert' ? '|' : '█'}
              </Text>
            )}
          </Text>
        </Box>
      );
    });
  };

  return (
    <Box flexDirection="column">
      {renderLines()}
      
      {/* Completion popup */}
      {completion.active && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          padding={1}
          marginTop={1}
        >
          <Text color="yellow" bold>Completions:</Text>
          {completion.items.map((item, index) => (
            <Text
              key={index}
              color={index === completion.selectedIndex ? 'black' : 'white'}
              backgroundColor={index === completion.selectedIndex ? 'yellow' : undefined}
            >
              {item.value} {item.description && <Text color="dim">- {item.description}</Text>}
            </Text>
          ))}
        </Box>
      )}
      
      {/* History search */}
      {historyManager.searchMode && (
        <Box>
          <Text color="yellow">
            (reverse-i-search)`{historyManager.searchTerm}`: 
          </Text>
        </Box>
      )}
      
      {/* Mode indicator */}
      {mode === 'multi' && (
        <Box>
          <Text color="dim">Multi-line mode - Ctrl+Enter to submit, Esc to exit</Text>
        </Box>
      )}
    </Box>
  );
};

export default TextEditorInput;