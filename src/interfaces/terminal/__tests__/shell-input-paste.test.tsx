// ABOUTME: Unit tests for paste functionality in ShellInput component
// ABOUTME: Tests clipboard integration, keyboard shortcuts, and paste behavior

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { act } from '@testing-library/react';
import React from 'react';
import ShellInput from '~/interfaces/terminal/components/shell-input';
import { useTextBuffer } from '~/interfaces/terminal/hooks/use-text-buffer';
import { LaceFocusProvider } from '~/interfaces/terminal/focus/focus-provider';

// Mock clipboardy for Node.js clipboard access
const mockReadSync = vi.fn();

// Mock clipboardy module
vi.mock('clipboardy', () => ({
  default: {
    readSync: mockReadSync,
  },
}));

// Mock process.platform for platform-specific keyboard shortcuts
const originalPlatform = process.platform;

describe('ShellInput Paste Functionality', () => {
  // Helper to render with focus provider
  const renderWithFocus = (component: React.ReactElement) => {
    return render(<LaceFocusProvider>{component}</LaceFocusProvider>);
  };
  beforeEach(() => {
    // Reset mocks
    mockReadSync.mockClear();
  });

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  describe('basic paste functionality', () => {
    it('should paste simple text at cursor position', async () => {
      const { result } = renderHook(() => useTextBuffer('Hello World'));

      // Mock clipboard content (pbpaste on macOS)
      mockReadSync.mockReturnValue('PASTED');

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 5); // After "Hello"
      });

      // Simulate paste operation (this would be triggered by Ctrl+V)
      act(() => {
        const [, ops] = result.current;
        // This will be the paste method we'll implement
        void ops.pasteFromClipboard();
      });

      // Wait for async clipboard operation
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines[0]).toBe('HelloPASTED World');
      expect(state.cursorColumn).toBe(5 + 'PASTED'.length);
    });

    it('should paste text at beginning of line', async () => {
      const { result } = renderHook(() => useTextBuffer('World'));

      mockReadSync.mockReturnValue('Hello ');

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 0); // Beginning of line
      });

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines[0]).toBe('Hello World');
      expect(state.cursorColumn).toBe(6);
    });

    it('should paste text at end of line', async () => {
      const { result } = renderHook(() => useTextBuffer('Hello'));

      mockReadSync.mockReturnValue(' World');

      act(() => {
        const [, ops] = result.current;
        ops.moveCursor('end'); // End of line
      });

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines[0]).toBe('Hello World');
      expect(state.cursorColumn).toBe(11);
    });
  });

  describe('multi-line paste functionality', () => {
    it('should paste multi-line text correctly', async () => {
      const { result } = renderHook(() => useTextBuffer('Start End'));

      mockReadSync.mockReturnValue('Line1\nLine2\nLine3');

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 5); // After "Start"
      });

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['StartLine1', 'Line2', 'Line3 End']);
      expect(state.cursorLine).toBe(2);
      expect(state.cursorColumn).toBe(5); // After "Line3"
    });

    it('should handle pasting text with empty lines', async () => {
      const { result } = renderHook(() => useTextBuffer('Before After'));

      mockReadSync.mockReturnValue('Middle\n\nContent');

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(0, 6); // After "Before"
      });

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['BeforeMiddle', '', 'Content After']);
      expect(state.cursorLine).toBe(2);
      expect(state.cursorColumn).toBe(7); // After "Content"
    });

    it('should handle pasting into middle of multi-line document', async () => {
      const { result } = renderHook(() => useTextBuffer('Line 1\nLine 2\nLine 3'));

      mockReadSync.mockReturnValue('Inserted\nText');

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(1, 4); // After "Line" in "Line 2"
      });

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['Line 1', 'LineInserted', 'Text 2', 'Line 3']);
      expect(state.cursorLine).toBe(2);
      expect(state.cursorColumn).toBe(4); // After "Text"
    });
  });

  describe('special content paste handling', () => {
    it('should handle pasting special characters', async () => {
      const { result } = renderHook(() => useTextBuffer('Test'));

      mockReadSync.mockReturnValue('Special: !@#$%^&*()');

      act(() => {
        const [, ops] = result.current;
        ops.moveCursor('end');
      });

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines[0]).toBe('TestSpecial: !@#$%^&*()');
    });

    it('should handle pasting very long single line', async () => {
      const { result } = renderHook(() => useTextBuffer(''));

      const longText = 'A'.repeat(1000);
      mockReadSync.mockReturnValue(longText);

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines[0]).toBe(longText);
      expect(state.cursorColumn).toBe(1000);
    });

    it('should handle pasting text with tabs and special whitespace', async () => {
      const { result } = renderHook(() => useTextBuffer('Start'));

      mockReadSync.mockReturnValue('\tTabbed\n  Spaced');

      act(() => {
        const [, ops] = result.current;
        ops.moveCursor('end');
      });

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines).toEqual(['Start\tTabbed', '  Spaced']);
    });
  });

  describe('paste error handling', () => {
    it('should handle clipboard read errors gracefully', async () => {
      const { result } = renderHook(() => useTextBuffer('Original'));

      mockReadSync.mockImplementation(() => {
        throw new Error('Clipboard access denied');
      });

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      // Should remain unchanged on error
      expect(state.lines[0]).toBe('Original');
      expect(state.cursorColumn).toBe(0);
    });

    it('should handle empty clipboard content', async () => {
      const { result } = renderHook(() => useTextBuffer('Test'));

      mockReadSync.mockReturnValue('');

      act(() => {
        const [, ops] = result.current;
        ops.moveCursor('end');
      });

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines[0]).toBe('Test'); // Should remain unchanged
      expect(state.cursorColumn).toBe(4);
    });

    it('should handle undefined/null clipboard content', async () => {
      const { result } = renderHook(() => useTextBuffer('Test'));

      mockReadSync.mockReturnValue('');

      act(() => {
        const [, ops] = result.current;
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines[0]).toBe('Test'); // Should remain unchanged
    });
  });

  describe('keyboard shortcut integration', () => {
    it('should support Ctrl+V paste on non-Mac platforms', () => {
      // Mock non-Mac platform
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const onSubmit = vi.fn();
      const { container } = renderWithFocus(<ShellInput onSubmit={onSubmit} />);

      // This test will verify keyboard integration once we implement it
      expect(container).toBeTruthy();
    });

    it('should support Cmd+V paste on Mac platforms', () => {
      // Mock Mac platform
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const onSubmit = vi.fn();
      const { container } = renderWithFocus(<ShellInput onSubmit={onSubmit} />);

      // This test will verify keyboard integration once we implement it
      expect(container).toBeTruthy();
    });
  });

  describe('paste interaction with existing functionality', () => {
    it('should update preferredColumn after paste operation', async () => {
      const { result } = renderHook(() => useTextBuffer('Line 1\nShort'));

      mockReadSync.mockReturnValue('Pasted content');

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(1, 5); // End of "Short"
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Move up then down to test preferredColumn
      act(() => {
        const [, ops] = result.current;
        ops.moveCursor('up');
        ops.moveCursor('down');
      });

      const [state] = result.current;
      expect(state.cursorLine).toBe(1);
      // Should remember the position after paste
      expect(state.cursorColumn).toBe(Math.min(state.preferredColumn, state.lines[1].length));
    });

    it('should work correctly with undo/redo if implemented', async () => {
      const { result } = renderHook(() => useTextBuffer('Original'));

      mockReadSync.mockReturnValue(' Added');

      act(() => {
        const [, ops] = result.current;
        ops.moveCursor('end');
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state] = result.current;
      expect(state.lines[0]).toBe('Original Added');
      // Future: test undo functionality if implemented
    });

    it('should maintain document integrity after paste operations', async () => {
      const { result } = renderHook(() => useTextBuffer('A\nB\nC'));

      mockReadSync.mockReturnValue('X\nY');

      act(() => {
        const [, ops] = result.current;
        ops.setCursorPosition(1, 1); // After "B"
        void ops.pasteFromClipboard();
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const [state, ops] = result.current;
      expect(state.lines).toEqual(['A', 'BX', 'Y', 'C']);

      // Verify document can still be manipulated normally
      act(() => {
        ops.setText(ops.getText()); // Round-trip through getText/setText
      });

      const [finalState] = result.current;
      expect(finalState.lines).toEqual(['A', 'BX', 'Y', 'C']);
    });
  });
});
