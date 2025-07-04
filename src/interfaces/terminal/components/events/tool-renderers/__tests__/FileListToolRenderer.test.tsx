// ABOUTME: Tests for FileListToolRenderer component with direct composition pattern
// ABOUTME: Verifies directory tree display, file/directory counts, and empty directory handling

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { FileListToolRenderer } from '../FileListToolRenderer.js';
import type { ToolRendererProps } from '../components/shared.js';
import { TimelineExpansionProvider } from '../../hooks/useTimelineExpansionToggle.js';

describe('FileListToolRenderer', () => {
  const createMockItem = (overrides?: Partial<ToolRendererProps['item']>): ToolRendererProps['item'] => ({
    type: 'tool_execution',
    call: {
      name: 'file-list',
      arguments: {
        path: '/path/to/dir',
        recursive: false,
      },
    },
    result: undefined,
    timestamp: new Date(),
    callId: 'test-call-id',
    ...overrides,
  });

  // Helper to render with required providers
  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <TimelineExpansionProvider>
        {component}
      </TimelineExpansionProvider>
    );
  };

  it('should show directory path in header', () => {
    const item = createMockItem();
    const { lastFrame } = renderWithProviders(<FileListToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('file-list');
    expect(lastFrame()).toContain('/path/to/dir');
  });

  it('should show recursive indicator when recursive is true', () => {
    const item = createMockItem({
      call: {
        name: 'file-list',
        arguments: {
          path: '/path/to/dir',
          recursive: true,
        },
      },
    });
    const { lastFrame } = renderWithProviders(<FileListToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('(recursive)');
  });

  it('should show pending status when running', () => {
    const item = createMockItem({ result: undefined });
    const { lastFrame } = renderWithProviders(<FileListToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('⏳');
  });

  it('should show file and directory counts in header', () => {
    const treeOutput = `file1.txt (100 bytes)
file2.js (200 bytes)
dir1/
dir2/
  file3.md (300 bytes)`;
    
    const item = createMockItem({
      result: {
        content: [{
          text: treeOutput,
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileListToolRenderer item={item} />);
    expect(lastFrame()).toContain('3 files, 2 directories');
  });

  it('should handle empty directories', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: 'No files found',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileListToolRenderer item={item} />);
    expect(lastFrame()).toContain('No files found');
    expect(lastFrame()).not.toContain('files, 0 directories');
  });

  it('should show error status on failure', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: 'Directory not found',
        }],
        isError: true,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileListToolRenderer item={item} />);
    expect(lastFrame()).toContain('✗');
  });

  it('should truncate long file lists in preview', () => {
    const treeOutput = `file1.txt (100 bytes)
file2.txt (200 bytes)
file3.txt (300 bytes)
file4.txt (400 bytes)
file5.txt (500 bytes)`;
    
    const item = createMockItem({
      result: {
        content: [{
          text: treeOutput,
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileListToolRenderer item={item} />);
    expect(lastFrame()).toContain('file1.txt');
    expect(lastFrame()).toContain('file2.txt');
    expect(lastFrame()).toContain('file3.txt');
    expect(lastFrame()).toContain('... and 2 more lines');
  });

  it('should handle tree structure with subdirectories', () => {
    const treeOutput = `src/
  index.js (500 bytes)
  components/
    Button.js (300 bytes)
    Input.js (400 bytes)
test/
  test.js (200 bytes)`;
    
    const item = createMockItem({
      result: {
        content: [{
          text: treeOutput,
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileListToolRenderer item={item} />);
    expect(lastFrame()).toContain('4 files, 3 directories');
  });
});