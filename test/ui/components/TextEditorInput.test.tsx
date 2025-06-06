// ABOUTME: Comprehensive test suite for TextEditorInput component
// ABOUTME: Tests all shell+editor features including multi-line, completion, and history

import React from 'react';
import { render } from 'ink-testing-library';
import TextEditorInput from '../../../src/ui/components/TextEditorInput';

describe('TextEditorInput', () => {
  describe('Basic Rendering', () => {
    it('renders with default placeholder', () => {
      const { lastFrame } = render(<TextEditorInput />);
      expect(lastFrame()).toContain('Type your message...');
      expect(lastFrame()).toContain('lace>');
    });

    it('renders with custom placeholder', () => {
      const { lastFrame } = render(
        <TextEditorInput placeholder="Custom placeholder..." />
      );
      expect(lastFrame()).toContain('Custom placeholder...');
    });

    it('shows cursor in default state', () => {
      const { lastFrame } = render(<TextEditorInput />);
      expect(lastFrame()).toContain('|');
    });

    it('can be disabled', () => {
      const { lastFrame, stdin } = render(<TextEditorInput isDisabled />);
      stdin.write('test');
      expect(lastFrame()).not.toContain('test');
    });
  });

  describe('Basic Text Input', () => {
    it('accepts and displays character input', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      expect(lastFrame()).toContain('hello');
    });

    it('handles backspace correctly', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write('\b'); // backspace
      expect(lastFrame()).toContain('hell');
    });

    it('calls onChange when text changes', () => {
      const onChange = jest.fn();
      const { stdin } = render(<TextEditorInput onChange={onChange} />);
      
      stdin.write('test');
      
      // onChange should be called (debounced)
      setTimeout(() => {
        expect(onChange).toHaveBeenCalledWith('test');
      }, 150);
    });

    it('submits on Enter in single-line mode', () => {
      const onSubmit = jest.fn();
      const { stdin } = render(
        <TextEditorInput onSubmit={onSubmit} multiLine={false} />
      );
      
      stdin.write('hello');
      stdin.write('\r'); // Enter key
      
      expect(onSubmit).toHaveBeenCalledWith('hello');
    });
  });

  describe('Cursor Navigation', () => {
    it('moves cursor left with arrow key', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write('\u001b[D'); // Left arrow
      stdin.write('X');
      expect(lastFrame()).toContain('hellXo');
    });

    it('moves cursor right with arrow key', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write('\u001b[D'); // Left arrow
      stdin.write('\u001b[C'); // Right arrow  
      stdin.write('X');
      expect(lastFrame()).toContain('helloX');
    });

    it('moves cursor by word with Ctrl+Arrow', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello world test');
      stdin.write('\u001b[1;5D'); // Ctrl+Left
      stdin.write('X');
      expect(lastFrame()).toContain('hello world Xtest');
    });

    it('moves to beginning of line with Home', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write('\u001b[H'); // Home key
      stdin.write('X');
      expect(lastFrame()).toContain('Xhello');
    });

    it('moves to end of line with End', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write('\u001b[H'); // Home key
      stdin.write('\u001b[F'); // End key
      stdin.write('X');
      expect(lastFrame()).toContain('helloX');
    });
  });

  describe('Multi-line Mode', () => {
    it('enters multi-line mode with Shift+Enter', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('line1');
      stdin.write('\u001b[1;2m\r'); // Shift+Enter (simulated)
      expect(lastFrame()).toContain('Multi-line mode');
      expect(lastFrame()).toContain('    >');
    });

    it('continues line with backslash', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('line1\\');
      stdin.write('\r'); // Enter
      expect(lastFrame()).toContain('    >');
      expect(lastFrame()).not.toContain('\\');
    });

    it('submits with Ctrl+Enter in multi-line mode', () => {
      const onSubmit = jest.fn();
      const { stdin } = render(<TextEditorInput onSubmit={onSubmit} />);
      
      stdin.write('line1');
      stdin.write('\u001b[1;2m\r'); // Shift+Enter (enter multi-line)
      stdin.write('line2');
      stdin.write('\u001b[1;5m\r'); // Ctrl+Enter
      
      expect(onSubmit).toHaveBeenCalledWith('line1\nline2');
    });

    it('submits with empty line in multi-line mode', () => {
      const onSubmit = jest.fn();
      const { stdin } = render(<TextEditorInput onSubmit={onSubmit} />);
      
      stdin.write('line1');
      stdin.write('\r'); // Enter (creates new line)
      stdin.write('\r'); // Enter on empty line (submits)
      
      expect(onSubmit).toHaveBeenCalledWith('line1\n');
    });

    it('navigates between lines with up/down arrows', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('line1');
      stdin.write('\r'); // Enter
      stdin.write('line2');
      stdin.write('\u001b[A'); // Up arrow
      stdin.write('X');
      expect(lastFrame()).toContain('line1X');
    });

    it('exits multi-line mode with Escape', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('line1');
      stdin.write('\r'); // Enter
      stdin.write('line2');
      stdin.write('\u001b[27m'); // Escape
      expect(lastFrame()).toContain('line1 line2');
      expect(lastFrame()).not.toContain('Multi-line mode');
    });

    it('shows line numbers when enabled', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput showLineNumbers />
      );
      stdin.write('line1');
      stdin.write('\r'); // Enter
      stdin.write('line2');
      expect(lastFrame()).toContain(' 1  ');
      expect(lastFrame()).toContain(' 2  ');
    });
  });

  describe('Word Operations', () => {
    it('deletes word with Ctrl+Backspace', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello world');
      stdin.write('\u001b[1;5m\b'); // Ctrl+Backspace
      expect(lastFrame()).toContain('hello ');
    });

    it('deletes word forward with Ctrl+Delete', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello world');
      stdin.write('\u001b[D'); // Left arrow
      stdin.write('\u001b[D'); // Left arrow  
      stdin.write('\u001b[1;5m\u001b[3~'); // Ctrl+Delete
      expect(lastFrame()).toContain('hello wo');
    });
  });

  describe('History Management', () => {
    const testHistory = ['first command', 'second command', 'third command'];

    it('navigates history with up arrow in single-line mode', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput history={testHistory} multiLine={false} />
      );
      stdin.write('\u001b[A'); // Up arrow
      expect(lastFrame()).toContain('third command');
    });

    it('navigates history with down arrow', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput history={testHistory} multiLine={false} />
      );
      stdin.write('\u001b[A'); // Up arrow
      stdin.write('\u001b[A'); // Up arrow
      stdin.write('\u001b[B'); // Down arrow
      expect(lastFrame()).toContain('third command');
    });

    it('cycles through entire history', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput history={testHistory} multiLine={false} />
      );
      
      // Go to oldest entry
      stdin.write('\u001b[A'); // third
      stdin.write('\u001b[A'); // second  
      stdin.write('\u001b[A'); // first
      
      expect(lastFrame()).toContain('first command');
    });

    it('returns to empty input when going beyond history', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput history={testHistory} multiLine={false} />
      );
      
      stdin.write('\u001b[A'); // Up arrow (third command)
      stdin.write('\u001b[B'); // Down arrow (back to empty)
      
      expect(lastFrame()).toContain('Type your message...');
    });

    it('enters history search mode with Ctrl+R', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput history={testHistory} />
      );
      stdin.write('\u0012'); // Ctrl+R
      expect(lastFrame()).toContain('(reverse-i-search)');
    });
  });

  describe('Completion System', () => {
    const mockCommandCompletion = jest.fn();
    const mockFileCompletion = jest.fn();

    beforeEach(() => {
      mockCommandCompletion.mockReturnValue([
        { value: '/help', description: 'Show help', type: 'command' },
        { value: '/history', description: 'Show history', type: 'command' }
      ]);
      
      mockFileCompletion.mockReturnValue([
        { value: './test.txt', description: 'Text file', type: 'file' },
        { value: './src/', description: 'Source directory', type: 'directory' }
      ]);
    });

    it('triggers command completion after /', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput onCommandCompletion={mockCommandCompletion} />
      );
      stdin.write('/h');
      stdin.write('\t'); // Tab
      expect(lastFrame()).toContain('Completions:');
      expect(lastFrame()).toContain('/help');
    });

    it('triggers file completion with Tab', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput onFileCompletion={mockFileCompletion} />
      );
      stdin.write('./te');
      stdin.write('\t'); // Tab
      expect(lastFrame()).toContain('Completions:');
      expect(lastFrame()).toContain('./test.txt');
    });

    it('navigates completion options with arrows', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput onCommandCompletion={mockCommandCompletion} />
      );
      stdin.write('/h');
      stdin.write('\t'); // Tab (opens completion)
      stdin.write('\u001b[B'); // Down arrow
      
      // Should highlight /history
      expect(lastFrame()).toContain('/history');
    });

    it('accepts completion with Tab or Enter', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput onCommandCompletion={mockCommandCompletion} />
      );
      stdin.write('/h');
      stdin.write('\t'); // Tab (opens completion)
      stdin.write('\t'); // Tab (accepts completion)
      
      expect(lastFrame()).toContain('/help');
      expect(lastFrame()).not.toContain('Completions:');
    });

    it('cancels completion with Escape', () => {
      const { lastFrame, stdin } = render(
        <TextEditorInput onCommandCompletion={mockCommandCompletion} />
      );
      stdin.write('/h');
      stdin.write('\t'); // Tab (opens completion)
      stdin.write('\u001b[27m'); // Escape
      
      expect(lastFrame()).not.toContain('Completions:');
    });
  });

  describe('Undo/Redo System', () => {
    it('undoes last change with Ctrl+Z', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write(' world');
      stdin.write('\u001a'); // Ctrl+Z
      expect(lastFrame()).toContain('hello');
      expect(lastFrame()).not.toContain('world');
    });

    it('redoes change with Ctrl+Y', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write(' world');
      stdin.write('\u001a'); // Ctrl+Z (undo)
      stdin.write('\u0019'); // Ctrl+Y (redo)
      expect(lastFrame()).toContain('hello world');
    });

    it('clears redo stack on new changes', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write(' world');
      stdin.write('\u001a'); // Ctrl+Z (undo)
      stdin.write(' new'); // New change
      stdin.write('\u0019'); // Ctrl+Y (should not redo)
      expect(lastFrame()).toContain('hello new');
      expect(lastFrame()).not.toContain('world');
    });
  });

  describe('Insert/Overwrite Mode', () => {
    it('toggles between insert and overwrite with Insert key', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write('\u001b[2~'); // Insert key
      // Cursor should change to block (█)
      expect(lastFrame()).toContain('█');
    });

    it('overwrites characters in overwrite mode', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write('\u001b[D'); // Left arrow
      stdin.write('\u001b[2~'); // Insert key (enter overwrite)
      stdin.write('X');
      expect(lastFrame()).toContain('hellX');
    });
  });

  describe('Advanced Edge Cases', () => {
    it('handles empty buffer gracefully', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('\b'); // Backspace on empty
      expect(lastFrame()).toContain('Type your message...');
    });

    it('handles cursor at beginning of line', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write('\u001b[H'); // Home
      stdin.write('\u001b[D'); // Left arrow (should not move beyond 0)
      stdin.write('X');
      expect(lastFrame()).toContain('Xhello');
    });

    it('handles cursor at end of line', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('hello');
      stdin.write('\u001b[C'); // Right arrow (should not move beyond end)
      stdin.write('X');
      expect(lastFrame()).toContain('helloX');
    });

    it('handles line merging with backspace at line start', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('line1');
      stdin.write('\r'); // New line
      stdin.write('line2');
      stdin.write('\u001b[H'); // Home
      stdin.write('\b'); // Backspace
      expect(lastFrame()).toContain('line1line2');
    });

    it('handles line merging with delete at line end', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      stdin.write('line1');
      stdin.write('\r'); // New line
      stdin.write('line2');
      stdin.write('\u001b[A'); // Up arrow
      stdin.write('\u001b[F'); // End
      stdin.write('\u001b[3~'); // Delete
      expect(lastFrame()).toContain('line1line2');
    });

    it('handles maximum line limit', () => {
      const { lastFrame, stdin } = render(<TextEditorInput maxLines={2} />);
      stdin.write('line1');
      stdin.write('\r');
      stdin.write('line2');
      stdin.write('\r');
      stdin.write('line3'); // Should not create new line
      expect(lastFrame()).not.toMatch(/3.*>/);
    });

    it('handles very long lines gracefully', () => {
      const { lastFrame, stdin } = render(<TextEditorInput />);
      const longText = 'a'.repeat(1000);
      stdin.write(longText);
      expect(lastFrame()).toContain('a'.repeat(50)); // Should contain at least some
    });
  });

  describe('Integration with Parent Components', () => {
    it('works with controlled value prop', () => {
      const { lastFrame, rerender } = render(
        <TextEditorInput value="initial" />
      );
      expect(lastFrame()).toContain('initial');
      
      rerender(<TextEditorInput value="updated" />);
      expect(lastFrame()).toContain('updated');
    });

    it('calls onSubmit with correct multi-line content', () => {
      const onSubmit = jest.fn();
      const { stdin } = render(<TextEditorInput onSubmit={onSubmit} />);
      
      stdin.write('line1\\');
      stdin.write('\r');
      stdin.write('line2');
      stdin.write('\r');
      stdin.write('\r'); // Empty line submits
      
      expect(onSubmit).toHaveBeenCalledWith('line1\nline2\n');
    });

    it('preserves state across re-renders', () => {
      const { lastFrame, rerender, stdin } = render(<TextEditorInput />);
      
      stdin.write('persistent');
      expect(lastFrame()).toContain('persistent');
      
      rerender(<TextEditorInput placeholder="New placeholder" />);
      expect(lastFrame()).toContain('persistent');
    });
  });
});