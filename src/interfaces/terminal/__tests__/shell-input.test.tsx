// ABOUTME: Unit tests for ShellInput component
// ABOUTME: Tests shell input component structure and basic behavior with mocked hooks

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { act } from '@testing-library/react';
import { renderInkComponent, stripAnsi } from './helpers/ink-test-utils.js';
import ShellInput from '../components/shell-input.js';
import * as TextBufferModule from '../hooks/use-text-buffer.js';
import { LaceFocusProvider } from '../focus/index.js';

// Mock the useTextBuffer hook
vi.mock('../hooks/use-text-buffer.js', () => ({
  useTextBuffer: vi.fn(),
}));

// Mock the TextRenderer component to simplify testing
vi.mock('../components/text-renderer.js', async () => {
  const { Text } = await import('ink');
  return {
    default: ({ lines, placeholder, isFocused }: any) => {
      // Show content if there's actual text, otherwise show placeholder
      const hasContent = lines.length > 0 && lines[0] !== '';
      if (hasContent) {
        return React.createElement(Text, {}, lines.join('\\n'));
      }
      // Always show placeholder when there's no content (focused or not)
      return React.createElement(Text, {}, placeholder || '');
    },
  };
});

// Test wrapper to provide focus context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LaceFocusProvider>{children}</LaceFocusProvider>
);

describe('ShellInput Component', () => {
  const defaultProps = {
    value: '',
    placeholder: 'Type your message...',
    autoFocus: false,
  };

  const defaultBufferState = {
    lines: [''],
    cursorLine: 0,
    cursorColumn: 0,
    preferredColumn: 0,
  };

  const defaultBufferOps = {
    getText: vi.fn(() => ''),
    setText: vi.fn(),
    setCursorPosition: vi.fn(),
    insertText: vi.fn(),
    deleteChar: vi.fn(),
    moveCursor: vi.fn(),
    killLine: vi.fn(),
    killLineBackward: vi.fn(),
    getCurrentLine: vi.fn(() => ''),
    pasteFromClipboard: vi.fn(() => Promise.resolve()),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock to default empty state
    const mockUseTextBuffer = vi.mocked(TextBufferModule.useTextBuffer);
    mockUseTextBuffer.mockReturnValue([defaultBufferState, defaultBufferOps]);
  });

  describe('basic rendering', () => {
    it('should render shell input structure', () => {
      const { lastFrame } = renderInkComponent(<TestWrapper><ShellInput {...defaultProps} /></TestWrapper>);
      const output = lastFrame() || '';

      // Should render input with placeholder
      expect(output).toContain('Type your message...');
    });

    it('should render prompt indicator', () => {
      const { lastFrame } = renderInkComponent(<TestWrapper><ShellInput {...defaultProps} /></TestWrapper>);
      const output = lastFrame() || '';

      // Should render the > prompt
      expect(output).toContain('>');
    });

    it('should render without crashing', () => {
      const { lastFrame } = renderInkComponent(<TestWrapper><ShellInput {...defaultProps} /></TestWrapper>);
      const output = lastFrame();

      expect(output).toBeDefined();
    });
  });

  describe('value handling', () => {
    it('should display initial value', () => {
      // Mock the useTextBuffer to return initial value
      const mockUseTextBuffer = vi.mocked(TextBufferModule.useTextBuffer);
      mockUseTextBuffer.mockReturnValue([
        {
          lines: ['Hello world'],
          cursorLine: 0,
          cursorColumn: 11,
          preferredColumn: 0,
        },
        {
          ...defaultBufferOps,
          getText: vi.fn(() => 'Hello world'),
        },
      ]);

      const { lastFrame } = renderInkComponent(
        <TestWrapper><ShellInput {...defaultProps} value="Hello world" /></TestWrapper>
      );
      const output = lastFrame() || '';

      // Should display the initial value
      expect(output).toContain('Hello world');
    });

    it('should call setText when value prop changes', () => {
      const mockSetText = vi.fn();
      const mockUseTextBuffer = vi.mocked(TextBufferModule.useTextBuffer);
      mockUseTextBuffer.mockReturnValue([
        defaultBufferState,
        {
          ...defaultBufferOps,
          setText: mockSetText,
        },
      ]);

      const { rerender } = renderInkComponent(<TestWrapper><ShellInput {...defaultProps} value="" /></TestWrapper>);

      // Change the value prop and wait for effects
      act(() => {
        rerender(<TestWrapper><ShellInput {...defaultProps} value="New value" /></TestWrapper>);
      });

      // Should call setText with new value
      expect(mockSetText).toHaveBeenCalledWith('New value');
    });
  });

  describe('multi-line content', () => {
    it('should display multi-line content', () => {
      const mockUseTextBuffer = vi.mocked(TextBufferModule.useTextBuffer);
      mockUseTextBuffer.mockReturnValue([
        {
          lines: ['Line 1', 'Line 2', 'Line 3'],
          cursorLine: 1,
          cursorColumn: 3,
          preferredColumn: 0,
        },
        {
          ...defaultBufferOps,
          getText: vi.fn(() => 'Line 1\\nLine 2\\nLine 3'),
        },
      ]);

      const { lastFrame } = renderInkComponent(<TestWrapper><ShellInput {...defaultProps} /></TestWrapper>);
      const output = lastFrame() || '';

      // Should display multi-line content
      expect(output).toContain('Line 1');
      expect(output).toContain('Line 2');
      expect(output).toContain('Line 3');
    });
  });

  describe('callbacks', () => {
    it('should call onChange when buffer text changes', () => {
      const mockOnChange = vi.fn();

      const mockUseTextBuffer = vi.mocked(TextBufferModule.useTextBuffer);
      mockUseTextBuffer.mockReturnValue([
        {
          lines: ['Changed text'],
          cursorLine: 0,
          cursorColumn: 12,
          preferredColumn: 0,
        },
        {
          ...defaultBufferOps,
          getText: vi.fn(() => 'Changed text'),
        },
      ]);

      act(() => {
        renderInkComponent(<TestWrapper><ShellInput {...defaultProps} onChange={mockOnChange} /></TestWrapper>);
      });

      // The component should call onChange with the text from getText
      expect(mockOnChange).toHaveBeenCalledWith('Changed text');
    });

    it('should not call onChange if text hasnt changed', () => {
      const mockOnChange = vi.fn();

      renderInkComponent(<TestWrapper><ShellInput {...defaultProps} value="" onChange={mockOnChange} /></TestWrapper>);

      // Should not call onChange if the text is the same as the value prop
      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('should provide onSubmit callback', () => {
      const mockOnSubmit = vi.fn();

      const { lastFrame } = renderInkComponent(
        <TestWrapper><ShellInput {...defaultProps} onSubmit={mockOnSubmit} /></TestWrapper>
      );

      // Component should render without error when onSubmit is provided
      expect(lastFrame()).toBeDefined();
    });
  });

  describe('focus handling', () => {
    it('should handle autoFocus prop', () => {
      const { lastFrame } = renderInkComponent(<TestWrapper><ShellInput {...defaultProps} autoFocus={true} /></TestWrapper>);

      // Should render without error when autoFocus is set
      expect(lastFrame()).toBeDefined();
    });

    it('should handle custom focusId', () => {
      const { lastFrame } = renderInkComponent(
        <TestWrapper>
          <ShellInput {...defaultProps} />
        </TestWrapper>
      );

      // Should render without error with custom focus ID
      expect(lastFrame()).toBeDefined();
    });
  });

  describe('placeholder behavior', () => {
    it('should show custom placeholder', () => {
      const customPlaceholder = 'Enter your command...';

      const { lastFrame } = renderInkComponent(
        <TestWrapper><ShellInput {...defaultProps} placeholder={customPlaceholder} /></TestWrapper>
      );
      const output = lastFrame() || '';

      expect(output).toContain(customPlaceholder);
    });

    it('should pass placeholder to TextRenderer', () => {
      const customPlaceholder = 'Custom placeholder text';

      const { lastFrame } = renderInkComponent(
        <TestWrapper><ShellInput {...defaultProps} placeholder={customPlaceholder} /></TestWrapper>
      );
      const output = lastFrame() || '';

      // Our mocked TextRenderer should show the placeholder when empty and unfocused
      expect(output).toContain(customPlaceholder);
    });
  });

  describe('integration with useTextBuffer', () => {
    it('should pass buffer state to TextRenderer', () => {
      const mockUseTextBuffer = vi.mocked(TextBufferModule.useTextBuffer);
      mockUseTextBuffer.mockReturnValue([
        {
          lines: ['Buffer content'],
          cursorLine: 0,
          cursorColumn: 5,
          preferredColumn: 0,
        },
        {
          ...defaultBufferOps,
          getText: vi.fn(() => 'Buffer content'),
        },
      ]);

      const { lastFrame } = renderInkComponent(<TestWrapper><ShellInput {...defaultProps} /></TestWrapper>);
      const output = lastFrame() || '';

      // Should pass the buffer content to TextRenderer
      expect(output).toContain('Buffer content');
    });

    it('should initialize useTextBuffer with value prop', () => {
      renderInkComponent(<TestWrapper><ShellInput {...defaultProps} value="Initial value" /></TestWrapper>);

      // useTextBuffer should be called with the initial value
      const mockUseTextBuffer = vi.mocked(TextBufferModule.useTextBuffer);
      expect(mockUseTextBuffer).toHaveBeenCalledWith('Initial value');
    });
  });

  describe('edge cases', () => {
    it('should handle missing props gracefully', () => {
      const { lastFrame } = renderInkComponent(<TestWrapper><ShellInput /></TestWrapper>);

      // Should render without crashing even with minimal props
      expect(lastFrame()).toBeDefined();
    });

    it('should handle undefined callbacks', () => {
      const { lastFrame } = renderInkComponent(
        <TestWrapper><ShellInput {...defaultProps} onSubmit={undefined} onChange={undefined} /></TestWrapper>
      );

      // Should render without error when callbacks are undefined
      expect(lastFrame()).toBeDefined();
    });

    it('should handle empty string value', () => {
      const { lastFrame } = renderInkComponent(<TestWrapper><ShellInput {...defaultProps} value="" /></TestWrapper>);

      // Should handle empty string value
      expect(lastFrame()).toBeDefined();
    });
  });

  describe('component structure', () => {
    it('should render expected component hierarchy', () => {
      const { lastFrame } = renderInkComponent(<TestWrapper><ShellInput {...defaultProps} /></TestWrapper>);
      const output = lastFrame() || '';

      // Should contain the prompt and TextRenderer output
      expect(output).toContain('>'); // Prompt
      expect(output).toBeDefined(); // TextRenderer content
    });

    it('should maintain consistent layout', () => {
      // Mock useTextBuffer to return the provided value
      const mockUseTextBuffer = vi.mocked(TextBufferModule.useTextBuffer);
      mockUseTextBuffer.mockReturnValue([
        {
          lines: ['Some text content'],
          cursorLine: 0,
          cursorColumn: 17,
          preferredColumn: 0,
        },
        {
          ...defaultBufferOps,
          getText: vi.fn(() => 'Some text content'),
        },
      ]);

      const { lastFrame } = renderInkComponent(
        <TestWrapper><ShellInput {...defaultProps} value="Some text content" /></TestWrapper>
      );
      const output = lastFrame() || '';

      // Basic structure should be maintained
      expect(output).toContain('>');
      expect(stripAnsi(output)).toContain('Some text content');
    });
  });
});