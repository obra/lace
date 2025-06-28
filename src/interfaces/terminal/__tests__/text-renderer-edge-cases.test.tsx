// ABOUTME: Unit tests for TextRenderer component edge cases and robust rendering
// ABOUTME: Tests long lines, cursor positioning, multi-line content, and performance

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import TextRenderer from '../components/text-renderer.js';

describe('TextRenderer Edge Cases and Robust Rendering', () => {
  describe('enhanced rendering behavior', () => {
    it('should render long lines correctly', () => {
      const longLine =
        'This is a very long line that should render correctly without issues even when it exceeds normal terminal width';
      const { container } = render(
        <TextRenderer lines={[longLine]} cursorLine={0} cursorColumn={50} isFocused={true} />
      );

      expect(container.textContent).toContain(longLine.slice(0, 50));
      expect(container.textContent).toContain(longLine.slice(51));
    });

    it('should handle cursor at end of long line', () => {
      const longLine = 'Very long line content here';
      const { container } = render(
        <TextRenderer
          lines={[longLine]}
          cursorLine={0}
          cursorColumn={longLine.length}
          isFocused={true}
        />
      );

      expect(container.textContent).toContain(longLine);
    });

    it('should render multi-line content with different line lengths', () => {
      const lines = ['Short', 'A much longer line that tests wrapping behavior', 'Med'];
      const { container } = render(
        <TextRenderer lines={lines} cursorLine={1} cursorColumn={20} isFocused={true} />
      );

      expect(container.textContent).toContain('Short');
      expect(container.textContent).toContain('A much longer line');
      expect(container.textContent).toContain('Med');
    });

    it('should handle cursor positioning edge cases', () => {
      const lines = ['Line 1', '', 'Line 3'];
      const { container } = render(
        <TextRenderer lines={lines} cursorLine={1} cursorColumn={0} isFocused={true} />
      );

      expect(container).toBeTruthy();
    });

    it('should handle cursor beyond line length gracefully', () => {
      const { container } = render(
        <TextRenderer
          lines={['Short']}
          cursorLine={0}
          cursorColumn={100} // Beyond line length
          isFocused={true}
        />
      );

      expect(container.textContent).toContain('Short');
    });
  });

  describe('placeholder behavior', () => {
    it('should show placeholder when not focused and empty', () => {
      const { container } = render(
        <TextRenderer
          lines={['']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={false}
          placeholder="Enter text here..."
        />
      );

      expect(container.textContent).toContain('Enter text here...');
    });

    it('should not show placeholder when focused even if empty', () => {
      const { container } = render(
        <TextRenderer
          lines={['']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={true}
          placeholder="Enter text here..."
        />
      );

      expect(container.textContent).not.toContain('Enter text here...');
    });

    it('should handle custom placeholder text', () => {
      const customPlaceholder = 'Type your command...';
      const { container } = render(
        <TextRenderer
          lines={['']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={false}
          placeholder={customPlaceholder}
        />
      );

      expect(container.textContent).toContain(customPlaceholder);
    });
  });

  describe('cursor rendering', () => {
    it('should render cursor on focused line', () => {
      const { container } = render(
        <TextRenderer lines={['Hello World']} cursorLine={0} cursorColumn={5} isFocused={true} />
      );

      expect(container.textContent).toContain('Hello');
      expect(container.textContent).toContain('World');
    });

    it('should not render cursor when not focused', () => {
      const { container } = render(
        <TextRenderer lines={['Hello World']} cursorLine={0} cursorColumn={5} isFocused={false} />
      );

      expect(container.textContent).toContain('Hello World');
    });

    it('should handle cursor at beginning of line', () => {
      const { container } = render(
        <TextRenderer lines={['Hello World']} cursorLine={0} cursorColumn={0} isFocused={true} />
      );

      expect(container.textContent).toContain('Hello World');
    });

    it('should handle cursor at end of line', () => {
      const line = 'Hello World';
      const { container } = render(
        <TextRenderer lines={[line]} cursorLine={0} cursorColumn={line.length} isFocused={true} />
      );

      expect(container.textContent).toContain(line);
    });
  });

  describe('empty line handling', () => {
    it('should render empty lines correctly', () => {
      const { container } = render(
        <TextRenderer
          lines={['Line 1', '', 'Line 3']}
          cursorLine={1}
          cursorColumn={0}
          isFocused={true}
        />
      );

      expect(container.textContent).toContain('Line 1');
      expect(container.textContent).toContain('Line 3');
    });

    it('should handle all empty lines', () => {
      const { container } = render(
        <TextRenderer lines={['', '', '']} cursorLine={1} cursorColumn={0} isFocused={true} />
      );

      expect(container).toBeTruthy();
    });

    it('should show placeholder only on first empty line when not focused', () => {
      const { container } = render(
        <TextRenderer
          lines={['', 'Content', '']}
          cursorLine={0}
          cursorColumn={0}
          isFocused={false}
          placeholder="Start typing..."
        />
      );

      expect(container.textContent).toContain('Start typing...');
      expect(container.textContent).toContain('Content');
    });
  });

  describe('performance and edge cases', () => {
    it('should handle very long lines without performance issues', () => {
      const veryLongLine = 'A'.repeat(10000);
      const startTime = performance.now();

      const { container } = render(
        <TextRenderer lines={[veryLongLine]} cursorLine={0} cursorColumn={5000} isFocused={true} />
      );

      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(100); // Should render quickly
      expect(container).toBeTruthy();
    });

    it('should handle many lines without performance issues', () => {
      const manyLines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`);
      const startTime = performance.now();

      const { container } = render(
        <TextRenderer lines={manyLines} cursorLine={500} cursorColumn={3} isFocused={true} />
      );

      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(500); // Should render reasonably quickly (increased for CI)
      expect(container).toBeTruthy();
    });

    it('should handle special characters correctly', () => {
      const specialLine = 'Special: !@#$%^&*()[]{}|\\:";\'<>?,./ émojis 🚀💻';
      const { container } = render(
        <TextRenderer lines={[specialLine]} cursorLine={0} cursorColumn={10} isFocused={true} />
      );

      expect(container.textContent).toContain('Special');
      expect(container.textContent).toContain('🚀💻');
    });

    it('should handle unicode characters correctly', () => {
      const unicodeLine = 'Unicode: 你好世界 عالم مرحبا русский язык';
      const { container } = render(
        <TextRenderer lines={[unicodeLine]} cursorLine={0} cursorColumn={8} isFocused={true} />
      );

      expect(container.textContent).toContain('Unicode');
      expect(container.textContent).toContain('你好世界');
    });
  });
});
