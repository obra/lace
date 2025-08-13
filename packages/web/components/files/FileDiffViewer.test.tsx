// ABOUTME: Tests for FileDiffViewer component and utility functions
// ABOUTME: Ensures proper rendering and functionality of diff viewing capabilities

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FileDiffViewer from './FileDiffViewer';
import {
  createFileDiffFromText,
  createNewFileDiff,
  createDeletedFileDiff,
  createBinaryFileDiff,
  detectLanguageFromPath,
} from './FileDiffViewer.utils';
import type { FileDiff } from './FileDiffViewer';

// Mock FontAwesome icons
vi.mock('@/lib/fontawesome', () => ({
  faEye: {},
  faColumns: {},
  faList: {},
  faCopy: {},
  faExpand: {},
  faCompress: {},
}));

vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: ({ icon, className }: { icon: { iconName?: string }; className?: string }) => (
    <span data-testid="fa-icon" className={className}>
      {icon.iconName || 'icon'}
    </span>
  ),
}));

describe('FileDiffViewer', () => {
  const sampleDiff: FileDiff = {
    oldFilePath: 'test.ts',
    newFilePath: 'test.ts',
    oldContent: 'const old = "test";',
    newContent: 'const new = "test";',
    chunks: [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [
          { type: 'removed', oldLineNumber: 1, content: 'const old = "test";' },
          { type: 'added', newLineNumber: 1, content: 'const new = "test";' },
        ],
      },
    ],
    language: 'typescript',
    isBinary: false,
    isNew: false,
    isDeleted: false,
    isRenamed: false,
  };

  it('renders file diff with header information', () => {
    render(<FileDiffViewer diff={sampleDiff} />);

    expect(screen.getAllByText('test.ts')).toHaveLength(3); // Header + 2 columns
    expect(screen.getByText('typescript')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
  });

  it('toggles between side-by-side and unified views', () => {
    render(<FileDiffViewer diff={sampleDiff} />);

    const unifiedButton = screen.getByTitle('Unified');
    const sideBySideButton = screen.getByTitle('Side by side');

    // Should start in side-by-side mode
    expect(sideBySideButton.className).toContain('bg-primary');

    // Click unified button
    fireEvent.click(unifiedButton);
    expect(unifiedButton.className).toContain('bg-primary');
    expect(sideBySideButton.className).not.toContain('bg-primary');
  });

  it('handles binary files correctly', () => {
    const binaryDiff = createBinaryFileDiff('image.png', 'image.png');
    render(<FileDiffViewer diff={binaryDiff} />);

    expect(screen.getByText('Binary file')).toBeTruthy();
    expect(screen.getByText('Binary files cannot be displayed in diff view')).toBeTruthy();
  });

  it('calls onCopy when copy button is clicked', () => {
    const mockOnCopy = vi.fn();
    render(<FileDiffViewer diff={sampleDiff} onCopy={mockOnCopy} />);

    const copyButton = screen.getByTitle('Copy diff');
    fireEvent.click(copyButton);

    expect(mockOnCopy).toHaveBeenCalledWith(expect.stringContaining('const old = "test";'));
  });

  it('shows expand/collapse button for long diffs', () => {
    const longDiff = createFileDiffFromText(
      Array(600).fill('line').join('\n'),
      Array(600).fill('new line').join('\n'),
      'long.txt'
    );

    render(<FileDiffViewer diff={longDiff} maxLines={500} />);

    expect(screen.getByTitle('Expand all')).toBeTruthy();
  });
});

describe('FileDiffViewer utilities', () => {
  describe('createFileDiffFromText', () => {
    it('creates a diff from old and new text', () => {
      const diff = createFileDiffFromText('line1\nline2', 'line1\nmodified line2', 'test.txt');

      expect(diff.oldFilePath).toBe('test.txt');
      expect(diff.newFilePath).toBe('test.txt');
      expect(diff.chunks).toHaveLength(1);
      expect(diff.chunks[0].lines).toHaveLength(3); // unchanged, removed, added
      expect(diff.chunks[0].lines[0].type).toBe('unchanged');
      expect(diff.chunks[0].lines[1].type).toBe('removed');
      expect(diff.chunks[0].lines[2].type).toBe('added');
    });
  });

  describe('createNewFileDiff', () => {
    it('creates a diff for a new file', () => {
      const diff = createNewFileDiff('new content', 'new.txt');

      expect(diff.oldFilePath).toBe('/dev/null');
      expect(diff.newFilePath).toBe('new.txt');
      expect(diff.isNew).toBe(true);
      expect(diff.chunks[0].lines.every((line) => line.type === 'added')).toBe(true);
    });
  });

  describe('createDeletedFileDiff', () => {
    it('creates a diff for a deleted file', () => {
      const diff = createDeletedFileDiff('deleted content', 'deleted.txt');

      expect(diff.oldFilePath).toBe('deleted.txt');
      expect(diff.newFilePath).toBe('/dev/null');
      expect(diff.isDeleted).toBe(true);
      expect(diff.chunks[0].lines.every((line) => line.type === 'removed')).toBe(true);
    });
  });

  describe('createBinaryFileDiff', () => {
    it('creates a diff for binary files', () => {
      const diff = createBinaryFileDiff('old.png', 'new.png', true);

      expect(diff.oldFilePath).toBe('old.png');
      expect(diff.newFilePath).toBe('new.png');
      expect(diff.isBinary).toBe(true);
      expect(diff.isRenamed).toBe(true);
      expect(diff.chunks).toHaveLength(0);
    });
  });

  describe('detectLanguageFromPath', () => {
    it('detects language from file extensions', () => {
      expect(detectLanguageFromPath('test.ts')).toBe('typescript');
      expect(detectLanguageFromPath('test.js')).toBe('javascript');
      expect(detectLanguageFromPath('test.py')).toBe('python');
      expect(detectLanguageFromPath('test.css')).toBe('css');
      expect(detectLanguageFromPath('test.unknown')).toBeUndefined();
    });
  });
});
