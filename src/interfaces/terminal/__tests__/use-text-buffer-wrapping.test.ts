// ABOUTME: Unit tests for text buffer cursor positioning during text wrapping
// ABOUTME: Tests cursor behavior with long lines, text overflow, and multi-line content

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from '@testing-library/react';
import { useTextBuffer } from '../hooks/use-text-buffer.js';

describe('useTextBuffer Text Wrapping and Cursor Positioning', () => {
  describe('cursor positioning with long lines', () => {
    it('should maintain cursor position when inserting text that causes wrapping', () => {
      const { result } = renderHook(() => useTextBuffer('Short line'));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 5); // After "Short"
        ops.insertText(
          ' very long text that would wrap in a terminal with limited width like this one here'
        );
      });

      const [state] = result.current;
      // Should maintain logical cursor position despite potential wrapping
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(
        5 +
          ' very long text that would wrap in a terminal with limited width like this one here'
            .length
      );
    });

    it('should handle cursor movement on very long single lines', () => {
      const longLine =
        'This is a very long line that would definitely wrap in most terminal displays and we need to ensure cursor movement works correctly even when the visual presentation wraps to multiple rows';
      const { result } = renderHook(() => useTextBuffer(longLine));

      act(() => {
        const [, ops] = result.current;
        // Move to middle of long line
        ops.setCursorPosition(0, 50);
        // Move cursor left and right
        ops.moveCursor('left');
        ops.moveCursor('left');
        ops.moveCursor('right');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0); // Still on same logical line
      expect(state.cursorColumn).toBe(49); // Moved left twice, then right once from position 50
    });

    it('should handle cursor at end of long line', () => {
      const longLine =
        'Another very long line that exceeds typical terminal width and should test edge cases';
      const { result } = renderHook(() => useTextBuffer(longLine));

      act(() => {
        const [, ops] = result.current;
        ops.moveCursor('end');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(longLine.length);
    });

    it('should handle home/end navigation on wrapped lines', () => {
      const longLine = 'Yet another long line for testing home and end navigation behavior';
      const { result } = renderHook(() => useTextBuffer(longLine));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 30); // Middle of line
        ops.moveCursor('home');
      });

      let [state] = result.current;
      expect(state.cursorColumn).toBe(0);

      act(() => {
        const [, ops] = result.current;
        ops.moveCursor('end');
      });

      [state] = result.current;
      expect(state.cursorColumn).toBe(longLine.length);
    });
  });

  describe('cursor behavior during text insertion in long lines', () => {
    it('should maintain cursor position when inserting in middle of long line', () => {
      const { result } = renderHook(() =>
        useTextBuffer('Beginning very long content that continues for a while here end')
      );

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 20); // In middle
        ops.insertText('INSERTED');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(20 + 'INSERTED'.length);
      expect(state.lines[0]).toContain('INSERTED');
    });

    it('should handle multiple insertions that extend line length', () => {
      const { result } = renderHook(() => useTextBuffer('Start'));

      act(() => {
        const [, ops] = result.current;
        ops.moveCursor('end');
        // Add text multiple times to create a very long line
        ops.insertText(' adding more');
        ops.insertText(' and more text');
        ops.insertText(' to make this line extremely long');
        ops.insertText(' so it would wrap in terminal display');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.lines[0]).toBe(
        'Start adding more and more text to make this line extremely long so it would wrap in terminal display'
      );
      expect(state.cursorColumn).toBe(state.lines[0].length);
    });

    it('should handle character deletion at various positions in long lines', () => {
      const longLine = 'This is a long line with multiple words that we will test deletion on';
      const { result } = renderHook(() => useTextBuffer(longLine));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 10); // After "This is a "
        ops.deleteChar('backward'); // Delete the space
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(9);
      expect(state.lines[0]).toBe(
        'This is along line with multiple words that we will test deletion on'
      );
    });
  });

  describe('cursor behavior with mixed long and short lines', () => {
    it('should handle cursor movement between long and short lines', () => {
      const text =
        'Short\nThis is a very long line that would wrap in most terminals\nAnother short line';
      const { result } = renderHook(() => useTextBuffer(text));

      act(() => {
        const [, ops] = result.current;
        // Start on long line
        ops.setCursorPosition(1, 30);
        // Move up to short line
        ops.moveCursor('up');
      });

      let [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(Math.min(30, state.lines[0].length)); // Constrained to line length

      act(() => {
        const [, ops] = result.current;
        // Move back down to long line
        ops.moveCursor('down');
      });

      [state] = result.current;
      expect(state.cursorLine).toBe(1);
      expect(state.cursorColumn).toBe(Math.min(30, state.lines[1].length));
    });

    it('should handle cursor wrapping at line boundaries with mixed lengths', () => {
      const text =
        'Short line\nVery long line that extends far beyond normal terminal width and keeps going\nShort';
      const { result } = renderHook(() => useTextBuffer(text));

      act(() => {
        const [, ops] = result.current;
        // Go to end of first short line
        ops.setCursorPosition(0, 10);
        // Move right to wrap to next line
        ops.moveCursor('right');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(1);
      expect(state.cursorColumn).toBe(0);
    });

    it('should handle cursor wrapping backwards from long to short lines', () => {
      const text = 'Short line\nVery long line that extends far beyond normal terminal width';
      const { result } = renderHook(() => useTextBuffer(text));

      act(() => {
        const [, ops] = result.current;
        // Go to beginning of long line
        ops.setCursorPosition(1, 0);
        // Move left to wrap to previous line
        ops.moveCursor('left');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(state.lines[0].length); // End of previous line
    });
  });

  describe('edge cases for wrapped text cursor positioning', () => {
    it('should handle empty lines mixed with long lines', () => {
      const text = '\nVery long line that would wrap\n\nAnother long line';
      const { result } = renderHook(() => useTextBuffer(text));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(1, 20); // Middle of long line
        ops.moveCursor('up'); // To empty line
      });

      let [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(0); // Empty line constrains cursor

      act(() => {
        const [, ops] = result.current;
        ops.moveCursor('down'); // Back to long line
      });

      [state] = result.current;
      expect(state.cursorLine).toBe(1);
      expect(state.cursorColumn).toBe(20); // Should restore position where possible
    });

    it('should handle cursor position when adding newlines to long lines', () => {
      const longLine = 'This is a very long line that we will split with newlines';
      const { result } = renderHook(() => useTextBuffer(longLine));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 20); // Middle of line
        ops.insertText('\n');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(1);
      expect(state.cursorColumn).toBe(0);
      expect(state.lines).toHaveLength(2);
      expect(state.lines[0]).toBe('This is a very long ');
      expect(state.lines[1]).toBe('line that we will split with newlines');
    });

    it('should handle cursor position when removing newlines from split long lines', () => {
      const text = 'This is a very long\nline that was split';
      const { result } = renderHook(() => useTextBuffer(text));

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(1, 0); // Beginning of second line
        ops.deleteChar('backward'); // Delete newline
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe('This is a very long'.length);
      expect(state.lines).toHaveLength(1);
      expect(state.lines[0]).toBe('This is a very longline that was split');
    });

    it('should maintain cursor bounds when line shortens due to deletion', () => {
      const { result } = renderHook(() =>
        useTextBuffer('Very long line with lots of content here')
      );

      act(() => {
        const [, ops] = result.current;
        // Position cursor at end
        ops.moveCursor('end');
        // Delete large portion of line
        ops.setCursorPosition(0, 10);
        ops.killLine(); // Delete from cursor to end
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(0);
      expect(state.cursorColumn).toBe(10);
      expect(state.lines[0]).toBe('Very long ');
    });
  });
});
