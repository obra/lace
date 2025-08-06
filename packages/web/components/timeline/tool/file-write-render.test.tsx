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
    
    // Check for success text content
    expect(container.textContent).toContain('File Written Successfully');
    expect(container.textContent).toContain('Button.tsx');
    expect(container.textContent).toContain('1.2 KB');
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
    const errorDiv = container.querySelector('.bg-error\\/10');
    expect(errorDiv).toBeTruthy();
    
    // Check for error text content
    expect(container.textContent).toContain('File Write Failed');
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
    
    // Should show filename prominently
    expect(container.textContent).toContain('ComplexComponent.tsx');
    // Should show file size
    expect(container.textContent).toContain('2.5 MB');
    // Should show full path in smaller text
    expect(container.textContent).toContain('/very/long/path/to/project/src/components/ComplexComponent.tsx');
  });
});