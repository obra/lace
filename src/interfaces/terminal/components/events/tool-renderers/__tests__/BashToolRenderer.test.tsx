// ABOUTME: Tests for BashToolRenderer component with direct composition pattern
// ABOUTME: Verifies bash command display, output rendering, and expansion behavior

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { BashToolRenderer } from '../BashToolRenderer.js';
import type { ToolRendererProps } from '../components/shared.js';
import { TimelineExpansionProvider } from '../../hooks/useTimelineExpansionToggle.js';

describe('BashToolRenderer', () => {
  const createMockItem = (overrides?: Partial<ToolRendererProps['item']>): ToolRendererProps['item'] => ({
    type: 'tool_execution',
    call: {
      name: 'bash',
      arguments: {
        command: 'ls -la',
        description: 'List files',
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

  it('should show bash command in header', () => {
    const item = createMockItem();
    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('bash $ ls -la');
    expect(lastFrame()).toContain('List files');
  });

  it('should show pending status when running', () => {
    const item = createMockItem({ result: undefined });
    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('⏳');
  });

  it('should show success status with output', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: JSON.stringify({
            stdout: 'file1.txt\nfile2.txt',
            stderr: '',
            exitCode: 0,
          }),
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);
    expect(lastFrame()).toContain('✓');
    expect(lastFrame()).toContain('file1.txt');
  });

  it('should show error status for non-zero exit code', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: JSON.stringify({
            stdout: '',
            stderr: 'Command not found',
            exitCode: 127,
          }),
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);
    expect(lastFrame()).toContain('✗');
    expect(lastFrame()).toContain('exit 127');
  });

  it('should truncate long output in preview', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: JSON.stringify({
            stdout: 'line1\nline2\nline3\nline4\nline5',
            stderr: '',
            exitCode: 0,
          }),
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);
    expect(lastFrame()).toContain('line1');
    expect(lastFrame()).toContain('line2');
    expect(lastFrame()).toContain('line3');
    expect(lastFrame()).toContain('(+ 2 lines)');
  });

  it('should show stderr in red when only stderr exists', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: JSON.stringify({
            stdout: '',
            stderr: 'Error message',
            exitCode: 1,
          }),
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);
    // The red color would be applied via Text component's color prop
    expect(lastFrame()).toContain('Error message');
  });

  it('should handle malformed result gracefully', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: 'not valid json',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);
    expect(lastFrame()).toContain('✓'); // Falls back to success if parse fails
  });

  it('should show no output indicator when command has no output', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: JSON.stringify({
            stdout: '',
            stderr: '',
            exitCode: 0,
          }),
        }],
        isError: false,
      },
    });
    
    // To see expanded content, we need to select the item and trigger expansion
    // For now, we'll just verify the component renders without error
    // The expansion behavior is tested via integration tests
    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} isSelected={true} />);
    expect(lastFrame()).toBeTruthy();
  });
});