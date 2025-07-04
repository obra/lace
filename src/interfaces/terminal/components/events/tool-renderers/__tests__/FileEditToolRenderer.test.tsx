// ABOUTME: Tests for FileEditToolRenderer component with direct composition pattern
// ABOUTME: Verifies file edit display with before/after diffs and line counts

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { FileEditToolRenderer } from '../FileEditToolRenderer.js';
import type { ToolRendererProps } from '../components/shared.js';
import { TimelineExpansionProvider } from '../../hooks/useTimelineExpansionToggle.js';

describe('FileEditToolRenderer', () => {
  const createMockItem = (overrides?: Partial<ToolRendererProps['item']>): ToolRendererProps['item'] => ({
    type: 'tool_execution',
    call: {
      name: 'file-edit',
      arguments: {
        file_path: '/path/to/file.txt',
        old_text: 'Hello world',
        new_text: 'Hello universe',
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

  it('should show file path in header', () => {
    const item = createMockItem();
    const { lastFrame } = renderWithProviders(<FileEditToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('file-edit');
    expect(lastFrame()).toContain('/path/to/file.txt');
  });

  it('should show pending status when running', () => {
    const item = createMockItem({ result: undefined });
    const { lastFrame } = renderWithProviders(<FileEditToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('⏳');
  });

  it('should show success status when complete', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: 'File edited successfully',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileEditToolRenderer item={item} />);
    expect(lastFrame()).toContain('✓');
  });

  it('should show error status on failure', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: 'Text not found in file',
        }],
        isError: true,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileEditToolRenderer item={item} />);
    expect(lastFrame()).toContain('✗');
  });

  it('should show old text preview when collapsed and complete', () => {
    const item = createMockItem({
      call: {
        name: 'file-edit',
        arguments: {
          file_path: '/path/to/file.txt',
          old_text: 'Line 1\nLine 2\nLine 3',
          new_text: 'New line 1\nNew line 2',
        },
      },
      result: {
        content: [{
          text: 'File edited successfully',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileEditToolRenderer item={item} />);
    expect(lastFrame()).toContain('- Line 1');
    expect(lastFrame()).toContain('- Line 2');
    expect(lastFrame()).toContain('... and more');
  });

  it('should show line count changes in header', () => {
    const item = createMockItem({
      call: {
        name: 'file-edit',
        arguments: {
          file_path: '/path/to/file.txt',
          old_text: 'Line 1\nLine 2\nLine 3',
          new_text: 'New line 1\nNew line 2',
        },
      },
      result: {
        content: [{
          text: 'File edited successfully',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileEditToolRenderer item={item} />);
    expect(lastFrame()).toContain('-3 +2 lines');
  });

  it('should handle single line edits', () => {
    const item = createMockItem({
      call: {
        name: 'file-edit',
        arguments: {
          file_path: '/path/to/file.txt',
          old_text: 'Hello world',
          new_text: 'Hello universe',
        },
      },
      result: {
        content: [{
          text: 'File edited successfully',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileEditToolRenderer item={item} />);
    expect(lastFrame()).toContain('-1 +1 lines');
  });

  it('should handle empty text replacements', () => {
    const item = createMockItem({
      call: {
        name: 'file-edit',
        arguments: {
          file_path: '/path/to/file.txt',
          old_text: 'Delete this',
          new_text: '',
        },
      },
      result: {
        content: [{
          text: 'File edited successfully',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileEditToolRenderer item={item} />);
    expect(lastFrame()).toContain('-1 +0 lines');
  });
});