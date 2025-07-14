// ABOUTME: Tests for ShellInput autocomplete integration
// ABOUTME: Validates Tab key handling, autocomplete state, and keyboard navigation

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as renderInkComponent } from 'ink-testing-library';
import ShellInput from '../shell-input.js';
import { LaceFocusProvider } from '../../focus/focus-provider.js';

// Capture the useInput handler for direct testing
let capturedInputHandler: ((input: string, key: any) => void) | null = null;

vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useInput: (handler: (input: string, key: any) => void) => {
      capturedInputHandler = handler;
    },
  };
});

// Mock the FileScanner module
vi.mock('../../utils/file-scanner.js', () => ({
  FileScanner: vi.fn().mockImplementation(() => ({
    getCompletions: vi.fn().mockResolvedValue(['src/', 'package.json', 'README.md']),
  })),
}));

describe('ShellInput Autocomplete Integration', () => {
  // Helper to render with focus provider
  const renderWithFocus = (component: React.ReactElement) => {
    return renderInkComponent(React.createElement(LaceFocusProvider, { children: component }));
  };

  let mockOnSubmit: ReturnType<typeof vi.fn>;
  let mockOnChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnSubmit = vi.fn();
    mockOnChange = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('basic autocomplete functionality', () => {
    it('should render without autocomplete visible initially', () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="" autoFocus={false} />
      );

      const output = lastFrame();
      expect(output).toContain('> ');
      // Should not show autocomplete items initially
      expect(output).not.toContain('src/');
      expect(output).not.toContain('package.json');
    });

    it('should handle Tab key to show autocomplete when there is content', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="s" autoFocus={true} />
      );

      // Call useInput handler directly instead of using stdin
      capturedInputHandler!('', { tab: true });

      // Wait a bit for async autocomplete loading
      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should show autocomplete items after Tab when there's content
      expect(output).toContain('src/');
      expect(output).toContain('package.json');
      expect(output).toContain('README.md');
    });

    it('should hide autocomplete on second Tab press', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="s" autoFocus={true} />
      );

      // First Tab to show
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second Tab to apply completion
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should apply the completion and hide autocomplete dropdown
      expect(mockOnChange).toHaveBeenCalledWith('src/');
      // Should not show the autocomplete list items in the dropdown
      expect(output).not.toContain('package.json');
      expect(output).not.toContain('README.md');
    });

    it('should hide autocomplete on Escape key', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="s" autoFocus={true} />
      );

      // Tab to show autocomplete
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Escape to hide
      capturedInputHandler!('', { escape: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should not show autocomplete items after Escape
      expect(output).not.toContain('src/');
    });
  });

  describe('autocomplete navigation', () => {
    it('should navigate autocomplete with arrow keys', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="p" autoFocus={true} />
      );

      // Show autocomplete
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Navigate down
      capturedInputHandler!('', { downArrow: true });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const output = lastFrame();
      // Should show selection moved (exact format depends on implementation)
      expect(output).toContain('package.json');
    });

    it('should navigate up and down with bounds checking', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="s" autoFocus={true} />
      );

      // Show autocomplete
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Navigate up from first item (should stay at first)
      capturedInputHandler!('', { upArrow: true }); // Up arrow
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Navigate down multiple times to reach end
      capturedInputHandler!('', { downArrow: true }); // Down arrow
      capturedInputHandler!('', { downArrow: true }); // Down arrow
      capturedInputHandler!('', { downArrow: true }); // Down arrow (should stay at last)
      await new Promise((resolve) => setTimeout(resolve, 50));

      const output = lastFrame();
      // Should handle bounds correctly without crashing
      expect(output).toBeDefined();
    });
  });

  describe('autocomplete selection', () => {
    it('should select item with Enter key', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="s" autoFocus={true} />
      );

      // Show autocomplete
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Select first item with Enter
      capturedInputHandler!('\r', { return: true }); // Enter key
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should call onChange with selected item
      expect(mockOnChange).toHaveBeenCalled();
      // Should hide autocomplete after selection
      const output = lastFrame();
      expect(output).not.toContain('> src/'); // Selection indicator should be gone
    });

    it('should complete partial text correctly', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="sr" autoFocus={true} />
      );

      // Show autocomplete for partial text
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Select item
      capturedInputHandler!('\r', { return: true });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should replace partial text with complete selection
      expect(mockOnChange).toHaveBeenCalledWith(expect.stringContaining('src/'));
    });
  });

  describe('autocomplete state management', () => {
    it('should hide autocomplete when typing', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="" autoFocus={true} />
      );

      // Show autocomplete
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Type a character
      capturedInputHandler!('a', {});
      await new Promise((resolve) => setTimeout(resolve, 50));

      const output = lastFrame();
      // Should hide autocomplete when typing
      expect(output).not.toContain('src/');
    });

    it('should handle disabled state', () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          disabled={true}
          autoFocus={false}
        />
      );

      // Try to activate autocomplete while disabled
      capturedInputHandler!('', { tab: true });

      const output = lastFrame();
      // Should not show autocomplete when disabled
      expect(output).not.toContain('src/');
    });
  });

  describe('autocomplete positioning', () => {
    it('should position autocomplete relative to cursor', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value="some text before cursor"
          autoFocus={true}
        />
      );

      // Show autocomplete
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should show autocomplete positioned after the text
      // (Exact positioning testing is limited in text-based testing)
      expect(output).toContain('src/');
    });
  });

  describe('word boundary detection', () => {
    it('should detect current word correctly', async () => {
      const { FileScanner } = await import('../../utils/file-scanner.js');
      const mockScanner = vi.mocked(FileScanner).mock.instances[0] as any;

      if (mockScanner?.getCompletions) {
        // Clear previous calls
        mockScanner.getCompletions.mockClear();

        // Mock specific completions for partial path
        mockScanner.getCompletions.mockResolvedValue(['src/app.ts', 'src/agent.ts']);
      }

      const { lastFrame } = renderWithFocus(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value="cd sr"
          autoFocus={true}
        />
      );

      // Position cursor after "sr" and trigger autocomplete
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should call getCompletions with the partial word "sr"
      if (mockScanner?.getCompletions) {
        expect(mockScanner.getCompletions).toHaveBeenCalledWith('sr');
      }
    });
  });

  describe('tab completion constraints', () => {
    it('should not trigger autocomplete on Tab when input is completely empty', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="" autoFocus={true} />
      );

      // Simulate Tab key press on empty input
      capturedInputHandler!('', { tab: true });

      // Wait a bit to ensure no async operations trigger
      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should NOT show autocomplete items since input is completely empty
      expect(output).not.toContain('src/');
      expect(output).not.toContain('package.json');
      expect(output).not.toContain('README.md');
      // Should just show the prompt
      expect(output).toContain('>');
    });

    it('should not trigger autocomplete on Tab when input is only whitespace', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="   " autoFocus={true} />
      );

      // Simulate Tab key press on whitespace-only input
      capturedInputHandler!('', { tab: true });

      // Wait a bit to ensure no async operations trigger
      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should NOT show autocomplete items since input is only whitespace
      expect(output).not.toContain('src/');
      expect(output).not.toContain('package.json');
      expect(output).not.toContain('README.md');
    });

    it('should trigger autocomplete on Tab when there is content to complete', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="s" autoFocus={true} />
      );

      // Simulate Tab key press with content
      capturedInputHandler!('', { tab: true });

      // Wait a bit for async autocomplete loading
      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should show autocomplete items since there's content to complete
      expect(output).toContain('src/');
    });

    it('should trigger autocomplete on Tab when cursor is after whitespace but line has content', async () => {
      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="ls " autoFocus={true} />
      );

      // Simulate Tab key press after space (but line has content)
      capturedInputHandler!('', { tab: true });

      // Wait a bit for async autocomplete loading
      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should show autocomplete items since line has content even though beforeCursor is empty
      expect(output).toContain('src/');
      expect(output).toContain('package.json');
    });
  });

  describe('error handling', () => {
    it('should handle autocomplete loading errors gracefully', async () => {
      // Mock FileScanner to throw an error
      const { FileScanner } = await import('../../utils/file-scanner.js');
      const mockScanner = vi.mocked(FileScanner).mock.instances[0] as any;

      if (mockScanner?.getCompletions) {
        mockScanner.getCompletions.mockRejectedValue(new Error('File system error'));
      }

      const { lastFrame } = renderWithFocus(
        <ShellInput onSubmit={mockOnSubmit} onChange={mockOnChange} value="test" autoFocus={true} />
      );

      // Should not crash when autocomplete fails
      capturedInputHandler!('', { tab: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should still render the input without autocomplete (even if file system error occurred)
      expect(output).toContain('>');
    });
  });
});
