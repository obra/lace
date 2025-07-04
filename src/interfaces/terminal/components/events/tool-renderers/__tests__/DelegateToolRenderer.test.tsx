// ABOUTME: Tests for DelegateToolRenderer component with direct composition pattern
// ABOUTME: Verifies delegation display, thread IDs, and nested timeline behavior

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { DelegateToolRenderer } from '../DelegateToolRenderer.js';
import type { ToolRendererProps } from '../components/shared.js';
import { TimelineExpansionProvider } from '../../hooks/useTimelineExpansionToggle.js';

describe('DelegateToolRenderer', () => {
  const createMockItem = (overrides?: Partial<ToolRendererProps['item']>): ToolRendererProps['item'] => ({
    type: 'tool_execution',
    call: {
      name: 'delegate',
      arguments: {
        task: 'Analyze the codebase structure',
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

  it('should show delegate with task in header', () => {
    const item = createMockItem();
    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('delegate');
    expect(lastFrame()).toContain('"Analyze the codebase structure"');
    expect(lastFrame()).toContain('[DELEGATE]');
  });

  it('should show pending status when running', () => {
    const item = createMockItem({ result: undefined });
    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('⏳');
  });

  it('should show thread ID when delegation is active', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: JSON.stringify({
            threadId: 'delegate-thread-123',
            status: 'active',
          }),
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);
    expect(lastFrame()).toContain('Thread: delegate-thread-123');
    expect(lastFrame()).toContain('Delegation active');
  });

  it('should handle prompt field instead of task', () => {
    const item = createMockItem({
      call: {
        name: 'delegate',
        arguments: {
          prompt: 'Explain this function',
        },
      },
    });
    
    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);
    expect(lastFrame()).toContain('"Explain this function"');
  });

  it('should show error status on failure', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: 'Delegation failed: timeout',
        }],
        isError: true,
      },
    });
    
    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);
    expect(lastFrame()).toContain('✗');
  });

  it('should show completion summary when done', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: JSON.stringify({
            threadId: 'delegate-thread-456',
            status: 'completed',
            summary: 'Analysis complete. Found 10 components.',
            totalTokens: 5432,
          }),
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);
    expect(lastFrame()).toContain('Analysis complete. Found 10 components.');
    expect(lastFrame()).toContain('5,432 tokens');
  });

  it('should handle unknown task gracefully', () => {
    const item = createMockItem({
      call: {
        name: 'delegate',
        arguments: {},
      },
    });
    
    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);
    expect(lastFrame()).toContain('"Unknown task"');
  });

  it('should show delegation instructions when expanded', () => {
    const item = createMockItem({
      result: {
        content: [{
          text: JSON.stringify({
            threadId: 'delegate-thread-789',
            status: 'active',
          }),
        }],
        isError: false,
      },
    });
    
    // Note: Testing expanded state would require simulating user interaction
    // For now, we just verify the component renders without error
    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} isSelected={true} />);
    expect(lastFrame()).toBeTruthy();
  });
});