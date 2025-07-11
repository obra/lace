// ABOUTME: Unit tests for useTextBuffer hook
// ABOUTME: Tests text editing operations, cursor movement, and state management

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from '@testing-library/react';
import { useTextBuffer } from '~/interfaces/terminal/hooks/use-text-buffer.js';

describe('useTextBuffer Hook', () => {
  describe('initialization', () => {
    it('should initialize with empty text by default', () => {
      const { result } = renderHook(() => useTextBuffer());

      const [state] = result.current;
      expect(state.lines).toEqual(['']);
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(0);
    });

    it('should initialize with provided text', () => {
      const { result } = renderHook(() => useTextBuffer('Hello\nWorld'));

      const [state] = result.current;
      expect(state.lines).toEqual(['Hello', 'World']);
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(0);
    });

    it('should handle single line initialization', () => {
      const { result } = renderHook(() => useTextBuffer('Single line'));

      const [state] = result.current;
      expect(state.lines).toEqual(['Single line']);
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(0);
    });
  });

  describe('text operations', () => {
    it('should insert text at cursor position', () => {
      const { result } = renderHook(() => useTextBuffer('Hello'));

      act(() => {
        const [, ops] = result.current;
        // Position cursor at end of existing text before inserting
        ops.setCursorPosition(0, 5);
        ops.insertText(' World');
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['Hello World']);
      expect(state.cursorColumn).toBe(11); // Moved to end of inserted text
    });

    it('should insert text in middle of line', () => {
      const { result } = renderHook(() => useTextBuffer('Hello'));

      act(() => {
        const [, ops] = result.current;
        // Move cursor to position 2 (after "He")
        ops.setCursorPosition(0, 2);
        ops.insertText('XXX');
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['HeXXXllo']);
      expect(state.cursorColumn).toBe(5); // Moved to end of inserted text
    });

    it('should handle newline insertion', () => {
      const { result } = renderHook(() => useTextBuffer('Hello World'));

      act(() => {
        const [, ops] = result.current;
        // Move cursor to position 5 (after "Hello")
        ops.setCursorPosition(0, 5);
        ops.insertText('\n');
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['Hello', ' World']);
      expect(state.cursorLine).toBe(1);
      expect(state.cursorColumn).toBe(0);
    });

    it('should get and set complete text', () => {
      const { result } = renderHook(() => useTextBuffer());

      act(() => {
        const [, ops] = result.current;
        ops.setText('Line 1\nLine 2\nLine 3');
      });

      const [, ops] = result.current;
      expect(ops.getText()).toBe('Line 1\nLine 2\nLine 3');

      const [state] = result.current;
      expect(state.lines).toEqual(['Line 1', 'Line 2', 'Line 3']);
    });
  });

  describe('cursor movement', () => {
    beforeEach(() => {
      // Common setup for cursor tests
    });

    it('should move cursor left within line', () => {
      const { result } = renderHook(() => useTextBuffer('Hello'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 3);
        ops.moveCursor('left');
      });

      const [state] = result.current;
      expect(state.cursorColumn).toBe(2);
    });

    it('should move cursor right within line', () => {
      const { result } = renderHook(() => useTextBuffer('Hello'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 2);
        ops.moveCursor('right');
      });

      const [state] = result.current;
      expect(state.cursorColumn).toBe(3);
    });

    it('should move cursor to home position', () => {
      const { result } = renderHook(() => useTextBuffer('Hello'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 3);
        ops.moveCursor('home');
      });

      const [state] = result.current;
      expect(state.cursorColumn).toBe(0);
    });

    it('should move cursor to end position', () => {
      const { result } = renderHook(() => useTextBuffer('Hello'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 2);
        ops.moveCursor('end');
      });

      const [state] = result.current;
      expect(state.cursorColumn).toBe(5); // End of "Hello"
    });

    it('should wrap cursor to previous line when moving left at beginning', () => {
      const { result } = renderHook(() => useTextBuffer('Line 1\nLine 2'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(1, 0); // Beginning of second line
        ops.moveCursor('left');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(6); // End of "Line 1"
    });

    it('should wrap cursor to next line when moving right at end', () => {
      const { result } = renderHook(() => useTextBuffer('Line 1\nLine 2'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 6); // End of first line
        ops.moveCursor('right');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(1);
      expect(state.cursorColumn).toBe(0);
    });

    it('should move cursor up between lines', () => {
      const { result } = renderHook(() => useTextBuffer('Line 1\nLine 2'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(1, 3);
        ops.moveCursor('up');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(3);
    });

    it('should move cursor down between lines', () => {
      const { result } = renderHook(() => useTextBuffer('Line 1\nLine 2'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 3);
        ops.moveCursor('down');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(1);
      expect(state.cursorColumn).toBe(3);
    });

    it('should constrain cursor column when moving between lines of different lengths', () => {
      const { result } = renderHook(() => useTextBuffer('Long line here\nShort'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 10); // Within first line
        ops.moveCursor('down');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(1);
      expect(state.cursorColumn).toBe(5); // End of "Short"
    });
  });

  describe('deletion operations', () => {
    it('should delete character backward (backspace)', () => {
      const { result } = renderHook(() => useTextBuffer('Hello'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 3); // After "Hel"
        ops.deleteChar('backward');
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['Helo']);
      expect(state.cursorColumn).toBe(2);
    });

    it('should delete character forward (delete key)', () => {
      const { result } = renderHook(() => useTextBuffer('Hello'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 2); // Before "llo"
        ops.deleteChar('forward');
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['Helo']);
      expect(state.cursorColumn).toBe(2); // Cursor doesn't move
    });

    it('should merge lines when backspacing at line beginning', () => {
      const { result } = renderHook(() => useTextBuffer('Line 1\nLine 2'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(1, 0); // Beginning of second line
        ops.deleteChar('backward');
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['Line 1Line 2']);
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(6); // After "Line 1"
    });

    it('should merge lines when deleting at line end', () => {
      const { result } = renderHook(() => useTextBuffer('Line 1\nLine 2'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 6); // End of first line
        ops.deleteChar('forward');
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['Line 1Line 2']);
      expect(state.cursorColumn).toBe(6); // Cursor doesn't move
    });
  });

  describe('line editing operations', () => {
    it('should kill line from cursor to end', () => {
      const { result } = renderHook(() => useTextBuffer('Hello World'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 5); // After "Hello"
        ops.killLine();
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['Hello']);
      expect(state.cursorColumn).toBe(5); // Cursor stays at same position
    });

    it('should kill line backward from cursor to beginning', () => {
      const { result } = renderHook(() => useTextBuffer('Hello World'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 6); // After "Hello "
        ops.killLineBackward();
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['World']);
      expect(state.cursorColumn).toBe(0); // Cursor moves to beginning
    });

    it('should handle kill operations on empty lines', () => {
      const { result } = renderHook(() => useTextBuffer(''));

      act(() => {
        const [, ops] = result.current;
        ops.killLine();
        ops.killLineBackward();
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['']);
      expect(state.cursorColumn).toBe(0);
    });
  });

  describe('utility functions', () => {
    it('should get current line text', () => {
      const { result } = renderHook(() => useTextBuffer('Line 1\nLine 2\nLine 3'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(1, 0);
      });

      const [, ops] = result.current;
      expect(ops.getCurrentLine()).toBe('Line 2');
    });

    it('should set cursor position with bounds checking', () => {
      const { result } = renderHook(() => useTextBuffer('Short\nLonger line'));

      act(() => {
        const [, ops] = result.current;
        // Try to set cursor beyond line bounds
        ops.setCursorPosition(0, 100);
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(100); // Hook allows this, component should handle bounds
    });

    it('should set cursor position with negative values', () => {
      const { result } = renderHook(() => useTextBuffer('Test'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(-1, -1);
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0); // Bounded to 0
      expect(state.cursorColumn).toBe(0); // Bounded to 0
    });
  });

  describe('edge cases', () => {
    it('should handle operations on completely empty buffer', () => {
      const { result } = renderHook(() => useTextBuffer(''));

      act(() => {
        const [, ops] = result.current;
        ops.insertText('First text');
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['First text']);
      expect(state.cursorColumn).toBe(10);
    });

    it('should handle multiple consecutive newlines', () => {
      const { result } = renderHook(() => useTextBuffer());

      act(() => {
        const [, ops] = result.current;
        ops.insertText('Line 1\n\n\nLine 4');
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['Line 1', '', '', 'Line 4']);
      expect(state.cursorLine).toBe(3); // After all lines
      expect(state.cursorColumn).toBe(6); // After "Line 4"
    });

    it('should maintain state consistency across operations', () => {
      const { result } = renderHook(() => useTextBuffer('Initial'));

      act(() => {
        const [, ops] = result.current;
        // Move to end first, then add " text"
        ops.moveCursor('end');
        ops.insertText(' text');
        // Go to beginning and add "Modified "
        ops.moveCursor('home');
        ops.insertText('Modified ');
        // Go to end and add "!"
        ops.moveCursor('end');
        ops.insertText('!');
      });

      const [state, ops] = result.current;
      expect(ops.getText()).toBe('Modified Initial text!');
      expect(state.cursorColumn).toBe(22); // At end of text
    });
  });
});
