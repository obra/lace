// ABOUTME: Tests for GenericToolRenderer component with direct composition pattern
// ABOUTME: Verifies fallback display for unknown tools with [GENERIC] tag

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { GenericToolRenderer } from '../GenericToolRenderer.js';
import type { ToolRendererProps } from '../components/shared.js';
import { TimelineExpansionProvider } from '../../hooks/useTimelineExpansionToggle.js';

describe('GenericToolRenderer', () => {
  const createMockItem = (overrides?: Partial<ToolRendererProps['item']>): ToolRendererProps['item'] => ({
    type: 'tool_execution',
    call: {
      id: 'call-123',
      name: 'unknown-tool',
      arguments: {
        param1: 'value1',
        param2: 'value2',
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

  it('should show tool name with [GENERIC] tag in header', () => {
    const item = createMockItem();
    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('unknown-tool');
    expect(lastFrame()).toContain('[GENERIC]');
  });

  it('should show pending status when running', () => {
    const item = createMockItem({ result: undefined });
    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('⏳');
  });

  it('should show success status when complete', () => {
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: 'Tool executed successfully',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);
    expect(lastFrame()).toContain('✓');
  });

  it('should show error status on failure', () => {
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: 'Tool execution failed',
        }],
        isError: true,
      },
    });
    
    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);
    expect(lastFrame()).toContain('✗');
  });

  it('should handle various tool names', () => {
    const item = createMockItem({
      call: {
      id: 'call-123',
        name: 'custom-analyzer',
        arguments: {},
      },
    });
    
    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);
    expect(lastFrame()).toContain('custom-analyzer');
    expect(lastFrame()).toContain('[GENERIC]');
  });

  it('should show primary info from first argument', () => {
    const item = createMockItem({
      call: {
      id: 'call-123',
        name: 'test-tool',
        arguments: {
          filename: '/path/to/file.txt',
          otherParam: 'value',
        },
      },
    });
    
    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);
    expect(lastFrame()).toContain('/path/to/file.txt');
  });

  it('should handle empty arguments', () => {
    const item = createMockItem({
      call: {
      id: 'call-123',
        name: 'no-args-tool',
        arguments: {},
      },
    });
    
    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);
    expect(lastFrame()).toContain('no-args-tool');
    expect(lastFrame()).toContain('[GENERIC]');
  });

  it('should show output preview when collapsed', () => {
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);
    expect(lastFrame()).toContain('Line 1');
    expect(lastFrame()).toContain('Line 2');
    expect(lastFrame()).toContain('Line 3');
    expect(lastFrame()).toContain('(+ 2 lines)');
  });
});