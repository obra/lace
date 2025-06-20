// ABOUTME: Custom hook for managing text buffer state and operations
// ABOUTME: Handles lines, cursor position, and text manipulation without UI concerns

import { useState, useCallback } from 'react';

export interface TextBufferState {
  lines: string[];
  cursorLine: number;
  cursorColumn: number;
  preferredColumn: number; // Remembers desired column for up/down movement
}

export interface TextBufferOperations {
  insertText: (text: string) => void;
  deleteChar: (direction: 'forward' | 'backward') => void;
  moveCursor: (direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'end') => void;
  setText: (text: string) => void;
  getText: () => string;
  setCursorPosition: (line: number, column: number) => void;
  getCurrentLine: () => string;
  killLine: () => void;
  killLineBackward: () => void;
  pasteFromClipboard: () => Promise<void>;
}

export function useTextBuffer(initialText: string = ''): [TextBufferState, TextBufferOperations] {
  const [state, setState] = useState<TextBufferState>(() => ({
    lines: initialText.split('\n'),
    cursorLine: 0,
    cursorColumn: 0,
    preferredColumn: 0,
  }));

  const insertText = useCallback((text: string) => {
    setState((prevState) => {
      const { lines, cursorLine, cursorColumn } = prevState;

      if (text.includes('\n')) {
        // Handle text with newlines - split and insert properly
        const insertParts = text.split('\n');
        const currentLine = lines[cursorLine] || '';
        const beforeCursor = currentLine.slice(0, cursorColumn);
        const afterCursor = currentLine.slice(cursorColumn);

        const newLines = [...lines];

        // First part goes on current line
        newLines[cursorLine] = beforeCursor + insertParts[0];

        // Insert middle parts as new lines
        for (let i = 1; i < insertParts.length - 1; i++) {
          newLines.splice(cursorLine + i, 0, insertParts[i]);
        }

        // Last part goes on a new line (or merges with afterCursor)
        if (insertParts.length > 1) {
          const lastPart = insertParts[insertParts.length - 1];
          newLines.splice(cursorLine + insertParts.length - 1, 0, lastPart + afterCursor);

          return {
            lines: newLines,
            cursorLine: cursorLine + insertParts.length - 1,
            cursorColumn: lastPart.length,
            preferredColumn: lastPart.length,
          };
        } else {
          // Single line with cursor after inserted text
          return {
            lines: newLines,
            cursorLine: cursorLine,
            cursorColumn: cursorColumn + text.length,
            preferredColumn: cursorColumn + text.length,
          };
        }
      } else {
        // Regular text without newlines
        const currentLine = lines[cursorLine] || '';
        const newLine = currentLine.slice(0, cursorColumn) + text + currentLine.slice(cursorColumn);

        const newLines = [...lines];
        newLines[cursorLine] = newLine;

        return {
          lines: newLines,
          cursorLine: cursorLine,
          cursorColumn: cursorColumn + text.length,
          preferredColumn: cursorColumn + text.length,
        };
      }
    });
  }, []);

  const deleteChar = useCallback((direction: 'forward' | 'backward') => {
    setState((prevState) => {
      const { lines, cursorLine, cursorColumn } = prevState;

      if (direction === 'backward' && cursorColumn > 0) {
        // Simple backspace within line
        const currentLine = lines[cursorLine] || '';
        const newLine = currentLine.slice(0, cursorColumn - 1) + currentLine.slice(cursorColumn);
        const newLines = [...lines];
        newLines[cursorLine] = newLine;

        return {
          lines: newLines,
          cursorLine,
          cursorColumn: cursorColumn - 1,
          preferredColumn: cursorColumn - 1,
        };
      } else if (direction === 'backward' && cursorLine > 0) {
        // Merge with previous line
        const currentLine = lines[cursorLine] || '';
        const prevLine = lines[cursorLine - 1];
        const mergedLine = prevLine + currentLine;
        const newLines = [...lines];
        newLines[cursorLine - 1] = mergedLine;
        newLines.splice(cursorLine, 1);

        return {
          lines: newLines,
          cursorLine: cursorLine - 1,
          cursorColumn: prevLine.length,
          preferredColumn: prevLine.length,
        };
      } else if (direction === 'forward') {
        const currentLine = lines[cursorLine] || '';
        if (cursorColumn < currentLine.length) {
          const newLine = currentLine.slice(0, cursorColumn) + currentLine.slice(cursorColumn + 1);
          const newLines = [...lines];
          newLines[cursorLine] = newLine;

          return {
            lines: newLines,
            cursorLine,
            cursorColumn, // Cursor doesn't move
            preferredColumn: cursorColumn,
          };
        } else if (cursorLine < lines.length - 1) {
          // Merge with next line
          const nextLine = lines[cursorLine + 1];
          const mergedLine = currentLine + nextLine;
          const newLines = [...lines];
          newLines[cursorLine] = mergedLine;
          newLines.splice(cursorLine + 1, 1);

          return {
            lines: newLines,
            cursorLine,
            cursorColumn, // Cursor doesn't move
            preferredColumn: cursorColumn,
          };
        }
      }

      return prevState; // No change
    });
  }, []);

  const moveCursor = useCallback((direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'end') => {
    setState((prevState) => {
      const { lines, cursorLine, cursorColumn } = prevState;
      const currentLine = lines[cursorLine] || '';

      switch (direction) {
        case 'left':
          if (cursorColumn > 0) {
            const newColumn = cursorColumn - 1;
            return { ...prevState, cursorColumn: newColumn, preferredColumn: newColumn };
          } else if (cursorLine > 0) {
            const newColumn = lines[cursorLine - 1].length;
            return {
              ...prevState,
              cursorLine: cursorLine - 1,
              cursorColumn: newColumn,
              preferredColumn: newColumn,
            };
          }
          break;
        case 'right':
          if (cursorColumn < currentLine.length) {
            const newColumn = cursorColumn + 1;
            return { ...prevState, cursorColumn: newColumn, preferredColumn: newColumn };
          } else if (cursorLine < lines.length - 1) {
            return {
              ...prevState,
              cursorLine: cursorLine + 1,
              cursorColumn: 0,
              preferredColumn: 0,
            };
          }
          break;
        case 'up':
          if (cursorLine > 0) {
            const targetColumn = Math.min(prevState.preferredColumn, lines[cursorLine - 1].length);
            return {
              ...prevState,
              cursorLine: cursorLine - 1,
              cursorColumn: targetColumn,
              // Keep preferredColumn unchanged
            };
          }
          break;
        case 'down':
          if (cursorLine < lines.length - 1) {
            const targetColumn = Math.min(prevState.preferredColumn, lines[cursorLine + 1].length);
            return {
              ...prevState,
              cursorLine: cursorLine + 1,
              cursorColumn: targetColumn,
              // Keep preferredColumn unchanged
            };
          }
          break;
        case 'home':
          return { ...prevState, cursorColumn: 0, preferredColumn: 0 };
        case 'end':
          return { ...prevState, cursorColumn: currentLine.length, preferredColumn: currentLine.length };
      }

      return prevState; // No change
    });
  }, []);

  const setText = useCallback((text: string) => {
    setState((prevState) => {
      const newLines = text.split('\n');
      return {
        lines: newLines,
        cursorLine: Math.min(newLines.length - 1, prevState.cursorLine),
        cursorColumn: 0,
        preferredColumn: 0,
      };
    });
  }, []);

  const getText = useCallback(() => {
    return state.lines.join('\n');
  }, [state.lines]);

  const setCursorPosition = useCallback((line: number, column: number) => {
    setState((prevState) => {
      const newColumn = Math.max(0, column);
      return {
        ...prevState,
        cursorLine: Math.max(0, Math.min(line, prevState.lines.length - 1)),
        cursorColumn: newColumn,
        preferredColumn: newColumn,
      };
    });
  }, []);

  const getCurrentLine = useCallback(() => {
    return state.lines[state.cursorLine] || '';
  }, [state.lines, state.cursorLine]);

  const killLine = useCallback(() => {
    setState((prevState) => {
      const { lines, cursorLine, cursorColumn } = prevState;
      const currentLine = lines[cursorLine] || '';

      if (cursorColumn < currentLine.length) {
        // Kill from cursor to end of line
        const newLine = currentLine.slice(0, cursorColumn);
        const newLines = [...lines];
        newLines[cursorLine] = newLine;

        return {
          ...prevState,
          lines: newLines,
          // Cursor stays at same position, update preferredColumn to match
          preferredColumn: cursorColumn,
        };
      }

      return prevState;
    });
  }, []);

  const killLineBackward = useCallback(() => {
    setState((prevState) => {
      const { lines, cursorLine, cursorColumn } = prevState;
      const currentLine = lines[cursorLine] || '';

      if (cursorColumn > 0) {
        // Kill from beginning of line to cursor
        const newLine = currentLine.slice(cursorColumn);
        const newLines = [...lines];
        newLines[cursorLine] = newLine;

        return {
          ...prevState,
          lines: newLines,
          cursorColumn: 0,
          preferredColumn: 0,
        };
      }

      return prevState;
    });
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      // Check if clipboard API is available
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
        console.warn('Clipboard API not available');
        return;
      }

      const clipboardText = await navigator.clipboard.readText();
      
      // Handle empty or null clipboard content
      if (!clipboardText) {
        return;
      }

      // Use the existing insertText method to handle the paste
      insertText(clipboardText);
    } catch (error) {
      // Silently handle clipboard access errors
      console.warn('Failed to read from clipboard:', error);
    }
  }, [insertText]);

  const operations: TextBufferOperations = {
    insertText,
    deleteChar,
    moveCursor,
    setText,
    getText,
    setCursorPosition,
    getCurrentLine,
    killLine,
    killLineBackward,
    pasteFromClipboard,
  };

  return [state, operations];
}
