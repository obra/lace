// ABOUTME: Tests for FileAutocomplete display component
// ABOUTME: Validates rendering, selection highlighting, and scrolling behavior

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import FileAutocomplete from '../file-autocomplete.js';

describe('FileAutocomplete', () => {
  describe('visibility', () => {
    it('should render nothing when not visible', () => {
      const { lastFrame } = render(
        <FileAutocomplete
          items={['src/', 'app.ts']}
          selectedIndex={0}
          isVisible={false}
          maxItems={5}
        />
      );

      expect(lastFrame()).toBe('');
    });

    it('should render nothing when no items', () => {
      const { lastFrame } = render(
        <FileAutocomplete items={[]} selectedIndex={0} isVisible={true} maxItems={5} />
      );

      expect(lastFrame()).toBe('');
    });
  });

  describe('basic rendering', () => {
    it('should render file and directory items', () => {
      const { lastFrame } = render(
        <FileAutocomplete
          items={['src/', 'package.json', 'README.md']}
          selectedIndex={0}
          isVisible={true}
          maxItems={5}
        />
      );

      const output = lastFrame();
      expect(output).toContain('src/');
      expect(output).toContain('package.json');
      expect(output).toContain('README.md');
    });

    it('should highlight the selected item', () => {
      const { lastFrame } = render(
        <FileAutocomplete
          items={['src/', 'app.ts', 'test.ts']}
          selectedIndex={1}
          isVisible={true}
          maxItems={5}
        />
      );

      const output = lastFrame();
      // Selected item should have the ">" prefix
      expect(output).toContain('> app.ts');
      // Non-selected items should have spaces
      expect(output).toContain('  src/');
      expect(output).toContain('  test.ts');
    });
  });

  describe('scrolling behavior', () => {
    const manyItems = [
      'item1.ts',
      'item2.ts',
      'item3.ts',
      'item4.ts',
      'item5.ts',
      'item6.ts',
      'item7.ts',
    ];

    it('should show only maxItems when list is longer', () => {
      const { lastFrame } = render(
        <FileAutocomplete items={manyItems} selectedIndex={0} isVisible={true} maxItems={3} />
      );

      const output = lastFrame();
      // Should show first 3 items
      expect(output).toContain('item1.ts');
      expect(output).toContain('item2.ts');
      expect(output).toContain('item3.ts');
      // Should not show items beyond maxItems
      expect(output).not.toContain('item4.ts');
    });

    it('should scroll to show selected item at top', () => {
      const { lastFrame } = render(
        <FileAutocomplete
          items={manyItems}
          selectedIndex={4} // item5.ts
          isVisible={true}
          maxItems={3}
        />
      );

      const output = lastFrame();
      // Should show selected item at top of visible window
      expect(output).toContain('> item5.ts');
      // Should show items after selection
      expect(output).toContain('item6.ts');
      expect(output).toContain('item7.ts');
    });

    it('should handle selection at the end of list', () => {
      const { lastFrame } = render(
        <FileAutocomplete
          items={manyItems}
          selectedIndex={6} // last item
          isVisible={true}
          maxItems={3}
        />
      );

      const output = lastFrame();
      // Should show last 3 items
      expect(output).toContain('> item7.ts');
      expect(output).toContain('item6.ts');
      expect(output).toContain('item5.ts');
    });
  });

  describe('maxItems prop', () => {
    it('should default to 5 maxItems', () => {
      const manyItems = Array.from({ length: 10 }, (_, i) => `item${i}.ts`);

      const { lastFrame } = render(
        <FileAutocomplete
          items={manyItems}
          selectedIndex={0}
          isVisible={true}
          // No maxItems prop - should default to 5
        />
      );

      const output = lastFrame();
      const lines = output?.split('\n').filter((line) => line.trim()) || [];

      // Should show 5 items by default
      expect(lines.length).toBeLessThanOrEqual(5);
    });

    it('should respect custom maxItems', () => {
      const manyItems = Array.from({ length: 10 }, (_, i) => `item${i}.ts`);

      const { lastFrame } = render(
        <FileAutocomplete items={manyItems} selectedIndex={0} isVisible={true} maxItems={2} />
      );

      const output = lastFrame();
      const lines = output?.split('\n').filter((line) => line.trim()) || [];

      // Should show only 2 items
      expect(lines.length).toBeLessThanOrEqual(2);
    });
  });

  describe('item selection states', () => {
    it('should handle selectedIndex of 0', () => {
      const { lastFrame } = render(
        <FileAutocomplete
          items={['first.ts', 'second.ts']}
          selectedIndex={0}
          isVisible={true}
          maxItems={5}
        />
      );

      const output = lastFrame();
      expect(output).toContain('> first.ts');
      expect(output).toContain('  second.ts');
    });

    it('should handle negative selectedIndex gracefully', () => {
      const { lastFrame } = render(
        <FileAutocomplete
          items={['first.ts', 'second.ts']}
          selectedIndex={-1}
          isVisible={true}
          maxItems={5}
        />
      );

      // Should not crash and render items without selection
      const output = lastFrame();
      expect(output).toContain('first.ts');
      expect(output).toContain('second.ts');
    });

    it('should handle selectedIndex beyond array length', () => {
      const { lastFrame } = render(
        <FileAutocomplete
          items={['first.ts', 'second.ts']}
          selectedIndex={10}
          isVisible={true}
          maxItems={5}
        />
      );

      // Should not crash and render items without selection
      const output = lastFrame();
      expect(output).toContain('first.ts');
      expect(output).toContain('second.ts');
    });
  });

  describe('clean minimal styling', () => {
    it('should have minimal output without borders or decorations', () => {
      const { lastFrame } = render(
        <FileAutocomplete
          items={['src/', 'app.ts']}
          selectedIndex={0}
          isVisible={true}
          maxItems={5}
        />
      );

      const output = lastFrame();

      // Should not contain borders, emojis, or help text
      expect(output).not.toContain('─'); // No borders
      expect(output).not.toContain('│'); // No borders
      expect(output).not.toContain('📁'); // No emojis
      expect(output).not.toContain('📄'); // No emojis
      expect(output).not.toContain('↑↓'); // No help text
      expect(output).not.toContain('File Completions'); // No header

      // Should only contain the file names and selection indicator
      expect(output).toContain('> src/');
      expect(output).toContain('  app.ts');
    });

    it('should use simple selection indicator', () => {
      const { lastFrame } = render(
        <FileAutocomplete
          items={['selected.ts', 'unselected.ts']}
          selectedIndex={0}
          isVisible={true}
          maxItems={5}
        />
      );

      const output = lastFrame();

      // Should use simple ">" for selection, spaces for non-selection
      expect(output).toContain('> selected.ts');
      expect(output).toContain('  unselected.ts');

      // Should not use fancy arrows or indicators
      expect(output).not.toContain('▶');
      expect(output).not.toContain('→');
    });
  });
});
