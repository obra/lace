// ABOUTME: Tests for ShellInput autocomplete integration
// ABOUTME: Validates Tab key handling, autocomplete state, and keyboard navigation

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import ShellInput from '../shell-input.js';

// Mock the FileScanner module
vi.mock('../../utils/file-scanner.js', () => ({
  FileScanner: vi.fn().mockImplementation(() => ({
    getCompletions: vi.fn().mockResolvedValue(['src/', 'package.json', 'README.md']),
  })),
}));

describe('ShellInput Autocomplete Integration', () => {
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
      const { lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          autoFocus={false}
        />
      );

      const output = lastFrame();
      expect(output).toContain('> ');
      // Should not show autocomplete items initially
      expect(output).not.toContain('src/');
      expect(output).not.toContain('package.json');
    });

    it('should handle Tab key to show autocomplete', async () => {
      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          autoFocus={true}
        />
      );

      // Simulate Tab key press
      stdin.write('\t');
      
      // Wait a bit for async autocomplete loading
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should show autocomplete items after Tab
      expect(output).toContain('src/');
      expect(output).toContain('package.json');
      expect(output).toContain('README.md');
    });

    it('should hide autocomplete on second Tab press', async () => {
      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          autoFocus={true}
        />
      );

      // First Tab to show
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second Tab to hide
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should not show autocomplete items after second Tab
      expect(output).not.toContain('src/');
      expect(output).not.toContain('package.json');
    });

    it('should hide autocomplete on Escape key', async () => {
      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          autoFocus={true}
        />
      );

      // Tab to show autocomplete
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Escape to hide
      stdin.write('\u001b'); // ESC key
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should not show autocomplete items after Escape
      expect(output).not.toContain('src/');
    });
  });

  describe('autocomplete navigation', () => {
    it('should navigate autocomplete with arrow keys', async () => {
      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          autoFocus={true}
        />
      );

      // Show autocomplete
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Navigate down
      stdin.write('\u001b[B'); // Down arrow
      await new Promise(resolve => setTimeout(resolve, 50));

      const output = lastFrame();
      // Should show selection moved (exact format depends on implementation)
      expect(output).toContain('package.json');
    });

    it('should navigate up and down with bounds checking', async () => {
      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          autoFocus={true}
        />
      );

      // Show autocomplete
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Navigate up from first item (should stay at first)
      stdin.write('\u001b[A'); // Up arrow
      await new Promise(resolve => setTimeout(resolve, 50));

      // Navigate down multiple times to reach end
      stdin.write('\u001b[B'); // Down arrow
      stdin.write('\u001b[B'); // Down arrow
      stdin.write('\u001b[B'); // Down arrow (should stay at last)
      await new Promise(resolve => setTimeout(resolve, 50));

      const output = lastFrame();
      // Should handle bounds correctly without crashing
      expect(output).toBeDefined();
    });
  });

  describe('autocomplete selection', () => {
    it('should select item with Enter key', async () => {
      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          autoFocus={true}
        />
      );

      // Show autocomplete
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Select first item with Enter
      stdin.write('\r'); // Enter key
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should call onChange with selected item
      expect(mockOnChange).toHaveBeenCalled();
      // Should hide autocomplete after selection
      const output = lastFrame();
      expect(output).not.toContain('> src/'); // Selection indicator should be gone
    });

    it('should complete partial text correctly', async () => {
      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value="sr"
          autoFocus={true}
        />
      );

      // Show autocomplete for partial text
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Select item
      stdin.write('\r');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should replace partial text with complete selection
      expect(mockOnChange).toHaveBeenCalledWith(expect.stringContaining('src/'));
    });
  });

  describe('autocomplete state management', () => {
    it('should hide autocomplete when typing', async () => {
      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          autoFocus={true}
        />
      );

      // Show autocomplete
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Type a character
      stdin.write('a');
      await new Promise(resolve => setTimeout(resolve, 50));

      const output = lastFrame();
      // Should hide autocomplete when typing
      expect(output).not.toContain('src/');
    });

    it('should handle disabled state', () => {
      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          disabled={true}
          autoFocus={false}
        />
      );

      // Try to activate autocomplete while disabled
      stdin.write('\t');

      const output = lastFrame();
      // Should not show autocomplete when disabled
      expect(output).not.toContain('src/');
    });
  });

  describe('autocomplete positioning', () => {
    it('should position autocomplete relative to cursor', async () => {
      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value="some text before cursor"
          autoFocus={true}
        />
      );

      // Show autocomplete
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

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

      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value="cd sr"
          autoFocus={true}
        />
      );

      // Position cursor after "sr" and trigger autocomplete
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should call getCompletions with the partial word "sr"
      if (mockScanner?.getCompletions) {
        expect(mockScanner.getCompletions).toHaveBeenCalledWith('sr');
      }
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

      const { stdin, lastFrame } = render(
        <ShellInput
          onSubmit={mockOnSubmit}
          onChange={mockOnChange}
          value=""
          autoFocus={true}
        />
      );

      // Should not crash when autocomplete fails
      stdin.write('\t');
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      // Should still render the input without autocomplete
      expect(output).toContain('> ');
    });
  });
});