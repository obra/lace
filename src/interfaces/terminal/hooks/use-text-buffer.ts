// ABOUTME: Custom hook for managing text buffer state and operations
// ABOUTME: Handles lines, cursor position, and text manipulation without UI concerns

import { useState, useCallback } from 'react';
import { logger } from '../../../utils/logger.js';

/**
 * Represents the current state of the text buffer.
 */
export interface TextBufferState {
  /** Array of text lines in the buffer */
  lines: string[];
  /** Current line index (0-based) where the cursor is positioned */
  cursorLine: number;
  /** Current column index (0-based) where the cursor is positioned */
  cursorColumn: number;
  /** Remembers desired column for up/down movement to prevent cursor drift */
  preferredColumn: number;
}

/**
 * Operations available for manipulating the text buffer.
 */
export interface TextBufferOperations {
  /** Insert text at the current cursor position, handling newlines appropriately */
  insertText: (text: string) => void;
  /** Delete a character in the specified direction from the cursor position */
  deleteChar: (direction: 'forward' | 'backward') => void;
  /** Move the cursor in the specified direction, maintaining preferred column for vertical movement */
  moveCursor: (direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'end') => void;
  /** Replace the entire buffer content with new text */
  setText: (text: string) => void;
  /** Get the complete buffer content as a single string with newlines */
  getText: () => string;
  /** Set the cursor to a specific line and column position */
  setCursorPosition: (line: number, column: number) => void;
  /** Get the text content of the current line */
  getCurrentLine: () => string;
  /** Delete from cursor position to end of current line (Ctrl+K behavior) */
  killLine: () => void;
  /** Delete from beginning of current line to cursor position (Ctrl+U behavior) */
  killLineBackward: () => void;
  /** Paste text from system clipboard at cursor position */
  pasteFromClipboard: () => Promise<void>;
}

/**
 * Custom React hook for managing text buffer state and operations.
 *
 * Provides a complete text editing experience with multi-line support, cursor positioning,
 * and common text manipulation operations. Features include:
 * - Multi-line text editing with proper newline handling
 * - Cursor positioning with preferred column memory for vertical navigation
 * - Standard editing operations (insertion, deletion, cursor movement)
 * - Clipboard integration for paste operations
 * - Line manipulation commands (kill line, kill line backward)
 *
 * @param initialText - Initial text content for the buffer (defaults to empty string)
 * @returns A tuple containing [current state, operations object]
 */
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
          return {
            ...prevState,
            cursorColumn: currentLine.length,
            preferredColumn: currentLine.length,
          };
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
      // Handle clipboard access errors gracefully
      logger.debug('Failed to read from clipboard', {
        error: error instanceof Error ? error.message : String(error),
      });
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
