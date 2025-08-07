// ABOUTME: Visual rendering tests for file_write tool renderer
// ABOUTME: Tests actual React component rendering with React Testing Library

import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { fileWriteRenderer } from './file-write';
import type { ToolResult } from './types';

describe('fileWriteRenderer visual rendering', () => {
  test('should render successful file write with proper elements', () => {
    const successResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: 'Successfully wrote 1.2 KB to /home/user/documents/Button.tsx',
        },
      ],
      isError: false,
    };

    const rendered = fileWriteRenderer.renderResult?.(successResult);
    expect(rendered).toBeDefined();

    const { container } = render(rendered as React.ReactElement);
    
    // Check for success styling
    const successDiv = container.querySelector('.bg-success\\/5');
    expect(successDiv).toBeTruthy();
    
    // Should not show file content when no metadata is provided
    // The component only shows empty success div when there's no file content to display
    expect(container.querySelector('.p-3')).toBeFalsy();
  });

  test('should render error result with proper elements', () => {
    const errorResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: 'Permission denied writing to /protected/system.conf. Check file permissions or choose a different location.',
        },
      ],
      isError: true,
    };

    const rendered = fileWriteRenderer.renderResult?.(errorResult);
    expect(rendered).toBeDefined();

    const { container } = render(rendered as React.ReactElement);
    
    // Check for error styling
    const errorDiv = container.querySelector('.bg-error\\/5');
    expect(errorDiv).toBeTruthy();
    
    // Check for error text content
    expect(container.textContent).toContain('Write Failed');
    expect(container.textContent).toContain('Permission denied');
  });

  test('should handle empty content gracefully', () => {
    const emptyResult: ToolResult = {
      content: [],
      isError: false,
    };

    const rendered = fileWriteRenderer.renderResult?.(emptyResult);
    expect(rendered).toBeDefined();

    const { container } = render(rendered as React.ReactElement);
    expect(container.textContent).toContain('No output');
  });

  test('should parse and display file information correctly', () => {
    const detailedResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: 'Successfully wrote 2.5 MB to /very/long/path/to/project/src/components/ComplexComponent.tsx',
        },
      ],
      isError: false,
    };

    const rendered = fileWriteRenderer.renderResult?.(detailedResult);
    const { container } = render(rendered as React.ReactElement);
    
    // With the new behavior, without metadata we don't show content
    // Check for success styling
    const successDiv = container.querySelector('.bg-success\\/5');
    expect(successDiv).toBeTruthy();
  });
});