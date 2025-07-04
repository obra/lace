// ABOUTME: Tests for FileWriteToolRenderer component with direct composition pattern
// ABOUTME: Verifies file write display, character counts, and content preview

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { FileWriteToolRenderer } from '../FileWriteToolRenderer.js';
import type { ToolRendererProps } from '../components/shared.js';
import { TimelineExpansionProvider } from '../../hooks/useTimelineExpansionToggle.js';

describe('FileWriteToolRenderer', () => {
  const createMockItem = (overrides?: Partial<ToolRendererProps['item']>): ToolRendererProps['item'] => ({
    type: 'tool_execution',
    call: {
      id: 'call-123',
      name: 'file-write',
      arguments: {
        file_path: '/path/to/file.txt',
        content: 'Hello, world!',
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

  it('should show file path and character count in header', () => {
    const item = createMockItem();
    const { lastFrame } = renderWithProviders(<FileWriteToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('file-write');
    expect(lastFrame()).toContain('/path/to/file.txt');
    expect(lastFrame()).toContain('13 chars'); // "Hello, world!" is 13 chars
  });

  it('should show pending status when running', () => {
    const item = createMockItem({ result: undefined });
    const { lastFrame } = renderWithProviders(<FileWriteToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('⏳');
  });

  it('should show success status when complete', () => {
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: 'File written successfully',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileWriteToolRenderer item={item} />);
    expect(lastFrame()).toContain('✓');
  });

  it('should show error status on failure', () => {
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: 'Permission denied',
        }],
        isError: true,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileWriteToolRenderer item={item} />);
    expect(lastFrame()).toContain('✗');
  });

  it('should show content preview when collapsed and complete', () => {
    const content = 'Line 1\nLine 2\nLine 3';
    const item = createMockItem({
      call: {
      id: 'call-123',
        name: 'file-write',
        arguments: {
          file_path: '/path/to/file.txt',
          content,
        },
      },
      result: {
        content: [{
          type: 'text',
          text: 'File written successfully',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileWriteToolRenderer item={item} />);
    expect(lastFrame()).toContain('Line 1');
    expect(lastFrame()).toContain('Line 2');
    expect(lastFrame()).toContain('... and more');
  });

  it('should handle empty content', () => {
    const item = createMockItem({
      call: {
      id: 'call-123',
        name: 'file-write',
        arguments: {
          file_path: '/path/to/file.txt',
          content: '',
        },
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileWriteToolRenderer item={item} />);
    expect(lastFrame()).toContain('0 chars');
  });

  it('should handle multi-line content in preview', () => {
    const content = 'First line\nSecond line\nThird line\nFourth line';
    const item = createMockItem({
      call: {
      id: 'call-123',
        name: 'file-write',
        arguments: {
          file_path: '/path/to/file.txt',
          content,
        },
      },
      result: {
        content: [{
          type: 'text',
          text: 'File written successfully',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileWriteToolRenderer item={item} />);
    // Should only show first 2 lines in preview
    expect(lastFrame()).toContain('First line');
    expect(lastFrame()).toContain('Second line');
    expect(lastFrame()).not.toContain('Third line');
  });
});