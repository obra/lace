// ABOUTME: Unit tests for TextRenderer component
// ABOUTME: Tests text display, cursor positioning, and placeholder behavior

import { describe, it, expect } from 'vitest';
import React from 'react';
import {
  renderInkComponent,
  stripAnsi,
} from '~/interfaces/terminal/__tests__/helpers/ink-test-utils.js';
import TextRenderer from '~/interfaces/terminal/components/text-renderer.js';

describe('TextRenderer Component', () => {
  const defaultProps = {
    lines: ['Hello world'],
    cursorLine: 0,
    cursorColumn: 0,
    isFocused: true,
  };

  describe('basic rendering', () => {
    it('should render text content', () => {
      const { lastFrame } = renderInkComponent(<TextRenderer {...defaultProps} />);
      const output = lastFrame();

      // Should render text content (strip ANSI codes since cursor is present)
      expect(stripAnsi(output || '')).toContain('Hello world');
    });

    it('should render without crashing', () => {
      const { lastFrame } = renderInkComponent(<TextRenderer {...defaultProps} />);
      const output = lastFrame();

      expect(output).toBeDefined();
    });

    it('should handle empty props gracefully', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer lines={[]} cursorLine={0} cursorColumn={0} isFocused={false} />
      );
      const output = lastFrame();

      expect(output).toBeDefined();
    });
  });

  describe('focus handling', () => {
    it('should render focused content', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer lines={['Hello world']} cursorLine={0} cursorColumn={0} isFocused={true} />
      );
      const output = lastFrame() || '';

      // Should render content when focused
      expect(stripAnsi(output)).toContain('Hello world');
    });

    it('should render unfocused content', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer lines={['Hello world']} cursorLine={0} cursorColumn={0} isFocused={false} />
      );
      const output = lastFrame() || '';

      // Should render content when unfocused
      expect(output).toContain('Hello world');
    });

    it('should handle empty content when focused', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer lines={['']} cursorLine={0} cursorColumn={0} isFocused={true} />
      );
      const output = lastFrame() || '';

      // Should render without crashing when empty and focused
      expect(output).toBeDefined();
    });
  });

  describe('multi-line content', () => {
    it('should display all lines', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer
          lines={['First line', 'Second line', 'Third line']}
          cursorLine={1}
          cursorColumn={3}
          isFocused={true}
        />
      );
      const output = lastFrame() || '';

      // Should display all lines (strip ANSI codes since cursor is present)
      const cleanOutput = stripAnsi(output);
      expect(cleanOutput).toContain('First line');
      expect(cleanOutput).toContain('Second line');
      expect(cleanOutput).toContain('Third line');
    });

    it('should handle empty lines in multi-line content', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer
          lines={['Line 1', '', 'Line 3']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={true}
        />
      );
      const output = lastFrame() || '';

      // Should handle empty lines in multi-line content
      const cleanOutput = stripAnsi(output);
      expect(cleanOutput).toContain('Line 1');
      expect(cleanOutput).toContain('Line 3');
    });

    it('should handle cursor positioning in multi-line text', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer
          lines={['First', 'Second', 'Third']}
          cursorLine={1}
          cursorColumn={2}
          isFocused={true}
        />
      );
      const output = lastFrame() || '';

      // Should show all lines without crashing
      const cleanOutput = stripAnsi(output);
      expect(cleanOutput).toContain('First');
      expect(cleanOutput).toContain('Second');
      expect(cleanOutput).toContain('Third');
    });
  });

  describe('placeholder behavior', () => {
    it('should show placeholder when empty and not focused', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer
          lines={['']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={false}
          placeholder="Enter your message..."
        />
      );
      const output = lastFrame() || '';

      expect(output).toContain('Enter your message...');
    });

    it('should show custom placeholder text', () => {
      const customPlaceholder = 'Start typing your code...';

      const { lastFrame } = renderInkComponent(
        <TextRenderer
          lines={['']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={false}
          placeholder={customPlaceholder}
        />
      );
      const output = lastFrame() || '';

      expect(output).toContain(customPlaceholder);
    });

    it('should show default placeholder when none provided', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer
          lines={['']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={false}
          // No placeholder prop provided
        />
      );
      const output = lastFrame() || '';

      expect(output).toContain('Type your message...');
    });

    it('should not show placeholder when focused even if empty', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer
          lines={['']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={true}
          placeholder="Should not see this"
        />
      );
      const output = lastFrame() || '';

      expect(output).not.toContain('Should not see this');
    });

    it('should not show placeholder when content exists', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer
          lines={['Some content']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={false}
          placeholder="Should not see this"
        />
      );
      const output = lastFrame() || '';

      expect(output).toContain('Some content');
      expect(output).not.toContain('Should not see this');
    });

    it('should show placeholder only when single empty line and unfocused', () => {
      // Test with single empty line - should show placeholder
      const { lastFrame: emptyFrame } = renderInkComponent(
        <TextRenderer
          lines={['']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={false}
          placeholder="Should show this"
        />
      );
      const emptyOutput = emptyFrame() || '';
      expect(emptyOutput).toContain('Should show this');

      // Test with multiple lines - should render lines, not placeholder
      const { lastFrame: multiFrame } = renderInkComponent(
        <TextRenderer
          lines={['', 'Content on second line']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={false}
          placeholder="Should not show this"
        />
      );
      const multiOutput = multiFrame() || '';
      expect(multiOutput).toContain('Content on second line');
      // Note: The placeholder logic only applies to single empty line,
      // so with multiple lines it renders all lines normally
    });
  });

  describe('edge cases', () => {
    it('should handle long lines without crashing', () => {
      const longLine =
        'This is a very long line that might wrap or need special handling in the terminal interface when it exceeds normal terminal width limits';

      const { lastFrame } = renderInkComponent(
        <TextRenderer lines={[longLine]} cursorLine={0} cursorColumn={10} isFocused={true} />
      );
      const output = lastFrame() || '';

      // Should handle long lines without crashing
      const cleanOutput = stripAnsi(output);
      expect(cleanOutput).toContain('This is');
      expect(cleanOutput).toContain('very long line');
    });

    it('should handle cursor position beyond all content', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer
          lines={['Short']}
          cursorLine={5} // Way beyond available lines
          cursorColumn={10}
          isFocused={true}
        />
      );
      const output = lastFrame() || '';

      // Should not crash and should show the content
      expect(stripAnsi(output)).toContain('Short');
    });

    it('should handle negative cursor positions gracefully', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer lines={['Test content']} cursorLine={-1} cursorColumn={-5} isFocused={true} />
      );
      const output = lastFrame() || '';

      // Should not crash
      expect(output).toBeDefined();
    });

    it('should handle empty lines array', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer lines={[]} cursorLine={0} cursorColumn={0} isFocused={true} />
      );
      const output = lastFrame() || '';

      // Should not crash with empty lines array
      expect(output).toBeDefined();
    });

    it('should handle mixed empty and non-empty lines', () => {
      const { lastFrame } = renderInkComponent(
        <TextRenderer
          lines={['First', '', '', 'Fourth', '']}
          cursorLine={2}
          cursorColumn={0}
          isFocused={true}
        />
      );
      const output = lastFrame() || '';

      // Should handle mixed content without crashing
      const cleanOutput = stripAnsi(output);
      expect(cleanOutput).toContain('First');
      expect(cleanOutput).toContain('Fourth');
    });
  });

  describe('React component behavior', () => {
    it('should re-render when props change', () => {
      const { rerender, lastFrame } = renderInkComponent(<TextRenderer {...defaultProps} />);

      // Initial render
      let output = lastFrame() || '';
      expect(stripAnsi(output)).toContain('Hello world');

      // Update props
      rerender(
        <TextRenderer lines={['Updated text']} cursorLine={0} cursorColumn={0} isFocused={true} />
      );

      // Should show updated content
      output = lastFrame() || '';
      expect(stripAnsi(output)).toContain('Updated text');
    });

    it('should handle focus state changes', () => {
      const { rerender, lastFrame } = renderInkComponent(
        <TextRenderer lines={['Test']} cursorLine={0} cursorColumn={0} isFocused={true} />
      );

      // Initially focused - should render content
      let output = lastFrame() || '';
      expect(stripAnsi(output)).toContain('Test');

      // Change to unfocused - should still render content
      rerender(<TextRenderer lines={['Test']} cursorLine={0} cursorColumn={0} isFocused={false} />);

      output = lastFrame() || '';
      expect(output).toContain('Test');
    });
  });
});
